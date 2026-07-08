#!/usr/bin/env node
/**
 * grok-mcp-ping.js
 * Tiny CLI: reads .mcp-token.local.json or DENIZEN_MCP_TOKEN
 * calls get_status + list_skills on the public MCP and prints JSON.
 * No external dependencies.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const TOKEN_FILE = '.mcp-token.local.json';
const BASE_URL = process.env.DENIZEN_MCP_URL || 'https://denizen.dolonia.cloud/mcp/npc/grok';

function resolveTokenFile() {
  const candidates = [
    path.join(process.cwd(), TOKEN_FILE),
    path.join(__dirname, '..', '..', TOKEN_FILE),
    path.join(__dirname, '..', TOKEN_FILE),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function getToken() {
  if (process.env.DENIZEN_MCP_TOKEN) {
    return process.env.DENIZEN_MCP_TOKEN;
  }
  const tokenPath = resolveTokenFile();
  if (!tokenPath) {
    console.error('No token found. Set DENIZEN_MCP_TOKEN or provide ' + TOKEN_FILE + ' at repo root');
    process.exit(1);
  }
  try {
    const data = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    if (data.token) return data.token;
  } catch (_) { /* fall through */ }
  console.error('Invalid token file:', tokenPath);
  process.exit(1);
}

function mcpCall(method, args = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: method, arguments: args }
    });

    const auth = 'Bearer ' + getToken();

    const req = https.request(BASE_URL, {
      method: 'POST',
      headers: {
        'Authorization': auth,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.error) return reject(json.error);
          resolve(json.result || json);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  const args = process.argv.slice(2);
  const summaryMode = args.includes('--summary') || args.includes('-s');
  const help = args.includes('--help') || args.includes('-h');

  if (help) {
    console.log('grok-mcp-ping.js\n  Usage: node apps/office/scripts/grok-mcp-ping.js [--summary]\n  Calls get_status + list_skills and prints results.\n  --summary : human readable output');
    process.exit(0);
  }

  try {
    const status = await mcpCall('get_status', { limit: 5 });
    const skillsRaw = await mcpCall('list_skills');

    const parseMcpText = (result) => {
      const text = result?.content?.[0]?.text;
      if (!text) return result;
      try { return JSON.parse(text); } catch (_) { return result; }
    };

    const statusParsed = parseMcpText(status);
    const skillsParsed = parseMcpText(skillsRaw);
    const skillList = skillsParsed?.skills
      || statusParsed?.skills
      || [];

    if (summaryMode) {
      console.log('=== Grok MCP Ping Summary ===');
      console.log('NPC:', statusParsed?.npc?.display_name || 'Grok');
      console.log('Role:', statusParsed?.npc?.role || 'xAI Researcher & Engineer');
      console.log('Inference reachable:', statusParsed?.inference?.reachable);
      console.log('Recent work count:', (statusParsed?.recent_work || []).length);
      console.log('Skills available:', Array.isArray(skillList) ? skillList.length : 0);
      if (Array.isArray(skillList) && skillList.length > 0) {
        console.log('Top skills:', skillList.slice(0, 8).join(', '));
      }
      console.log('MCP URL:', BASE_URL);
    } else {
      console.log(JSON.stringify({
        ok: true,
        status: statusParsed,
        skills: skillsParsed,
        skill_count: Array.isArray(skillList) ? skillList.length : 0,
        skill_names: skillList,
      }, null, 2));
    }
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err }, null, 2));
    process.exit(1);
  }
}

main();
