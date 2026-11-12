"""Shared host lookup for infra scripts. No hardcoded IPs.

Resolution order for a name like SYNO_HOST / KALI_HOST / DENIZEN_HOME_HOST:
  1. environment variable
  2. infra/hosts.local  (gitignored; KEY=VALUE per line, '#' comments allowed)
Copy infra/hosts.local.example to infra/hosts.local and fill in your own values.
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_LOCAL_FILE = os.path.join(_HERE, "hosts.local")


def _load_local():
    out = {}
    try:
        with open(_LOCAL_FILE, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return out


def get_host(name):
    val = os.environ.get(name) or _load_local().get(name)
    if not val:
        sys.exit(
            f"{name} is not set. Export it or add {name}=<address> to "
            f"infra/hosts.local (see infra/hosts.local.example)."
        )
    return val
