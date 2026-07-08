'use strict';

const fs = require('fs');
const path = require('path');

const TEMPLATES_PATH = path.join(__dirname, '..', '..', 'data', 'crm-industry-templates.json');
const INDEX_PATH = path.join(__dirname, '..', '..', 'data', 'crm-industry-index.json');

let _templates = null;
let _index = null;

function loadTemplates() {
  if (_templates) return _templates;
  try {
    _templates = JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf8'));
  } catch (_) {
    _templates = [];
  }
  return _templates;
}

function loadIndex() {
  if (_index) return _index;
  try {
    _index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  } catch (_) {
    _index = loadTemplates().map((t) => ({ id: t.id, name: t.name, icon: t.icon }));
  }
  return _index;
}

function listIndustries(query = '') {
  const q = String(query || '').trim().toLowerCase();
  const rows = loadIndex();
  if (!q) return rows;
  return rows.filter((r) => r.id.includes(q) || r.name.toLowerCase().includes(q));
}

function resolveIndustryId(raw) {
  const needle = String(raw || '').trim().toLowerCase();
  if (!needle) return null;
  const templates = loadTemplates();
  const exact = templates.find((t) => t.id === needle);
  if (exact) return exact.id;
  const byName = templates.find((t) => t.name.toLowerCase() === needle);
  if (byName) return byName.id;
  const partial = templates.find((t) => t.name.toLowerCase().includes(needle) || t.id.includes(needle));
  return partial?.id || null;
}

function getIndustryTemplate(templateId) {
  const id = resolveIndustryId(templateId);
  if (!id) return null;
  return loadTemplates().find((t) => t.id === id) || null;
}

function formatIndustryList(limit = 12) {
  return loadIndex().slice(0, limit).map((r) => `${r.icon} ${r.name} (${r.id})`).join('; ');
}

module.exports = {
  listIndustries,
  resolveIndustryId,
  getIndustryTemplate,
  formatIndustryList,
};
