'use strict';

/**
 * Editor-shaped MCP tools. An agent uses the office the way a person uses
 * an engine editor: look, select a node, act, place, cut a sprite sheet,
 * pack an atlas, undo.
 *
 * The live floor hears `engine_command` (and `furniture_placed` /
 * `furniture_removed`). Layout reads go through injected deps so tests
 * do not touch disk.
 */

const ALLOWED_PREFABS = Object.freeze([
  'desk_small', 'desk_2x2', 'office_chair', 'monitor',
  'plant_small', 'plant_large', 'whiteboard', 'bookshelf',
  'coffee_machine', 'water_cooler', 'couch', 'rug',
  'standing_desk', 'phone_booth', 'meeting_table',
]);

const ACT_VERBS = Object.freeze([
  'walkTo', 'speak', 'speakTo', 'useComputer', 'standUp',
  'goToRoom', 'goToBreakroom', 'joinMeeting', 'emote', 'think',
]);

const ROOMS = Object.freeze([
  'open_office', 'manager_office', 'conference', 'breakroom', 'reception', 'storage',
]);

const TOOL_DEFINITIONS = [
  {
    name: 'office_look',
    description: 'Inspector view of the office: rooms, stations, decor, placed items, and the last errors. Call this before moving or placing anything.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'scene_tree',
    description: 'Scene dock: the office as a tree of nodes (floor, stations, decor, placed furniture).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'node_get',
    description: 'Read one node by id (station, decor, or placed item).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Node id or instanceId' } },
      required: ['id'],
    },
  },
  {
    name: 'node_set',
    description: 'Move or rename one node. Select it with node_get first. Pushed onto the undo stack.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
        name: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'office_act',
    description: 'Play a character the way a person would: walk, speak, sit at a desk, stand, go to a room, emote, or think.',
    inputSchema: {
      type: 'object',
      properties: {
        verb: { type: 'string', enum: [...ACT_VERBS] },
        npcKey: { type: 'string', description: 'Sprite key such as xp_lucy. Defaults to the connected NPC.' },
        x: { type: 'number' },
        y: { type: 'number' },
        text: { type: 'string' },
        room: { type: 'string' },
        deskId: { type: 'string' },
        targetKey: { type: 'string' },
        emote: { type: 'string' },
      },
      required: ['verb'],
    },
  },
  {
    name: 'office_place_furniture',
    description: 'Drag a whitelisted prefab into the office. Same rules as /api/place-furniture.',
    inputSchema: {
      type: 'object',
      properties: {
        prefabId: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
        reason: { type: 'string' },
      },
      required: ['prefabId', 'x', 'y'],
    },
  },
  {
    name: 'office_remove_furniture',
    description: 'Remove one NPC-placed item (instanceId starts with npc_).',
    inputSchema: {
      type: 'object',
      properties: { instanceId: { type: 'string' } },
      required: ['instanceId'],
    },
  },
  {
    name: 'sprite_cut',
    description: 'Cut a sprite sheet into a grid of frames. Pass frame size and sheet size in pixels.',
    inputSchema: {
      type: 'object',
      properties: {
        frameWidth: { type: 'number' },
        frameHeight: { type: 'number' },
        sheetWidth: { type: 'number' },
        sheetHeight: { type: 'number' },
        name: { type: 'string' },
      },
      required: ['frameWidth', 'frameHeight', 'sheetWidth', 'sheetHeight'],
    },
  },
  {
    name: 'atlas_pack',
    description: 'Shelf-pack frames onto one power-of-two page. Returns x,y,w,h for each frame.',
    inputSchema: {
      type: 'object',
      properties: {
        frames: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              w: { type: 'number' },
              h: { type: 'number' },
            },
          },
        },
        maxSize: { type: 'number', description: 'Max page edge in pixels (default 1024)' },
        padding: { type: 'number' },
      },
      required: ['frames'],
    },
  },
  {
    name: 'edit_undo',
    description: 'Undo the last node edit or furniture placement made through these tools.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'office_errors',
    description: 'Debugger: recent engine-tool errors.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number' } },
    },
  },
];

let _deps = {};
let _placeSeq = 0;
const _undo = [];
const _errors = [];
const _overlays = new Map();

function configure(deps = {}) {
  _deps = deps || {};
}

function resetForTests() {
  _deps = {};
  _placeSeq = 0;
  _undo.length = 0;
  _errors.length = 0;
  _overlays.clear();
}

function engineCommand(fields) {
  const officeId = _deps.officeId || 'ceo-operator';
  return { type: 'engine_command', office_id: officeId, officeId, ...fields };
}

function noteError(message) {
  _errors.push({ message: String(message), ts: Date.now() });
  if (_errors.length > 40) _errors.shift();
}

function broadcast(msg) {
  if (typeof _deps.broadcast !== 'function') return;
  try { _deps.broadcast(msg); } catch (err) { noteError(err?.message || String(err)); }
}

function layout() {
  const officeId = _deps.officeId || 'ceo-operator';
  let raw = null;
  try {
    raw = typeof _deps.readLayout === 'function' ? _deps.readLayout(officeId) : null;
  } catch (err) {
    noteError(err?.message || String(err));
  }
  const base = raw && typeof raw === 'object' ? raw : {};
  return {
    officeId,
    size: base.size || { width: 40, height: 23 },
    stations: Array.isArray(base.stations) ? base.stations : [],
    decor: Array.isArray(base.decor) ? base.decor : [],
    items: Array.isArray(base.items) ? base.items : [],
  };
}

function nodeList(view) {
  const nodes = [];
  for (const s of view.stations) {
    nodes.push({ id: s.id, kind: 'station', type: s.type, x: s.x, y: s.y, name: s.name || s.id });
  }
  for (const d of view.decor) {
    nodes.push({ id: d.id, kind: 'decor', type: d.type, x: d.x, y: d.y, name: d.name || d.id });
  }
  for (const item of view.items) {
    nodes.push({
      id: item.instanceId,
      kind: 'item',
      type: item.prefabId,
      x: item.x,
      y: item.y,
      name: item.prefabId,
      placedBy: item.placedBy || null,
    });
  }
  for (const [id, over] of _overlays) {
    const hit = nodes.find((n) => n.id === id);
    if (hit) Object.assign(hit, over, { id });
  }
  return nodes;
}

function findNode(id) {
  const key = String(id || '').trim();
  return nodeList(layout()).find((n) => n.id === key) || null;
}

function toolOfficeLook() {
  const view = layout();
  const nodes = nodeList(view);
  broadcast(engineCommand({ command: 'look' }));
  return {
    ok: true,
    officeId: view.officeId,
    size: view.size,
    rooms: [...ROOMS],
    nodeCount: nodes.length,
    nodes: nodes.slice(0, 80),
    errors: _errors.slice(-5),
    hint: 'Select a node with node_get, then node_set or office_act.',
  };
}

function toolSceneTree() {
  const view = layout();
  const nodes = nodeList(view);
  const group = (kind) => nodes.filter((n) => n.kind === kind).map((n) => ({
    id: n.id, type: n.type, x: n.x, y: n.y,
  }));
  return {
    ok: true,
    tree: {
      id: 'office',
      type: 'scene',
      children: [
        { id: 'floor', type: 'layer' },
        { id: 'stations', type: 'group', children: group('station') },
        { id: 'decor', type: 'group', children: group('decor') },
        { id: 'items', type: 'group', children: group('item') },
      ],
    },
  };
}

function toolNodeGet(args) {
  const node = findNode(args?.id);
  if (!node) {
    noteError(`node not found: ${args?.id}`);
    return { ok: false, error: 'node not found', id: args?.id };
  }
  return { ok: true, node };
}

function toolNodeSet(args) {
  const node = findNode(args?.id);
  if (!node) {
    noteError(`node not found: ${args?.id}`);
    return { ok: false, error: 'node not found', id: args?.id };
  }
  const prev = { x: node.x, y: node.y, name: node.name };
  const next = { ...(_overlays.get(node.id) || {}) };
  if (args.x != null) next.x = Number(args.x);
  if (args.y != null) next.y = Number(args.y);
  if (args.name != null) next.name = String(args.name).slice(0, 40);
  if (node.kind === 'item' && (args.x != null || args.y != null)) {
    const x = args.x != null ? Number(args.x) : Number(node.x);
    const y = args.y != null ? Number(args.y) : Number(node.y);
    if (!inBounds(x, y)) {
      noteError('node_set out of bounds');
      return { ok: false, error: 'x/y out of bounds (16..1264, 16..704)' };
    }
  }
  const officeId = _deps.officeId || 'ceo-operator';
  if (node.kind === 'item' && typeof _deps.patchItem === 'function' && (next.x != null || next.y != null)) {
    try {
      _deps.patchItem(officeId, node.id, {
        x: next.x != null ? next.x : node.x,
        y: next.y != null ? next.y : node.y,
      });
    } catch (err) {
      noteError(err?.message || String(err));
      return { ok: false, error: err?.message || String(err) };
    }
  }
  _overlays.set(node.id, next);
  _undo.push({ op: 'node_set', id: node.id, prev, kind: node.kind });
  const updated = findNode(node.id);
  broadcast(engineCommand({
    command: 'node_set',
    id: node.id,
    x: updated.x,
    y: updated.y,
    name: updated.name,
  }));
  return { ok: true, node: updated };
}

function npcKeyFor(scope, args) {
  const raw = String(args?.npcKey || scope?.npc_key || '').trim();
  if (!raw) return null;
  return raw.startsWith('xp_') ? raw : `xp_${raw.replace(/^xp_/, '')}`;
}

function toolOfficeAct(scope, args) {
  const verb = String(args?.verb || '');
  if (!ACT_VERBS.includes(verb)) {
    noteError(`unknown verb: ${verb}`);
    return { ok: false, error: 'unknown verb', allowed: [...ACT_VERBS] };
  }
  const npcKey = npcKeyFor(scope, args);
  if (!npcKey) {
    noteError('office_act needs npcKey');
    return { ok: false, error: 'npcKey required' };
  }
  const payload = engineCommand({
    command: 'act',
    verb,
    npcKey,
    x: args?.x != null ? Number(args.x) : null,
    y: args?.y != null ? Number(args.y) : null,
    text: args?.text ? String(args.text).slice(0, 240) : '',
    room: args?.room ? String(args.room) : '',
    deskId: args?.deskId ? String(args.deskId) : '',
    targetKey: args?.targetKey ? String(args.targetKey) : '',
    emote: args?.emote ? String(args.emote).slice(0, 16) : '',
  });
  broadcast(payload);
  return { ok: true, dispatched: payload };
}

function inBounds(x, y) {
  return Number.isFinite(x) && Number.isFinite(y) && x >= 16 && y >= 16 && x <= 1264 && y <= 704;
}

function toolPlace(scope, args) {
  const prefabId = String(args?.prefabId || '');
  const x = Number(args?.x);
  const y = Number(args?.y);
  if (!ALLOWED_PREFABS.includes(prefabId)) {
    noteError(`prefab not allowed: ${prefabId}`);
    return { ok: false, error: 'prefabId not in whitelist', allowed: [...ALLOWED_PREFABS] };
  }
  if (!inBounds(x, y)) {
    noteError('place out of bounds');
    return { ok: false, error: 'x/y out of bounds (16..1264, 16..704)' };
  }
  const by = String(scope?.npc_key || 'mcp').slice(0, 40);
  const item = {
    instanceId: `npc_${prefabId}_${Date.now()}_${_placeSeq += 1}`,
    prefabId,
    x: Math.round(x),
    y: Math.round(y),
    placedBy: by,
    placedAt: Date.now(),
    reason: args?.reason ? String(args.reason).slice(0, 200) : null,
  };
  const officeId = _deps.officeId || 'ceo-operator';
  if (typeof _deps.appendItem === 'function') {
    try { _deps.appendItem(officeId, item); }
    catch (err) {
      noteError(err?.message || String(err));
      return { ok: false, error: err?.message || String(err) };
    }
  }
  _undo.push({ op: 'place', item });
  broadcast({ type: 'furniture_placed', item, by, office_id: officeId });
  return { ok: true, item };
}

function rawItem(instanceId) {
  return layout().items.find((it) => it.instanceId === instanceId) || null;
}

function toolRemove(args) {
  const instanceId = String(args?.instanceId || '');
  if (!instanceId.startsWith('npc_')) {
    noteError('only npc_ items can be removed');
    return { ok: false, error: 'only npc_ instanceIds can be removed' };
  }
  const existing = rawItem(instanceId);
  const officeId = _deps.officeId || 'ceo-operator';
  if (typeof _deps.removeItem === 'function') {
    const removed = _deps.removeItem(officeId, instanceId);
    if (!removed) {
      noteError(`item not in layout: ${instanceId}`);
      return { ok: false, error: 'item not found' };
    }
  }
  _overlays.delete(instanceId);
  if (existing) _undo.push({ op: 'remove', item: existing });
  broadcast({ type: 'furniture_removed', instanceId, office_id: officeId });
  return { ok: true, instanceId };
}

function toolSpriteCut(args) {
  const fw = Math.floor(Number(args?.frameWidth));
  const fh = Math.floor(Number(args?.frameHeight));
  const sw = Math.floor(Number(args?.sheetWidth));
  const sh = Math.floor(Number(args?.sheetHeight));
  if (!(fw > 0 && fh > 0 && sw >= fw && sh >= fh)) {
    noteError('sprite_cut sizes invalid');
    return { ok: false, error: 'frame and sheet sizes must be positive and frame must fit the sheet' };
  }
  const cols = Math.floor(sw / fw);
  const rows = Math.floor(sh / fh);
  const frames = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      frames.push({
        id: `${args?.name || 'frame'}_${r}_${c}`,
        index: r * cols + c,
        col: c,
        row: r,
        x: c * fw,
        y: r * fh,
        w: fw,
        h: fh,
      });
    }
  }
  return { ok: true, cols, rows, frameCount: frames.length, frames };
}

function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function toolAtlasPack(args) {
  const frames = Array.isArray(args?.frames) ? args.frames : [];
  const maxSize = Math.max(32, Math.min(4096, Number(args?.maxSize) || 1024));
  const padding = Math.max(0, Math.min(32, Number(args?.padding) || 1));
  if (!frames.length) return { ok: false, error: 'frames required' };
  let x = padding;
  let y = padding;
  let rowH = 0;
  let usedW = 0;
  let usedH = 0;
  const placed = [];
  for (const frame of frames) {
    const w = Math.floor(Number(frame?.w));
    const h = Math.floor(Number(frame?.h));
    if (!(w > 0 && h > 0)) {
      noteError('atlas frame missing size');
      return { ok: false, error: 'each frame needs w and h' };
    }
    if (x + w + padding > maxSize) {
      y += rowH;
      x = padding;
      rowH = 0;
    }
    if (y + h + padding > maxSize) {
      noteError('atlas page overflow');
      return { ok: false, error: `frames do not fit in ${maxSize}px`, placed };
    }
    placed.push({
      id: String(frame.id || `f${placed.length}`),
      x, y, w, h,
    });
    x += w + padding;
    rowH = Math.max(rowH, h + padding);
    usedW = Math.max(usedW, x);
    usedH = Math.max(usedH, y + h + padding);
  }
  return {
    ok: true,
    width: nextPow2(usedW),
    height: nextPow2(usedH),
    maxSize,
    frames: placed,
  };
}

function toolUndo() {
  const entry = _undo.pop();
  if (!entry) return { ok: false, error: 'nothing to undo' };
  const officeId = _deps.officeId || 'ceo-operator';
  if (entry.op === 'node_set') {
    _overlays.set(entry.id, { ...entry.prev });
    if (entry.kind === 'item' && typeof _deps.patchItem === 'function') {
      try { _deps.patchItem(officeId, entry.id, { x: entry.prev.x, y: entry.prev.y }); }
      catch (err) { noteError(err?.message || String(err)); }
    }
    const node = findNode(entry.id);
    broadcast(engineCommand({
      command: 'node_set',
      id: entry.id,
      x: entry.prev.x,
      y: entry.prev.y,
      name: entry.prev.name,
    }));
    return { ok: true, undone: 'node_set', node };
  }
  if (entry.op === 'place') {
    if (typeof _deps.removeItem === 'function') {
      try { _deps.removeItem(officeId, entry.item.instanceId); } catch (err) { noteError(err?.message || String(err)); }
    }
    broadcast({ type: 'furniture_removed', instanceId: entry.item.instanceId, office_id: officeId });
    return { ok: true, undone: 'place', instanceId: entry.item.instanceId };
  }
  if (entry.op === 'remove' && entry.item) {
    const restore = _deps.restoreItem || _deps.appendItem;
    if (typeof restore === 'function') {
      try { restore(officeId, entry.item); }
      catch (err) {
        noteError(err?.message || String(err));
        _undo.push(entry);
        return { ok: false, error: err?.message || String(err) };
      }
    }
    broadcast({ type: 'furniture_placed', item: entry.item, by: entry.item.placedBy || 'mcp', office_id: officeId });
    return { ok: true, undone: 'remove', item: entry.item };
  }
  return { ok: true, undone: entry.op };
}

function toolErrors(args) {
  const limit = Math.max(1, Math.min(40, Number(args?.limit) || 10));
  return { ok: true, errors: _errors.slice(-limit) };
}

function isEngineTool(name) {
  return TOOL_DEFINITIONS.some((t) => t.name === name);
}

function callTool(scope, name, args) {
  switch (name) {
    case 'office_look': return toolOfficeLook();
    case 'scene_tree': return toolSceneTree();
    case 'node_get': return toolNodeGet(args);
    case 'node_set': return toolNodeSet(args);
    case 'office_act': return toolOfficeAct(scope, args);
    case 'office_place_furniture': return toolPlace(scope, args);
    case 'office_remove_furniture': return toolRemove(args);
    case 'sprite_cut': return toolSpriteCut(args);
    case 'atlas_pack': return toolAtlasPack(args);
    case 'edit_undo': return toolUndo();
    case 'office_errors': return toolErrors(args);
    default: return { ok: false, error: `unknown engine tool: ${name}` };
  }
}

module.exports = {
  TOOL_DEFINITIONS,
  ALLOWED_PREFABS,
  ACT_VERBS,
  configure,
  resetForTests,
  isEngineTool,
  callTool,
  spriteCut: toolSpriteCut,
  atlasPack: toolAtlasPack,
};
