#!/usr/bin/env python3
"""Inspect conversation-sense / theme harvest storage on NAS."""
from __future__ import annotations
from hostcfg import get_host
import os
import sys
from pathlib import Path

INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401
import paramiko

HOST = get_host("SYNO_HOST")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
USER = os.environ.get("SYNO_USER", "admin")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")

JS = r"""
const fs = require('fs');
const paths = [
  '/app/data/conversation-sense',
  '/app/data/discord-farm',
  '/app/data/harness-learning.jsonl',
];
for (const p of paths) {
  try {
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      const files = fs.readdirSync(p);
      console.log(p, 'DIR', files.join(','));
      for (const f of files.slice(0, 12)) {
        const fp = p + '/' + f;
        const s = fs.statSync(fp);
        console.log(' ', f, s.size + 'b');
      }
    } else {
      console.log(p, 'FILE', st.size + 'b');
    }
  } catch (e) {
    console.log(p, 'MISSING', e.message);
  }
}
try {
  const people = JSON.parse(fs.readFileSync('/app/data/conversation-sense/people.json', 'utf8'));
  console.log('people_count', Object.keys(people.people || {}).length);
  const sample = Object.entries(people.people || {})[0];
  if (sample) {
    console.log('sample_person', JSON.stringify({
      hash: sample[0],
      primary: sample[1].primary,
      types: sample[1].types,
      n: sample[1].stats && sample[1].stats.n,
    }));
  }
} catch (e) {
  console.log('people_err', e.message);
}
try {
  const types = JSON.parse(fs.readFileSync('/app/data/conversation-sense/types.json', 'utf8'));
  console.log('types', JSON.stringify(types.counts || {}));
} catch (e) {}
try {
  const topics = JSON.parse(fs.readFileSync('/app/data/discord-farm/topics.json', 'utf8'));
  const top = Object.entries(topics.topics || {})
    .sort((a, b) => (b[1].count || 0) - (a[1].count || 0))
    .slice(0, 5);
  console.log('topics_top', JSON.stringify(top));
} catch (e) {}
try {
  const days = fs.readdirSync('/app/data/discord-farm').filter((f) => f.startsWith('messages-'));
  let lines = 0;
  for (const d of days) {
    lines += fs.readFileSync('/app/data/discord-farm/' + d, 'utf8').split('\n').filter(Boolean).length;
  }
  console.log('message_rows', lines, 'day_files', days.length);
} catch (e) {}
"""

def main() -> int:
    if not PWD:
        print("SYNO_SSH_PASSWORD required", file=sys.stderr)
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PWD, look_for_keys=False, allow_agent=False)
    # write script into container via node -e is messy; use base64
    import base64
    b64 = base64.b64encode(JS.encode("utf-8")).decode("ascii")
    cmd = f"{DOCKER} exec denizen-server node -e \"eval(Buffer.from('{b64}','base64').toString())\""
    _, o, e = client.exec_command(cmd, timeout=60)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    print(out)
    client.close()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
