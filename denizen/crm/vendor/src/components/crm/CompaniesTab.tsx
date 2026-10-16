import { useMemo, useState } from "react";
import { T, S, fmt, type Company, type Contact, type Deal } from "@/lib/crm-data";

interface Props {
  companies: Company[];
  contacts: Contact[];
  deals: Deal[];
  onUpdateCompanies: (companies: Company[]) => void;
}

export function CompaniesTab({ companies, contacts, deals, onUpdateCompanies }: Props) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter((c) =>
      c.name.toLowerCase().includes(q)
      || c.domain.toLowerCase().includes(q)
      || c.industry.toLowerCase().includes(q),
    );
  }, [companies, search]);

  const healthColor = (h: string) => (h === "good" ? T.green : h === "at-risk" ? T.red : h === "warm" ? T.accent : T.text3);

  const addCompany = () => {
    const name = prompt("Company name?");
    if (!name?.trim()) return;
    onUpdateCompanies([...companies, {
      id: Date.now(),
      name: name.trim(),
      domain: "",
      industry: "",
      size: "",
      mrr: 0,
      arr: 0,
      health: "warm",
      tags: [],
      website: "",
      notes: "",
      linkedContacts: [],
      linkedDeals: [],
    }]);
  };

  const card = {
    background: `linear-gradient(145deg,${T.bg2},${T.bg3}88)`,
    border: `1px solid ${T.bg4}`,
    borderRadius: T.radius.lg,
    padding: "16px 18px",
    marginBottom: 10,
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text0, margin: 0 }}>🏢 Companies</h1>
          <p style={{ fontSize: 14, color: T.text2, marginTop: 4 }}>{companies.length} accounts · synced with team workspace</p>
        </div>
        <button aria-label="add" onClick={addCompany} style={{ ...S.btn, padding: "8px 14px" }}>+ Add company</button>
      </div>
      <input value={search} onChange={(e) = aria-label="input"> setSearch(e.target.value)} placeholder="Search companies…" style={{ ...S.input, width: "100%", marginBottom: 16, maxWidth: 360 }} />
      {filtered.length === 0 ? (
        <div style={card}><p style={{ color: T.text3, margin: 0 }}>No companies yet. Load sample data or add your first account.</p></div>
      ) : filtered.map((co) => {
        const linked = contacts.filter((c) => co.linkedContacts?.includes(c.id) || c.company === co.name);
        const coDeals = deals.filter((d) => co.linkedDeals?.includes(d.id) || linked.some((c) => c.name === d.contact));
        return (
          <div key={co.id} style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: T.text0 }}>{co.name}</div>
                <div style={{ fontSize: 14, color: T.text3, marginTop: 2 }}>{co.industry || "—"} · {co.size || "—"} · {co.domain || "no domain"}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.accent }}>{fmt(co.arr || co.mrr * 12)} ARR</div>
                <div style={{ fontSize: 14, color: healthColor(co.health), fontWeight: 600, marginTop: 2 }}>{co.health}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 12, fontSize: 14, color: T.text2 }}>
              <span>{linked.length} contacts</span>
              <span>{coDeals.length} deals</span>
            </div>
            {co.notes && <p style={{ fontSize: 14, color: T.text2, margin: "10px 0 0", lineHeight: 1.5 }}>{co.notes}</p>}
          </div>
        );
      })}
    </div>
  );
}
