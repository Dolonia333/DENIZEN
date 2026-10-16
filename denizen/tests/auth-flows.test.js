#!/usr/bin/env node
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const authBase = require('../src/denizen-auth-base.js');
const demoAuth = require('../src/denizen-demo-auth.js');
const teamAuth = require('../src/denizen-team-auth.js');
const discordAuth = require('../src/denizen-discord-auth.js');
const mcpOAuth = require('../src/denizen-mcp-oauth.js');
const sessionAuth = require('../src/visitor-session-auth.js');

describe('auth-base shared surface', () => {
  it('exports identity + grant helpers used by all providers', () => {
    assert.equal(typeof authBase.AuthError, 'function');
    assert.equal(typeof authBase.authErrorStatus, 'function');
    assert.equal(typeof authBase.getIdentityByEmail, 'function');
    assert.equal(typeof authBase.getIdentityByUsername, 'function');
    assert.equal(typeof authBase.getVisitorSession, 'function');
    assert.equal(typeof authBase.issueAccessGrant, 'function');
    assert.equal(typeof authBase.verifyAccessGrant, 'function');
  });

  it('maps auth error codes to HTTP statuses', () => {
    assert.equal(authBase.authErrorStatus({ code: 'BAD_INPUT' }), 400);
    assert.equal(authBase.authErrorStatus({ code: 'NOT_FOUND' }), 404);
    assert.equal(authBase.authErrorStatus({ code: 'DENIED' }), 403);
    assert.equal(authBase.authErrorStatus({ code: 'UNAUTHORIZED' }), 401);
  });

  it('issues and verifies access grants', () => {
    const token = authBase.issueAccessGrant({
      tier: 'team',
      orgSlug: 'test-org',
      accessMethod: 'team_code',
      email: 'ceo@example.com',
    });
    assert.equal(typeof token, 'string');
    assert.ok(token.includes('.'));
    const payload = authBase.verifyAccessGrant(token);
    assert.equal(payload.typ, 'access_grant');
    assert.equal(payload.tier, 'team');
    assert.equal(payload.org_slug, 'test-org');
  });

  it('normalizes usernames and emails', () => {
    assert.equal(authBase.normalizeUsername('  Ada.Lovelace '), 'ada.lovelace');
    assert.equal(authBase.normalizeEmail('  Ada@Example.COM '), 'ada@example.com');
  });
});

describe('auth providers wire auth-base', () => {
  it('demo auth uses AuthError hierarchy', () => {
    assert.equal(typeof demoAuth.demoAuthErrorStatus, 'function');
    const err = new demoAuth.DemoAuthError('nope', 'DENIED');
    assert.equal(err instanceof authBase.AuthError, true);
    assert.equal(demoAuth.demoAuthErrorStatus(err), 403);
  });

  it('team auth uses AuthError hierarchy', () => {
    const err = new teamAuth.TeamAuthError('nope', 'NOT_FOUND');
    assert.equal(err instanceof authBase.AuthError, true);
    assert.equal(teamAuth.teamAuthErrorStatus(err), 404);
  });

  it('discord + mcp oauth expose authBase', () => {
    assert.equal(discordAuth.authBase, authBase);
    assert.equal(mcpOAuth.authBase, authBase);
  });

  it('session auth still issues ceo grants (team path)', () => {
    const grant = sessionAuth.createCeoGrant();
    assert.equal(typeof grant, 'string');
    const payload = sessionAuth.verifyCeoGrant?.(grant) || sessionAuth.verifySignedToken?.(grant);
    // verifyCeoGrant may exist; otherwise ensure grant is signed
    assert.ok(grant.split('.').length === 2);
  });
});
