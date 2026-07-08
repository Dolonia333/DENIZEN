'use strict';

module.exports = {
  meta: {
    name: 'security-linux',
    description: 'Bouncer Kali WSL investigations (nmap, wireshark)',
    mode: 'background',
    aliases: ['nmap', 'zenmap', 'wireshark', 'linux-agent'],
  },
  async run({ npcName, params, deps, skill }) {
    if (npcName !== 'Bouncer') {
      return { ok: false, output: 'Security-linux skills are Bouncer-only.', skill };
    }

    const threat = {
      category: params?.category || (deps.worldState?.activeThreats?.[0]?.category) || 'brute_force',
      source: params?.target || params?.ip || params?.source || 'localhost',
      detail: params?.reason || params?.task || `${skill} investigation`,
      severity: params?.severity || 'medium',
      force: !!(params?.force),
    };

    const gate = deps.bouncerInvTake?.(threat, { force: threat.force });
    if (gate && !gate.allowed) {
      const output = gate.loopback
        ? 'That source is localhost — your own game traffic, not an external attacker. No Kali run needed.'
        : `Investigation on hold (${gate.remainingSec}s cooldown for ${gate.key}). Kali already ran for this threat.`;
      return { ok: true, output, skill };
    }

    try {
      const result = (skill === 'wireshark')
        ? await deps.linuxAgent.trafficSnapshot().then(r => ({
          ok: r.ok, summary: r.raw, elapsed: 5000,
          steps: [{ label: 'tcpdump', output: r.raw }],
        }))
        : await deps.linuxAgent.investigate(threat);
      const output = result.ok
        ? (result.summary || 'Scan complete.').slice(0, 800)
        : `Scan failed: ${result.error || 'unknown'}`;
      return { ok: !!result.ok, output, skill };
    } catch (err) {
      return { ok: false, output: `Kali error: ${err.message}`, skill };
    }
  },
};
