'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const denizenDb = require('../src/denizen-db');
const teamAuth = require('../src/denizen-team-auth');

describe('denizen-team-auth login helpers', () => {
  it('detects email-shaped usernames', () => {
    assert.equal(teamAuth.looksLikeEmail('info@royalsocietymanagement.com'), true);
    assert.equal(teamAuth.looksLikeEmail('kizer'), false);
    assert.equal(teamAuth.looksLikeEmail('look at this media'), false);
  });

  it('normalizes usernames with spaces', () => {
    assert.equal(teamAuth.normalizeUsername('Look At This Media'), 'look at this media');
    assert.equal(teamAuth.normalizeUsername('  Kizer '), 'kizer');
  });
});

describe('findTeamAccount prefers email over username', () => {
  let origGet;

  beforeEach(() => {
    origGet = denizenDb._get;
  });

  afterEach(() => {
    denizenDb._get = origGet;
  });

  it('returns the email match even when a different username also exists', async () => {
    const emailRow = {
      id: 'a-email',
      org_id: 'org-1',
      email: 'info@royalsocietymanagement.com',
      username: 'kizer',
    };
    const userRow = {
      id: 'a-user',
      org_id: 'org-1',
      email: 'other@example.com',
      username: 'look at this media',
    };
    denizenDb._get = async (path) => {
      if (String(path).includes('email=eq.')) return [emailRow];
      if (String(path).includes('username=eq.')) return [userRow];
      return [];
    };
    const found = await teamAuth.findTeamAccount({
      orgId: 'org-1',
      email: 'info@royalsocietymanagement.com',
      username: 'look at this media',
    });
    assert.equal(found.id, 'a-email');
    assert.equal(found.username, 'kizer');
  });

  it('falls back to username when email is absent', async () => {
    const userRow = {
      id: 'a-user',
      org_id: 'org-1',
      email: 'other@example.com',
      username: 'kizer',
    };
    denizenDb._get = async (path) => {
      if (String(path).includes('username=eq.kizer')) return [userRow];
      return [];
    };
    const found = await teamAuth.findTeamAccount({
      orgId: 'org-1',
      username: 'Kizer',
    });
    assert.equal(found.id, 'a-user');
  });
});

describe('loginTeamAccount treats email-in-username as email', () => {
  let origGet;
  let origPatch;

  beforeEach(() => {
    origGet = denizenDb._get;
    origPatch = denizenDb._patch;
  });

  afterEach(() => {
    denizenDb._get = origGet;
    denizenDb._patch = origPatch;
  });

  it('looks up by email when username field holds an email and no team code', async () => {
    const account = {
      id: 'acct-1',
      org_id: 'org-1',
      email: 'info@royalsocietymanagement.com',
      username: 'kizer',
      display_name: 'Kizer',
      role: 'member',
      password_hash: null,
    };
    const org = { id: 'org-1', slug: 'look-at-this-media', display_name: 'Look At This Media', settings: {} };
    const calls = [];
    denizenDb._get = async (path) => {
      calls.push(path);
      if (String(path).includes('denizen_team_accounts?select=*,org_id&email=eq.')) return [account];
      if (String(path).includes('denizen_organizations?select=id,slug') && String(path).includes('id=eq.org-1')) {
        return [org];
      }
      if (String(path).includes('email=eq.info%40royalsocietymanagement.com')) return [account];
      return [];
    };
    denizenDb._patch = async () => null;

    const result = await teamAuth.loginTeamAccount({
      username: 'info@royalsocietymanagement.com',
      password: '',
    });
    assert.equal(result.account.email, 'info@royalsocietymanagement.com');
    assert.ok(calls.some((p) => String(p).includes('email=eq.info%40royalsocietymanagement.com')));
  });

  it('returns a join/create hint when email has no team account', async () => {
    denizenDb._get = async () => [];
    await assert.rejects(
      () => teamAuth.loginTeamAccount({
        email: 'info@royalsocietymanagement.com',
        password: 'secret1',
      }),
      (err) => {
        assert.equal(err.code, 'NOT_FOUND');
        assert.match(err.message, /Join a team|Create a team/i);
        return true;
      },
    );
  });

  it('does not auto-create an account on login miss', async () => {
    let posted = false;
    denizenDb._get = async (path) => {
      if (String(path).includes('team_code')) {
        return [{ id: 'org-1', slug: 'zion', display_name: 'Zion', settings: { team_code: '1921' } }];
      }
      return [];
    };
    denizenDb._post = async () => {
      posted = true;
      return [{ id: 'should-not-create' }];
    };
    await assert.rejects(
      () => teamAuth.loginTeamAccount({
        username: 'kaiser',
        email: 'info@royalsocietymanagement.com',
        password: 'x',
        teamCode: '1921',
      }),
      (err) => {
        assert.equal(err.code, 'NOT_FOUND');
        return true;
      },
    );
    assert.equal(posted, false);
  });
});
