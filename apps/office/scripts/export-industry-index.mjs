#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tsPath = path.join(__dirname, '../crm/vendor/src/lib/industry-config.ts');
const outIndex = path.join(__dirname, '../data/crm-industry-index.json');
const outTemplates = path.join(__dirname, '../data/crm-industry-templates.json');
const src = fs.readFileSync(tsPath, 'utf8');
const start = src.indexOf('export const INDUSTRY_TEMPLATES');
const end = src.indexOf('export const DEFAULT_INDUSTRY_CONFIG');
const block = src.slice(start, end);

const index = [];
const templates = [];
const idRe = /id:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*icon:\s*"([^"]+)"/g;
let idMatch;
while ((idMatch = idRe.exec(block))) {
  const id = idMatch[1];
  const name = idMatch[2];
  const icon = idMatch[3];
  index.push({ id, name, icon });

  const sliceStart = idMatch.index;
  const nextId = block.indexOf('id: "', sliceStart + 10);
  const chunk = nextId > sliceStart ? block.slice(sliceStart, nextId) : block.slice(sliceStart);
  const stagesM = chunk.match(/pipelineStages:\s*\[([\s\S]*?)\]/);
  const stages = [];
  if (stagesM) {
    const stageRe = /"([^"]+)"/g;
    let sm;
    while ((sm = stageRe.exec(stagesM[1]))) stages.push(sm[1]);
  }
  templates.push({
    id,
    name,
    icon,
    industry: id,
    pipelineStages: stages.length ? stages : ['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'],
    contactStatuses: ['Lead', 'Prospect', 'Customer'],
    noteTypes: ['Call', 'Email', 'Meeting'],
    customFields: [],
    terminology: {
      contact: 'Contact', contacts: 'Contacts', deal: 'Deal', deals: 'Deals',
      pipeline: 'Pipeline', company: 'Company', account: 'Account', accounts: 'Accounts',
      customers: 'Customers', salesHub: 'Sales Hub', pipelineValue: 'Pipeline Value',
      note: 'Note', notes: 'Notes', task: 'Task', tasks: 'Tasks',
      value: 'Value', closeDate: 'Close Date', stage: 'Stage',
    },
  });
}

fs.mkdirSync(path.dirname(outIndex), { recursive: true });
fs.writeFileSync(outIndex, `${JSON.stringify(index, null, 2)}\n`);
fs.writeFileSync(outTemplates, `${JSON.stringify(templates, null, 2)}\n`);
console.log(`Wrote ${index.length} industries`);
