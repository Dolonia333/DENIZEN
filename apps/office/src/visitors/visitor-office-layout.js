'use strict';

const fs = require('fs');
const path = require('path');
const { CEO_OFFICE_ID, normalizeOfficeId } = require('./visitor-office-registry');

function layoutDirForRoot(root) {
  return path.join(root, 'layouts', 'offices');
}

function layoutFileForOffice(root, officeId) {
  const id = normalizeOfficeId(officeId);
  const safe = id.replace(/[^a-zA-Z0-9:_-]/g, '_');
  return path.join(layoutDirForRoot(root), safe, 'office-layout.json');
}

function legacyLayoutFile(root) {
  return path.join(root, 'layouts', 'office-layout.json');
}

function readLayoutSync(root, officeId) {
  const file = layoutFileForOffice(root, officeId);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    if (officeId === CEO_OFFICE_ID || !officeId) {
      try {
        const raw = fs.readFileSync(legacyLayoutFile(root), 'utf8');
        return JSON.parse(raw);
      } catch (_2) {
        return null;
      }
    }
    return null;
  }
}

async function readLayout(root, officeId) {
  return readLayoutSync(root, officeId);
}

function writeLayoutSync(root, officeId, data) {
  const file = layoutFileForOffice(root, officeId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  JSON.parse(body);
  fs.writeFileSync(file, body, 'utf8');
  return file;
}

function appendFurnitureItem(root, officeId, item) {
  let layout = readLayoutSync(root, officeId) || { items: [] };
  if (!Array.isArray(layout.items)) layout.items = [];
  layout.items.push(item);
  writeLayoutSync(root, officeId, layout);
  return layout;
}

function removeFurnitureItem(root, officeId, instanceId) {
  const layout = readLayoutSync(root, officeId) || { items: [] };
  if (!Array.isArray(layout.items)) return null;
  const next = layout.items.filter((i) => i.instanceId !== instanceId);
  if (next.length === layout.items.length) return null;
  writeLayoutSync(root, officeId, { ...layout, items: next });
  return next;
}

module.exports = {
  layoutDirForRoot,
  layoutFileForOffice,
  legacyLayoutFile,
  readLayout,
  readLayoutSync,
  writeLayoutSync,
  appendFurnitureItem,
  removeFurnitureItem,
};
