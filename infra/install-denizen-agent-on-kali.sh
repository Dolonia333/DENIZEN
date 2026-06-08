#!/bin/bash
# Run this ON the Kali laptop (100.110.205.49) if you cannot SSH from dolonia.
#
# Pull install (recommended):
#   export DENIZEN_FLEET_AGENT_TOKEN=<from denizen/.env on dolonia>
#   export DENIZEN_PULL_URL=http://100.71.54.109:8081
#   bash infra/pull-install-kali-agent.sh
#
# Local bundle:
#   cd infra/kali-agent-bundle && bash ../install-denizen-agent-on-kali.sh
# Or copy infra/kali-agent-bundle/* to ~/denizen-agent/ then run this script.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_ROOT="${HOME}/denizen-agent"
mkdir -p "${AGENT_ROOT}/src"

BUNDLE_DIR="${SCRIPT_DIR}/kali-agent-bundle"
if [[ ! -d "${BUNDLE_DIR}" && -d "${SCRIPT_DIR}" ]]; then
  # running from inside kali-agent-bundle
  if [[ -f "${SCRIPT_DIR}/nas-metrics-agent.js" ]]; then
    BUNDLE_DIR="${SCRIPT_DIR}"
  fi
fi

if [[ -d "${BUNDLE_DIR}" ]]; then
  cp -f "${BUNDLE_DIR}/.env" "${AGENT_ROOT}/.env" 2>/dev/null || true
  for f in nas-metrics-agent.js nas-compute-agent.js; do
    [[ -f "${BUNDLE_DIR}/${f}" ]] && cp -f "${BUNDLE_DIR}/${f}" "${AGENT_ROOT}/${f}"
  done
  for f in denizen-hardware-monitor.js denizen-node-client.js denizen-mesh-job-runner.js; do
    [[ -f "${BUNDLE_DIR}/src/${f}" ]] && cp -f "${BUNDLE_DIR}/src/${f}" "${AGENT_ROOT}/src/${f}"
  done
fi

if [[ ! -f "${AGENT_ROOT}/.env" ]]; then
  echo "Missing ${AGENT_ROOT}/.env — copy infra/kali-agent-bundle/.env or run kali-install-agent.sh"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  sudo apt update
  sudo apt install -y nodejs npm
fi

export DENIZEN_AGENT_ROOT="${AGENT_ROOT}"
export DENIZEN_HARDWARE_MONITOR_PATH="${AGENT_ROOT}/src/denizen-hardware-monitor.js"
cd "${AGENT_ROOT}"

AGENT_SCRIPT="nas-metrics-agent.js"
if [[ -f "${AGENT_ROOT}/nas-compute-agent.js" && -f "${AGENT_ROOT}/src/denizen-node-client.js" && -f "${AGENT_ROOT}/src/denizen-mesh-job-runner.js" ]]; then
  AGENT_SCRIPT="nas-compute-agent.js"
  echo "Compute worker enabled (${AGENT_SCRIPT})"
else
  echo "Metrics-only (${AGENT_SCRIPT}) — ensure nas-compute-agent.js, src/denizen-node-client.js, and src/denizen-mesh-job-runner.js are present"
fi

echo "Starting Denizen fleet agent..."
exec node "${AGENT_SCRIPT}"