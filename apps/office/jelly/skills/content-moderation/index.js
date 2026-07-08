'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { scanBrandRisks } = require('../../../src/pipelines/content-gate');

module.exports = {
  meta: {
    name: 'content-moderation',
    description: 'Brand safety scan for drafts (libel, copyright, unsafe language)',
    mode: 'background',
    aliases: ['brand-safety', 'legal-scan'],
  },
  async run({ params }) {
    let text = String(params?.text || params?.content || '');
    const artifactPath = params?.artifactPath || params?.path;
    if (!text && artifactPath) {
      const root = path.resolve(__dirname, '../../..');
      const full = path.join(root, String(artifactPath).replace(/^\/+/, ''));
      if (full.startsWith(root)) {
        try { text = fs.readFileSync(full, 'utf8'); } catch (_) {}
      }
    }

    const risks = scanBrandRisks(text);
    const blocked = risks.length > 0 || /\bVERDICT\s*:\s*BLOCKED\b/i.test(text);
    const verdict = blocked ? 'BLOCKED' : 'CLEAR';
    const lines = [
      `# Content moderation`,
      '',
      `**VERDICT: ${verdict}**`,
      '',
      risks.length ? '## Risks\n' + risks.map((r) => `- ${r}`).join('\n') : 'No automated risk patterns detected.',
      '',
      '_Review is heuristic — human editor should confirm before publish._',
    ];

    return {
      ok: true,
      output: lines.join('\n'),
      skill: 'content-moderation',
      verdict,
      inject: true,
    };
  },
};
