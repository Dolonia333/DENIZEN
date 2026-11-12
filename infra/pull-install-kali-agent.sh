#!/bin/bash
# Run ON Kali (hp81081d) — pull compute agent bundle from Denizen host over Tailscale/LAN.
# Usage:
#   export DENIZEN_PULL_URL=http://<HOME_SERVER_TAILSCALE_IP>:8081
#   export DENIZEN_FLEET_AGENT_TOKEN=<from denizen/.env>
#   bash pull-install-kali-agent.sh

set -euo pipefail
DENIZEN_PULL_URL="${DENIZEN_PULL_URL:?Set DENIZEN_PULL_URL (e.g. http://<HOME_SERVER_TAILSCALE_IP>:8081)}"
TOKEN="${DENIZEN_FLEET_AGENT_TOKEN:-}"
AGENT_ROOT="${HOME}/denizen-agent"
MACHINE_ID="${DENIZEN_MACHINE_ID:-hp81081d}"

if [[ -z "${TOKEN}" ]]; then
  echo "Set DENIZEN_FLEET_AGENT_TOKEN (see denizen/.env on dolonia)"
  exit 1
fi

mkdir -p "${AGENT_ROOT}"
cd "${AGENT_ROOT}/.."
ENC_PULL_URL="$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "${DENIZEN_PULL_URL}" 2>/dev/null || echo "${DENIZEN_PULL_URL}")"
curl -fsSL \
  -H "X-Fleet-Agent-Token: ${TOKEN}" \
  "${DENIZEN_PULL_URL}/api/compute/fleet/agent-bundle.tar.gz?machine_id=${MACHINE_ID}&label=Kali%20%C2%B7%20${MACHINE_ID}&denizen_url=${ENC_PULL_URL}" \
  | tar xzf -

chmod +x "${AGENT_ROOT}/start.sh"
# Ensure remote agents never keep loopback/LAN-only URLs from a dev bundle.
sed -i "s|^DENIZEN_URL=.*|DENIZEN_URL=${DENIZEN_PULL_URL}|" "${AGENT_ROOT}/.env"
sed -i "s|^DENIZEN_LAN_URL=.*|DENIZEN_LAN_URL=${DENIZEN_PULL_URL}|" "${AGENT_ROOT}/.env"
pkill -f 'nas-(compute|metrics)-agent.js' 2>/dev/null || true
export DENIZEN_AGENT_ROOT="${AGENT_ROOT}"
export DENIZEN_URL="${DENIZEN_PULL_URL}"
export DENIZEN_HARDWARE_MONITOR_PATH="${AGENT_ROOT}/src/denizen-hardware-monitor.js"
cd "${AGENT_ROOT}"
nohup node nas-compute-agent.js >> agent.log 2>&1 </dev/null &
sleep 2
tail -n 6 agent.log
echo "Kali compute agent installed at ${AGENT_ROOT}"
