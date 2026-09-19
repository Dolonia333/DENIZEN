'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mutations = require('../src/denizen-studio-board-mutations');
const workspaceAccess = require('../src/denizen-workspace-access');

const htmlPath = path.join(__dirname, '..', 'studio-board', 'index.html');
const routesPath = path.join(__dirname, '..', 'src', 'denizen-studio-board-routes.js');

describe('studio board my day home + populate', () => {
  it('defaults logged-in users to My Day', () => {
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.match(html, /function initialBoardView\s*\(/);
    assert.match(html, /readVisitorSession\(\)\)\s*return\s*'myday'/);
    assert.match(html, /view:initialBoardView\(\)/);
  });

  it('guards dayDiff when due is missing', () => {
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.match(html, /function dayDiff\(due\)\{[\s\S]*?if\(!due\) return Infinity;/);
    assert.match(html, /const later=mine\.filter\(t=>!t\.due \|\| dayDiff\(t\.due\)>0\)/);
  });

  it('enriches Mine aliases with roster person id', () => {
    const routes = fs.readFileSync(routesPath, 'utf8');
    assert.match(routes, /actor\.aliases/);
    assert.match(routes, /findPerson\(state/);
  });

  it('personHint matches email and identityId', () => {
    const state = {
      people: [
        { id: 'p_1', name: 'Zion Van Zandt', email: 'zion@example.com', identityId: 'id_zion' },
      ],
      tasks: [],
      config: { stages: [{ id: 'todo', final: false }] },
    };
    assert.equal(mutations.personHint(state, { email: 'zion@example.com' }).id, 'p_1');
    assert.equal(mutations.personHint(state, { identityId: 'id_zion' }).id, 'p_1');
    assert.equal(mutations.personHint(state, { displayName: 'Zion Van Zandt' }).id, 'p_1');
  });

  it('Mine scope includes tasks assigned by person id when aliases include id', () => {
    const actor = {
      email: 'zion@example.com',
      displayName: 'Zion',
      aliases: ['p_1', 'zion@example.com'],
    };
    const aliases = workspaceAccess.buildActorAliases(actor, { fuzzyName: true });
    assert.ok(aliases.exact.includes('p_1'));
    const tasks = [
      { id: 't1', title: 'Mine', assignee: 'p_1', ownerIdentityId: 'someone-else' },
      { id: 't2', title: 'Other', assignee: 'p_2', ownerIdentityId: 'someone-else' },
    ];
    const mine = workspaceAccess.filterRecords(tasks, 'own', actor, [
      'ownerIdentityId', 'ownerId', 'assignee',
    ]);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].id, 't1');
  });
});
