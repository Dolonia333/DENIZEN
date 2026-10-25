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
    description: 'Inspector view of one office: rooms, furniture, where each person is standing, the last line they said, and your own recent errors. Call this before moving or placing anything.',
    inputSchema: {
      type: 'object',
      properties: {
        officeId: { type: 'string', description: 'Office id. Defaults to the CEO office.' },
      },
    },
  },
  {
    name: 'scene_tree',
    description: 'Scene dock: the office as a tree of nodes (floor, stations, decor, placed furniture).',
    inputSchema: {
      type: 'object',
      properties: {
        officeId: { type: 'string', description: 'Office id. Defaults to the CEO office.' },
      },
    },
  },
  {
    name: 'node_get',
    description: 'Read one node by id (station, decor, or placed item).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Node id or instanceId' },
        officeId: { type: 'string', description: 'Office id. Defaults to the CEO office.' },
      },
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
        officeId: { type: 'string', description: 'Office id. Defaults to the CEO office.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'office_act',
    description: 'Play a character on the live floor: walk, speak, sit, stand, go to a room, emote, or think. Returns whether a client is connected and whether the sprite was found. Pass npcKey when you are on the team connection.',
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
        officeId: { type: 'string', description: 'Office id. Defaults to the CEO office.' },
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
        officeId: { type: 'string', description: 'Office id. Defaults to the CEO office.' },
      },
      required: ['prefabId', 'x', 'y'],
    },
  },
  {
    name: 'office_remove_furniture',
    description: 'Remove one NPC-placed item (instanceId starts with npc_).',
    inputSchema: {
      type: 'object',
      properties: {
        instanceId: { type: 'string' },
        officeId: { type: 'string', description: 'Office id. Defaults to the CEO office.' },
      },
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
    description: 'Undo your last node edit, furniture placement, or removal in this office. Another agent’s edits stay put.',
    inputSchema: {
      type: 'object',
      properties: {
        officeId: { type: 'string', description: 'Office id. Defaults to the CEO office.' },
      },
    },
  },
  {
    name: 'office_errors',
    description: 'Debugger: recent engine-tool errors.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
        officeId: { type: 'string', description: 'Office id. Defaults to the CEO office.' },
      },
    },
  },
];

let _deps = {};
let _placeSeq = 0;
const _buckets = new Map();
const _pending = new Map();
const _floorResults = new Map();

const FLOOR_TOOLS = Object.freeze([
  'office_look', 'scene_tree', 'node_get', 'office_act', 'office_place_furniture', 'edit_undo',
]);

function configure(deps = {}) {
  _deps = deps || {};
}

function resetForTests() {
  _deps = {};
  _placeSeq = 0;
  _buckets.clear();
  for (const pending of _pending.values()) clearTimeout(pending.timer);
  _pending.clear();
  _floorResults.clear();
}

function actorKey(scope) {
  return String(scope?.npc_key || 'mcp').slice(0, 40);
}

function officeFor(args) {
  const raw = String(args?.officeId || args?.office_id || _deps.officeId || 'ceo-operator').trim();
  const safe = raw.replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 80);
  return safe || 'ceo-operator';
}

function stateFor(scope, officeId) {
  const key = `${officeId}|${actorKey(scope)}`;
  let bucket = _buckets.get(key);
  if (!bucket) {
    bucket = { undo: [], errors: [], overlays: new Map(), lastAct: null };
    _buckets.set(key, bucket);
  }
  return bucket;
}

function engineCommand(fields, officeId) {
  const id = officeId || _deps.officeId || 'ceo-operator';
  return { type: 'engine_command', office_id: id, officeId: id, ...fields };
}

function noteError(bucket, message) {
  if (!bucket) return;
  bucket.errors.push({ message: String(message), ts: Date.now() });
  if (bucket.errors.length > 40) bucket.errors.shift();
}

function broadcast(msg, bucket) {
  if (typeof _deps.broadcast !== 'function') return;
  try { _deps.broadcast(msg); } catch (err) { noteError(bucket, err?.message || String(err)); }
}

function rememberFloor(commandId, result) {
  if (!commandId) return;
  _floorResults.set(commandId, { ...result, at: Date.now() });
  while (_floorResults.size > 50) {
    const oldest = _floorResults.keys().next().value;
    _floorResults.delete(oldest);
  }
}

function waitForFloor(commandId, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      _pending.delete(commandId);
      resolve(null);
    }, timeoutMs);
    _pending.set(commandId, {
      timer,
      resolve: (result) => {
        clearTimeout(timer);
        _pending.delete(commandId);
        resolve(result);
      },
    });
  });
}

function settleFloor(commandId, result) {
  const body = result && typeof result === 'object' ? result : { ok: false };
  rememberFloor(commandId, body);
  const pending = _pending.get(String(commandId || ''));
  if (!pending) return false;
  pending.resolve(body);
  return true;
}

function layout(officeId, bucket) {
  let raw = null;
  try {
    raw = typeof _deps.readLayout === 'function' ? _deps.readLayout(officeId) : null;
  } catch (err) {
    noteError(bucket, err?.message || String(err));
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

function nodeList(view, overlays) {
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
  if (overlays) {
    for (const [id, over] of overlays) {
      const hit = nodes.find((n) => n.id === id);
      if (hit) Object.assign(hit, over, { id });
    }
  }
  return nodes;
}

function findNode(id, officeId, bucket) {
  const key = String(id || '').trim();
  return nodeList(layout(officeId, bucket), bucket?.overlays).find((n) => n.id === key) || null;
}

function freshLastAct(bucket) {
  const act = bucket?.lastAct;
  if (!act?.commandId) return act || null;
  const latest = _floorResults.get(act.commandId);
  if (!latest) return act;
  return { ...act, floor: latest, stage: latest.stage || act.stage };
}

function toolOfficeLook(scope, args) {
  const officeId = officeFor(args);
  const bucket = stateFor(scope, officeId);
  const view = layout(officeId, bucket);
  const nodes = nodeList(view, bucket.overlays);
  let people = [];
  let players = [];
  if (typeof _deps.readPeople === 'function') {
    try {
      const snap = _deps.readPeople(officeId) || {};
      people = Array.isArray(snap.people) ? snap.people.slice(0, 40) : [];
      players = Array.isArray(snap.players) ? snap.players.slice(0, 20) : [];
    } catch (err) {
      noteError(bucket, err?.message || String(err));
    }
  }
  broadcast(engineCommand({ command: 'look' }, officeId), bucket);
  return {
    ok: true,
    officeId,
    size: view.size,
    rooms: [...ROOMS],
    nodeCount: nodes.length,
    nodes: nodes.slice(0, 80),
    people,
    players,
    lastAct: freshLastAct(bucket),
    errors: bucket.errors.slice(-5),
    floorTools: [...FLOOR_TOOLS],
    hint: 'People are in `people`. Select a node with node_get, then node_set or office_act.',
  };
}

function toolSceneTree(scope, args) {
  const officeId = officeFor(args);
  const bucket = stateFor(scope, officeId);
  const view = layout(officeId, bucket);
  const nodes = nodeList(view, bucket.overlays);
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

function toolNodeGet(scope, args) {
  const officeId = officeFor(args);
  const bucket = stateFor(scope, officeId);
  const node = findNode(args?.id, officeId, bucket);
  if (!node) {
    noteError(bucket, `node not found: ${args?.id}`);
    return { ok: false, error: 'node not found', id: args?.id, officeId };
  }
  return { ok: true, officeId, node };
}

function toolNodeSet(scope, args) {
  const officeId = officeFor(args);
  const bucket = stateFor(scope, officeId);
  const node = findNode(args?.id, officeId, bucket);
  if (!node) {
    noteError(bucket, `node not found: ${args?.id}`);
    return { ok: false, error: 'node not found', id: args?.id, officeId };
  }
  const prev = { x: node.x, y: node.y, name: node.name };
  const next = { ...(bucket.overlays.get(node.id) || {}) };
  if (args.x != null) next.x = Number(args.x);
  if (args.y != null) next.y = Number(args.y);
  if (args.name != null) next.name = String(args.name).slice(0, 40);
  if (node.kind === 'item' && (args.x != null || args.y != null)) {
    const x = args.x != null ? Number(args.x) : Number(node.x);
    const y = args.y != null ? Number(args.y) : Number(node.y);
    if (!inBounds(x, y)) {
      noteError(bucket, 'node_set out of bounds');
      return { ok: false, error: 'x/y out of bounds (16..1264, 16..704)' };
    }
  }
  if (node.kind === 'item' && typeof _deps.patchItem === 'function' && (next.x != null || next.y != null)) {
    try {
      _deps.patchItem(officeId, node.id, {
        x: next.x != null ? next.x : node.x,
        y: next.y != null ? next.y : node.y,
      });
    } catch (err) {
      noteError(bucket, err?.message || String(err));
      return { ok: false, error: err?.message || String(err) };
    }
  }
  bucket.overlays.set(node.id, next);
  bucket.undo.push({ op: 'node_set', id: node.id, prev, kind: node.kind });
  const updated = findNode(node.id, officeId, bucket);
  const commandId = `eng_${Date.now()}_${_placeSeq += 1}`;
  broadcast(engineCommand({
    command: 'node_set',
    commandId,
    id: node.id,
    x: updated.x,
    y: updated.y,
    name: updated.name,
  }, officeId), bucket);
  return { ok: true, officeId, commandId, node: updated };
}

function npcKeyFor(scope, args) {
  const explicit = String(args?.npcKey || '').trim();
  const fallback = String(scope?.npc_key || '').trim();
  const raw = explicit || (fallback.startsWith('_') ? '' : fallback);
  if (!raw) return null;
  return raw.startsWith('xp_') ? raw : `xp_${raw.replace(/^xp_/, '')}`;
}

async function toolOfficeAct(scope, args) {
  const officeId = officeFor(args);
  const bucket = stateFor(scope, officeId);
  const verb = String(args?.verb || '');
  if (!ACT_VERBS.includes(verb)) {
    noteError(bucket, `unknown verb: ${verb}`);
    return { ok: false, error: 'unknown verb', allowed: [...ACT_VERBS] };
  }
  const npcKey = npcKeyFor(scope, args);
  if (!npcKey) {
    noteError(bucket, 'office_act needs npcKey');
    return { ok: false, error: 'npcKey required' };
  }
  const commandId = `eng_${Date.now()}_${_placeSeq += 1}`;
  const payload = engineCommand({
    command: 'act',
    commandId,
    verb,
    npcKey,
    x: args?.x != null ? Number(args.x) : null,
    y: args?.y != null ? Number(args.y) : null,
    text: args?.text ? String(args.text).slice(0, 240) : '',
    room: args?.room ? String(args.room) : '',
    deskId: args?.deskId ? String(args.deskId) : '',
    targetKey: args?.targetKey ? String(args.targetKey) : '',
    emote: args?.emote ? String(args.emote).slice(0, 16) : '',
  }, officeId);
  const clients = typeof _deps.countClients === 'function' ? Number(_deps.countClients(officeId)) || 0 : null;
  const pending = clients ? waitForFloor(commandId, 1500) : null;
  broadcast(payload, bucket);
  if (clients === 0) {
    const result = { ok: false, error: 'no office client connected', commandId, clients: 0, officeId };
    bucket.lastAct = { commandId, verb, npcKey, stage: 'no_client', officeId };
    return result;
  }
  const floor = pending ? await pending : null;
  if (clients && !floor) {
    const result = {
      ok: false,
      error: 'office client did not answer',
      commandId,
      clients,
      officeId,
      dispatched: true,
    };
    bucket.lastAct = { commandId, verb, npcKey, stage: 'no_answer', officeId };
    return result;
  }
  const stage = floor?.stage || 'dispatched';
  const missing = stage === 'missing_sprite';
  const failed = floor && floor.ok === false;
  bucket.lastAct = { commandId, verb, npcKey, stage, officeId, floor: floor || null };
  return {
    ok: !missing && !failed,
    commandId,
    clients,
    officeId,
    floor: floor || null,
    dispatched: payload,
    error: missing ? 'sprite not in the office' : (failed ? (floor.error || 'act failed') : undefined),
  };
}

function inBounds(x, y) {
  return Number.isFinite(x) && Number.isFinite(y) && x >= 16 && y >= 16 && x <= 1264 && y <= 704;
}

function toolPlace(scope, args) {
  const officeId = officeFor(args);
  const bucket = stateFor(scope, officeId);
  const prefabId = String(args?.prefabId || '');
  const x = Number(args?.x);
  const y = Number(args?.y);
  if (!ALLOWED_PREFABS.includes(prefabId)) {
    noteError(bucket, `prefab not allowed: ${prefabId}`);
    return { ok: false, error: 'prefabId not in whitelist', allowed: [...ALLOWED_PREFABS] };
  }
  if (!inBounds(x, y)) {
    noteError(bucket, 'place out of bounds');
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
  if (typeof _deps.appendItem === 'function') {
    try { _deps.appendItem(officeId, item); }
    catch (err) {
      noteError(bucket, err?.message || String(err));
      return { ok: false, error: err?.message || String(err) };
    }
  }
  bucket.undo.push({ op: 'place', item });
  broadcast({ type: 'furniture_placed', item, by, office_id: officeId }, bucket);
  return { ok: true, officeId, item };
}

function rawItem(instanceId, officeId, bucket) {
  return layout(officeId, bucket).items.find((it) => it.instanceId === instanceId) || null;
}

function toolRemove(scope, args) {
  const officeId = officeFor(args);
  const bucket = stateFor(scope, officeId);
  const instanceId = String(args?.instanceId || '');
  if (!instanceId.startsWith('npc_')) {
    noteError(bucket, 'only npc_ items can be removed');
    return { ok: false, error: 'only npc_ instanceIds can be removed' };
  }
  const existing = rawItem(instanceId, officeId, bucket);
  if (typeof _deps.removeItem === 'function') {
    const removed = _deps.removeItem(officeId, instanceId);
    if (!removed) {
      noteError(bucket, `item not in layout: ${instanceId}`);
      return { ok: false, error: 'item not found' };
    }
  }
  bucket.overlays.delete(instanceId);
  if (existing) bucket.undo.push({ op: 'remove', item: existing });
  broadcast({ type: 'furniture_removed', instanceId, office_id: officeId }, bucket);
  return { ok: true, officeId, instanceId };
}

function toolSpriteCut(scope, args) {
  const bucket = stateFor(scope, officeFor(args));
  const fw = Math.floor(Number(args?.frameWidth));
  const fh = Math.floor(Number(args?.frameHeight));
  const sw = Math.floor(Number(args?.sheetWidth));
  const sh = Math.floor(Number(args?.sheetHeight));
  if (!(fw > 0 && fh > 0 && sw >= fw && sh >= fh)) {
    noteError(bucket, 'sprite_cut sizes invalid');
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

function toolAtlasPack(scope, args) {
  const bucket = stateFor(scope, officeFor(args));
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
      noteError(bucket, 'atlas frame missing size');
      return { ok: false, error: 'each frame needs w and h' };
    }
    if (x + w + padding > maxSize) {
      y += rowH;
      x = padding;
      rowH = 0;
    }
    if (y + h + padding > maxSize) {
      noteError(bucket, 'atlas page overflow');
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

function toolUndo(scope, args) {
  const officeId = officeFor(args);
  const bucket = stateFor(scope, officeId);
  const entry = bucket.undo.pop();
  if (!entry) return { ok: false, error: 'nothing to undo', officeId };
  if (entry.op === 'node_set') {
    bucket.overlays.set(entry.id, { ...entry.prev });
    if (entry.kind === 'item' && typeof _deps.patchItem === 'function') {
      try { _deps.patchItem(officeId, entry.id, { x: entry.prev.x, y: entry.prev.y }); }
      catch (err) { noteError(bucket, err?.message || String(err)); }
    }
    const node = findNode(entry.id, officeId, bucket);
    broadcast(engineCommand({
      command: 'node_set',
      id: entry.id,
      x: entry.prev.x,
      y: entry.prev.y,
      name: entry.prev.name,
    }, officeId), bucket);
    return { ok: true, undone: 'node_set', officeId, node };
  }
  if (entry.op === 'place') {
    if (typeof _deps.removeItem === 'function') {
      try { _deps.removeItem(officeId, entry.item.instanceId); } catch (err) { noteError(bucket, err?.message || String(err)); }
    }
    broadcast({ type: 'furniture_removed', instanceId: entry.item.instanceId, office_id: officeId }, bucket);
    return { ok: true, undone: 'place', officeId, instanceId: entry.item.instanceId };
  }
  if (entry.op === 'remove' && entry.item) {
    const restore = _deps.restoreItem || _deps.appendItem;
    if (typeof restore === 'function') {
      try { restore(officeId, entry.item); }
      catch (err) {
        noteError(bucket, err?.message || String(err));
        bucket.undo.push(entry);
        return { ok: false, error: err?.message || String(err) };
      }
    }
    broadcast({ type: 'furniture_placed', item: entry.item, by: entry.item.placedBy || 'mcp', office_id: officeId }, bucket);
    return { ok: true, undone: 'remove', officeId, item: entry.item };
  }
  return { ok: true, undone: entry.op, officeId };
}

function toolErrors(scope, args) {
  const bucket = stateFor(scope, officeFor(args));
  const limit = Math.max(1, Math.min(40, Number(args?.limit) || 10));
  return { ok: true, errors: bucket.errors.slice(-limit) };
}

function isEngineTool(name) {
  return TOOL_DEFINITIONS.some((t) => t.name === name);
}

function callTool(scope, name, args) {
  switch (name) {
    case 'office_look': return toolOfficeLook(scope, args);
    case 'scene_tree': return toolSceneTree(scope, args);
    case 'node_get': return toolNodeGet(scope, args);
    case 'node_set': return toolNodeSet(scope, args);
    case 'office_act': return toolOfficeAct(scope, args);
    case 'office_place_furniture': return toolPlace(scope, args);
    case 'office_remove_furniture': return toolRemove(scope, args);
    case 'sprite_cut': return toolSpriteCut(scope, args);
    case 'atlas_pack': return toolAtlasPack(scope, args);
    case 'edit_undo': return toolUndo(scope, args);
    case 'office_errors': return toolErrors(scope, args);
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
  settleFloor,
  FLOOR_TOOLS,
  spriteCut: toolSpriteCut,
  atlasPack: toolAtlasPack,
};
