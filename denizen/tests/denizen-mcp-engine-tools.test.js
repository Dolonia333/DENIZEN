'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const engine = require('../src/denizen-mcp-engine-tools');
const scopes = require('../src/denizen-mcp-scopes');

const SCOPE = { npc_key: 'lucy' };

function memoryOffice() {
  const items = [];
  const sent = [];
  const layout = {
    size: { width: 40, height: 23 },
    stations: [{ id: 'desk_lucy', type: 'desk', x: 200, y: 180, name: 'Lucy' }],
    decor: [{ id: 'plant_1', type: 'plant', x: 40, y: 40 }],
    items,
  };
  engine.configure({
    officeId: 'ceo-operator',
    readLayout: () => layout,
    appendItem: (_officeId, item) => { items.push(item); },
    removeItem: (_officeId, instanceId) => {
      const idx = items.findIndex((it) => it.instanceId === instanceId);
      if (idx === -1) return null;
      items.splice(idx, 1);
      return items;
    },
    restoreItem: (_officeId, item) => { items.push(item); },
    patchItem: (_officeId, instanceId, patch) => {
      const item = items.find((it) => it.instanceId === instanceId);
      if (!item) throw new Error('item not found');
      if (patch.x != null) item.x = patch.x;
      if (patch.y != null) item.y = patch.y;
      return item;
    },
    broadcast: (msg) => { sent.push(msg); },
  });
  return { layout, items, sent };
}

describe('denizen-mcp-engine-tools', () => {
  beforeEach(() => {
    engine.resetForTests();
  });

  it('look and scene_tree show stations, decor, and rooms', () => {
    const { sent } = memoryOffice();
    const look = engine.callTool(SCOPE, 'office_look', {});
    assert.equal(look.ok, true);
    assert.equal(look.officeId, 'ceo-operator');
    assert.ok(look.rooms.includes('conference'));
    assert.equal(look.nodeCount, 2);
    assert.equal(sent[0].type, 'engine_command');
    assert.equal(sent[0].command, 'look');
    assert.equal(sent[0].office_id, 'ceo-operator');

    const tree = engine.callTool(SCOPE, 'scene_tree', {});
    assert.equal(tree.tree.id, 'office');
    assert.equal(tree.tree.children.find((n) => n.id === 'stations').children.length, 1);
  });

  it('node_get then node_set overlays a station and undo restores it', () => {
    const { sent } = memoryOffice();
    const got = engine.callTool(SCOPE, 'node_get', { id: 'desk_lucy' });
    assert.equal(got.node.name, 'Lucy');
    const moved = engine.callTool(SCOPE, 'node_set', { id: 'desk_lucy', x: 220, name: 'Lucy desk' });
    assert.equal(moved.ok, true);
    assert.equal(moved.node.x, 220);
    assert.equal(moved.node.name, 'Lucy desk');
    assert.equal(sent.at(-1).command, 'node_set');
    const again = engine.callTool(SCOPE, 'node_get', { id: 'desk_lucy' });
    assert.equal(again.node.x, 220);
    const undone = engine.callTool(SCOPE, 'edit_undo', {});
    assert.equal(undone.undone, 'node_set');
    assert.equal(engine.callTool(SCOPE, 'node_get', { id: 'desk_lucy' }).node.x, 200);
  });

  it('office_act dispatches a known verb for the connected npc', () => {
    const { sent } = memoryOffice();
    const bad = engine.callTool(SCOPE, 'office_act', { verb: 'fly' });
    assert.equal(bad.ok, false);
    const act = engine.callTool(SCOPE, 'office_act', { verb: 'goToRoom', room: 'breakroom' });
    assert.equal(act.ok, true);
    assert.equal(act.dispatched.verb, 'goToRoom');
    assert.equal(act.dispatched.npcKey, 'xp_lucy');
    assert.equal(act.dispatched.room, 'breakroom');
    assert.equal(act.dispatched.type, 'engine_command');
    assert.equal(sent.at(-1).command, 'act');
  });

  it('place enforces the prefab whitelist and pixel bounds', () => {
    const { items, sent } = memoryOffice();
    const denied = engine.callTool(SCOPE, 'office_place_furniture', { prefabId: 'throne', x: 100, y: 100 });
    assert.equal(denied.ok, false);
    const outside = engine.callTool(SCOPE, 'office_place_furniture', { prefabId: 'plant_small', x: 2, y: 100 });
    assert.equal(outside.ok, false);
    const placed = engine.callTool(SCOPE, 'office_place_furniture', {
      prefabId: 'plant_small', x: 100, y: 120, reason: 'corner',
    });
    assert.equal(placed.ok, true);
    assert.ok(placed.item.instanceId.startsWith('npc_plant_small_'));
    assert.equal(items.length, 1);
    assert.equal(sent.at(-1).type, 'furniture_placed');
    const undone = engine.callTool(SCOPE, 'edit_undo', {});
    assert.equal(undone.undone, 'place');
    assert.equal(items.length, 0);
    assert.equal(sent.at(-1).type, 'furniture_removed');
  });

  it('remove then undo puts the item back', () => {
    const { items } = memoryOffice();
    const placed = engine.callTool(SCOPE, 'office_place_furniture', { prefabId: 'couch', x: 300, y: 300 });
    const removed = engine.callTool(SCOPE, 'office_remove_furniture', { instanceId: placed.item.instanceId });
    assert.equal(removed.ok, true);
    assert.equal(items.length, 0);
    const undone = engine.callTool(SCOPE, 'edit_undo', {});
    assert.equal(undone.undone, 'remove');
    assert.equal(items.length, 1);
    assert.equal(items[0].instanceId, placed.item.instanceId);
  });

  it('refuses to remove scene furniture', () => {
    memoryOffice();
    const result = engine.callTool(SCOPE, 'office_remove_furniture', { instanceId: 'desk_lucy' });
    assert.equal(result.ok, false);
  });

  it('sprite_cut returns a grid', () => {
    const cut = engine.callTool(SCOPE, 'sprite_cut', {
      frameWidth: 32, frameHeight: 48, sheetWidth: 64, sheetHeight: 96, name: 'walk',
    });
    assert.equal(cut.ok, true);
    assert.equal(cut.cols, 2);
    assert.equal(cut.rows, 2);
    assert.equal(cut.frameCount, 4);
    assert.equal(cut.frames[3].id, 'walk_1_1');
    assert.equal(cut.frames[3].x, 32);
    assert.equal(cut.frames[3].y, 48);
  });

  it('atlas_pack shelf-packs onto a power-of-two page', () => {
    const packed = engine.callTool(SCOPE, 'atlas_pack', {
      maxSize: 64,
      padding: 1,
      frames: [
        { id: 'a', w: 30, h: 10 },
        { id: 'b', w: 30, h: 10 },
        { id: 'c', w: 30, h: 10 },
      ],
    });
    assert.equal(packed.ok, true);
    assert.equal(packed.width, 64);
    assert.equal(packed.height, 32);
    assert.equal(packed.frames[0].x, 1);
    assert.ok(packed.frames[2].y > packed.frames[0].y);
    const overflow = engine.callTool(SCOPE, 'atlas_pack', {
      maxSize: 32,
      frames: [{ id: 'big', w: 40, h: 40 }],
    });
    assert.equal(overflow.ok, false);
  });

  it('records a missing node on the debugger', () => {
    memoryOffice();
    const missing = engine.callTool(SCOPE, 'node_get', { id: 'nope' });
    assert.equal(missing.ok, false);
    const errors = engine.callTool(SCOPE, 'office_errors', { limit: 5 });
    assert.match(errors.errors.at(-1).message, /nope/);
  });

  it('the live office listens for engine_command and can move a sprite', () => {
    const root = path.join(__dirname, '..');
    const manager = fs.readFileSync(path.join(root, 'src/agent-office-manager.js'), 'utf8');
    const scene = fs.readFileSync(path.join(root, 'office-scene.js'), 'utf8');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.match(manager, /case 'engine_command':/);
    assert.match(manager, /this\.actions\.goToRoom\(npcKey, msg\.room \|\| 'open_office'\)/);
    assert.match(manager, /this\.actions\.walkTo\(npcKey, Number\(msg\.x\), Number\(msg\.y\)\)/);
    assert.match(scene, /move\(instanceId, x, y\)/);
    assert.match(html, /agent-office-manager\.js\?v=engineTools1/);
    assert.match(html, /office-scene\.js\?v=engineTools1/);
  });

  it('scopes match the editor docks', () => {
    assert.equal(scopes.requiredScope('office_look'), 'read');
    assert.equal(scopes.requiredScope('sprite_cut'), 'skills');
    assert.equal(scopes.requiredScope('office_act'), 'delegate');
    assert.equal(scopes.toolAllowed({ scopes: ['read'] }, 'office_look'), true);
    assert.equal(scopes.toolAllowed({ scopes: ['read'] }, 'office_place_furniture'), false);
    assert.equal(scopes.toolAllowed({ scopes: ['read', 'skills'] }, 'atlas_pack'), true);
  });
});
