#!/usr/bin/env python3
"""Repair zion CRM corruption from crm-capture treating EDIT commands as notes/tasks.

Work id: cwr_43c3630b2eabe209
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import load_infra_env  # noqa: F401
import paramiko

ORG = "be6080e8-638a-495a-b05d-2d90cd1b838f"
REPORT: dict = {
    "deals": [],
    "notes_detached": [],
    "tasks_closed": [],
    "companies": [],
    "contacts": [],
}


def log(msg: str) -> None:
    print(msg, flush=True)


def next_id(rows: list, key: str = "id") -> int:
    ids = []
    for row in rows or []:
        try:
            ids.append(int(row.get(key) or 0))
        except Exception:
            pass
    return (max(ids) + 1) if ids else int(time.time() * 1000)


def load_state(client: paramiko.SSHClient, docker: str) -> dict:
    cmd = (
        f"{docker} exec supabase-db psql -U postgres -d postgres -t -A -c "
        f"\"select state::text from denizen_crm_workspaces where org_id='{ORG}';\""
    )
    _, stdout, stderr = client.exec_command(cmd, timeout=120)
    raw = (stdout.read() + stderr.read()).decode("utf-8", errors="replace").strip()
    return json.loads(raw)


def _stream_text(client: paramiko.SSHClient, remote_path: str, text: str) -> None:
    parent = remote_path.rsplit("/", 1)[0]
    _, o, _ = client.exec_command(f"mkdir -p '{parent}'", timeout=30)
    o.channel.recv_exit_status()
    stdin, stdout, stderr = client.exec_command(f"cat > '{remote_path}'", timeout=180)
    data = text.encode("utf-8")
    chunk = 1024 * 256
    for i in range(0, len(data), chunk):
        stdin.write(data[i : i + chunk])
    stdin.flush()
    stdin.channel.shutdown_write()
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if code != 0:
        raise RuntimeError(f"upload failed {remote_path}: {err}")


def save_state(client: paramiko.SSHClient, docker: str, state: dict) -> None:
    payload = json.dumps(state, ensure_ascii=False)
    if "$zion_state$" in payload:
        raise RuntimeError("delimiter collision in CRM JSON")
    remote_dir = os.environ.get("SYNO_DENIZEN_DIR", "/volume1/docker/denizen-server")
    remote_json = f"{remote_dir}/crm_cwr43_state.json"
    remote_py = f"{remote_dir}/crm_cwr43_save.py"
    saver = f'''#!/usr/bin/env python3
import json, subprocess, sys
path = "{remote_json}"
zion = "{ORG}"
docker = "{docker}"
with open(path, "r", encoding="utf-8") as f:
    data = f.read()
json.loads(data)
sql = (
    "BEGIN;\\n"
    "UPDATE denizen_crm_workspaces SET state = $zion_state$"
    + data
    + "$zion_state$::jsonb, updated_at = now() WHERE org_id = '"
    + zion
    + "';\\nCOMMIT;\\n"
)
r = subprocess.run(
    [docker, "exec", "-i", "supabase-db", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", "-"],
    input=sql,
    text=True,
    capture_output=True,
)
sys.stdout.write(r.stdout)
sys.stderr.write(r.stderr)
sys.exit(r.returncode)
'''
    _stream_text(client, remote_json, payload)
    _stream_text(client, remote_py, saver)
    _, stdout, stderr = client.exec_command(f"/usr/bin/python3 {remote_py}", timeout=180)
    out = (stdout.read() + stderr.read()).decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    log(out[-800:] if out else "(no output)")
    if code != 0:
        raise RuntimeError(f"save failed code={code}: {out[-400:]}")


def looks_instruction(text: str) -> bool:
    t = (text or "").lower()
    return any(
        k in t
        for k in [
            "execute crm corrections",
            "not just a summary",
            "create or update",
            "correct the canonical",
            "verified deadline",
            "detach",
            "return a detailed",
            "fix all crm",
        ]
    )


def repair(state: dict) -> dict:
    notes = list(state.get("notes") or [])
    tasks = list(state.get("tasks") or [])
    deals = list(state.get("deals") or [])
    companies = list(state.get("companies") or [])
    contacts = list(state.get("contacts") or [])

    # 1) Detach instruction notes
    kept_notes = []
    for note in notes:
        text = str(note.get("text") or "")
        deal_id = note.get("dealId")
        if looks_instruction(text) and str(deal_id) in {"7", "16", "17"}:
            REPORT["notes_detached"].append(
                {"id": note.get("id"), "dealId": deal_id, "preview": text[:80]}
            )
            continue
        kept_notes.append(note)
    state["notes"] = kept_notes

    # 2) Close false tasks
    close_ids = {7, 18, 19}
    for task in tasks:
        tid = task.get("id")
        title = str(task.get("title") or "")
        low = title.lower()
        should = tid in close_ids or (
            not task.get("done")
            and (
                "teaming agreement" in low
                or ("follow up" in low and "omes" in low)
            )
        )
        if should and not task.get("done"):
            task["done"] = True
            task["status"] = "done"
            task["closedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            REPORT["tasks_closed"].append({"id": tid, "title": title})
    state["tasks"] = tasks

    # 3) OMES deal
    for deal in deals:
        if deal.get("id") == 7 or "omes ev00000919" in str(deal.get("title") or "").lower():
            deal["stage"] = "Expired / Needs Correction"
            deal["status"] = "expired"
            deal["health"] = "critical"
            deal["deadline"] = "2026-06-11"
            deal["value"] = 0
            deal["notes"] = (
                "Verified solicitation deadline 2026-06-11. Marked expired/needs correction. "
                "No signed RM Cyber teaming agreement."
            )
            REPORT["deals"].append(
                {
                    "id": deal.get("id"),
                    "title": deal.get("title"),
                    "stage": deal.get("stage"),
                    "value": deal.get("value"),
                    "deadline": deal.get("deadline"),
                }
            )

    # 4) RM Cyber company + deal
    rm = None
    for company in companies:
        if "rm cyber" in str(company.get("name") or "").lower() or "richey" in str(company.get("name") or "").lower():
            rm = company
            break
    if not rm:
        rm = {"id": next_id(companies), "name": "RM Cyber / Richey May", "tags": [], "linkedDeals": [], "linkedContacts": []}
        companies.append(rm)
    rm["name"] = "RM Cyber / Richey May"
    rm["status"] = "partnership-development"
    rm["health"] = "warm"
    rm["industry"] = "cybersecurity"
    rm["notes"] = (
        "Partnership-development account — NOT a signed teaming partner. "
        "Contacts: Benjamin Ballard bballard@richeymay.com; Brent Murray bmurray@richeymay.com."
    )
    rm["tags"] = list({*(rm.get("tags") or []), "partnership-development", "no-signed-teaming", "needs-verification"})
    REPORT["companies"].append({"id": rm.get("id"), "name": rm.get("name"), "status": rm.get("status")})

    for deal in deals:
        if deal.get("id") == 17 or str(deal.get("title") or "").lower().startswith("rm cyber"):
            deal["stage"] = "Partnership Development"
            deal["value"] = 0
            deal["notes"] = "Partnership-development only; explicitly no signed teaming agreement."
            REPORT["deals"].append(
                {
                    "id": deal.get("id"),
                    "title": deal.get("title"),
                    "stage": deal.get("stage"),
                    "value": deal.get("value"),
                }
            )

    # Contacts Ballard / Murray
    def upsert_contact(name: str, email: str, company: str):
        found = None
        for ct in contacts:
            if str(ct.get("email") or "").lower() == email.lower():
                found = ct
                break
        if not found:
            found = {"id": next_id(contacts), "name": name, "email": email}
            contacts.append(found)
        found["name"] = name
        found["email"] = email
        found["company"] = company
        found["status"] = "Partner"
        found["tags"] = list({*(found.get("tags") or []), "rm-cyber", "partnership-development"})
        REPORT["contacts"].append({"id": found.get("id"), "name": name, "email": email, "status": found.get("status")})
        return found

    upsert_contact("Benjamin Ballard", "bballard@richeymay.com", "RM Cyber / Richey May")
    upsert_contact("Brent Murray", "bmurray@richeymay.com", "RM Cyber / Richey May")

    # 5) 1921 Holding Co., LLC
    holding = None
    for company in companies:
        if "1921" in str(company.get("name") or "").lower():
            holding = company
            break
    if not holding:
        holding = {
            "id": next_id(companies),
            "name": "1921 Holding Co., LLC",
            "tags": [],
            "linkedDeals": [],
            "linkedContacts": [],
        }
        companies.append(holding)
    holding["name"] = "1921 Holding Co., LLC"
    holding["physicalAddress"] = "1900 N. MacArthur Blvd., Suite 207, Oklahoma City, OK 73127-2655"
    holding["address"] = holding["physicalAddress"]
    holding["mailingAddress"] = "708 NW 143rd St., Edmond, OK 73013"
    holding["notes"] = (
        "Canonical company. Dolonia Data Tech Solutions is an internal DBA/technology division. "
        "IWIN is a separate LLC. Certifications: needs-verification unless current certificate on file."
    )
    holding["tags"] = list({*(holding.get("tags") or []), "canonical", "certifications-needs-verification"})
    holding["status"] = "active"
    REPORT["companies"].append(
        {
            "id": holding.get("id"),
            "name": holding.get("name"),
            "physicalAddress": holding.get("physicalAddress"),
            "mailingAddress": holding.get("mailingAddress"),
        }
    )

    # Dolonia as DBA note on company if present
    for company in companies:
        if str(company.get("name") or "").lower() == "dolonia":
            company["notes"] = "Internal DBA / technology division of 1921 Holding Co., LLC (not a separate client entity)."
            company["tags"] = list({*(company.get("tags") or []), "dba", "internal"})
            REPORT["companies"].append({"id": company.get("id"), "name": company.get("name"), "role": "dba"})

    # 6) Brittany Johnson
    brittany = None
    for ct in contacts:
        if str(ct.get("email") or "").lower() == "zariahsteve@yahoo.com" or "brittany johnson" in str(ct.get("name") or "").lower():
            brittany = ct
            break
    if not brittany:
        brittany = {"id": next_id(contacts), "name": "Brittany Johnson", "email": "zariahsteve@yahoo.com"}
        contacts.append(brittany)
    brittany["name"] = "Brittany Johnson"
    brittany["email"] = "zariahsteve@yahoo.com"
    brittany["status"] = "Active Client"
    brittany["company"] = "1921 Holding Co., LLC"
    brittany["notes"] = (
        "Signed onboarding received 2026-07-22. Intake sent 2026-07-23. "
        "Payment milestone 2026-08-09. No invented monetary value."
    )
    brittany["tags"] = list({*(brittany.get("tags") or []), "active-client", "onboarding"})
    REPORT["contacts"].append(
        {
            "id": brittany.get("id"),
            "name": brittany.get("name"),
            "email": brittany.get("email"),
            "status": brittany.get("status"),
        }
    )

    brittany_deal = None
    for deal in deals:
        if "brittany johnson" in str(deal.get("title") or "").lower() and "community impact" in str(deal.get("title") or "").lower():
            brittany_deal = deal
            break
    if not brittany_deal:
        brittany_deal = {
            "id": next_id(deals),
            "title": "Brittany Johnson – Community Impact Advisory Services",
            "contact": "Brittany Johnson",
            "probability": 60,
            "health": "good",
        }
        deals.append(brittany_deal)
    brittany_deal["title"] = "Brittany Johnson – Community Impact Advisory Services"
    brittany_deal["stage"] = "Onboarding / Awaiting Payment"
    brittany_deal["value"] = 0
    brittany_deal["deadline"] = "2026-08-09"
    brittany_deal["contact"] = "Brittany Johnson"
    brittany_deal["notes"] = (
        "Onboarding received 2026-07-22; intake sent 2026-07-23; payment milestone 2026-08-09; no invented value."
    )
    REPORT["deals"].append(
        {
            "id": brittany_deal.get("id"),
            "title": brittany_deal.get("title"),
            "stage": brittany_deal.get("stage"),
            "value": brittany_deal.get("value"),
            "deadline": brittany_deal.get("deadline"),
        }
    )

    # 7) Amazon Hub Delivery
    amazon = None
    for deal in deals:
        if "amazon hub" in str(deal.get("title") or "").lower():
            amazon = deal
            break
    if not amazon:
        amazon = {
            "id": next_id(deals),
            "title": "Amazon Hub Delivery",
            "contact": "1921 Holding Co., LLC",
            "probability": 40,
            "health": "warm",
        }
        deals.append(amazon)
    amazon["title"] = "Amazon Hub Delivery"
    amazon["stage"] = "Application Ready"
    amazon["value"] = 0
    amazon["notes"] = "Application-ready / not completed. No invented $30,000 value."
    amazon["contact"] = "1921 Holding Co., LLC"
    REPORT["deals"].append(
        {
            "id": amazon.get("id"),
            "title": amazon.get("title"),
            "stage": amazon.get("stage"),
            "value": amazon.get("value"),
        }
    )

    # Certifications flag on holding
    holding["certifications"] = "needs-verification"

    state["deals"] = deals
    state["companies"] = companies
    state["contacts"] = contacts
    return state


def verify(state: dict) -> list[str]:
    errors = []
    deals = {d.get("id"): d for d in state.get("deals") or []}
    omes = deals.get(7)
    if not omes or "expired" not in str(omes.get("stage") or "").lower():
        errors.append("OMES stage not expired")
    if omes and str(omes.get("deadline")) != "2026-06-11":
        errors.append("OMES deadline wrong")
    if omes and Numberish(omes.get("value")) != 0:
        errors.append("OMES value not cleared")
    for note in state.get("notes") or []:
        if looks_instruction(str(note.get("text") or "")) and str(note.get("dealId")) in {"7", "16"}:
            errors.append(f"instruction note still attached: {note.get('id')}")
    open_bad = [
        t
        for t in state.get("tasks") or []
        if not t.get("done")
        and (
            t.get("id") in {7, 18, 19}
            or ("teaming agreement" in str(t.get("title") or "").lower())
        )
    ]
    if open_bad:
        errors.append(f"bad tasks still open: {[t.get('id') for t in open_bad]}")
    if not any("brittany johnson" in str(d.get("title") or "").lower() for d in state.get("deals") or []):
        errors.append("missing Brittany deal")
    if not any("amazon hub" in str(d.get("title") or "").lower() for d in state.get("deals") or []):
        errors.append("missing Amazon deal")
    if not any("1921 holding" in str(c.get("name") or "").lower() for c in state.get("companies") or []):
        errors.append("missing 1921 Holding company")
    return errors


def Numberish(v) -> float:
    try:
        return float(v or 0)
    except Exception:
        return 0.0


def main() -> int:
    if not os.environ.get("SYNO_SSH_PASSWORD"):
        log("SYNO_SSH_PASSWORD required")
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        os.environ.get("SYNO_HOST", "192.168.1.237"),
        username="admin",
        password=os.environ.get("SYNO_SSH_PASSWORD", ""),
        look_for_keys=False,
        allow_agent=False,
    )
    docker = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
    state = load_state(client, docker)
    state = repair(state)
    save_state(client, docker, state)
    # reload verify
    state2 = load_state(client, docker)
    errs = verify(state2)
    client.close()
    report_path = Path(__file__).resolve().parent / "repair-crm-cwr43-report.json"
    report_path.write_text(json.dumps({"report": REPORT, "errors": errs}, indent=2), encoding="utf-8")
    log(json.dumps({"report": REPORT, "errors": errs}, indent=2))
    if errs:
        log("VERIFY FAILED")
        return 1
    log("VERIFY OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
