'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

describe('container health checks', () => {
  for (const dockerfile of ['Dockerfile', 'Dockerfile.production']) {
    it(`${dockerfile} probes the real health endpoint with startup grace`, () => {
      const source = read(dockerfile);
      assert.match(source, /HEALTHCHECK/);
      assert.match(source, /--start-period=/);
      assert.match(source, /\/api\/health/);
      assert.match(source, /process\.env\.PORT/);
    });
  }

  for (const compose of ['docker-compose.yml', 'docker-compose.production.yml']) {
    it(`${compose} declares a service health check`, () => {
      const source = read(compose);
      assert.match(source, /healthcheck:/);
      assert.match(source, /\/api\/health/);
      assert.match(source, /start_period:/);
      assert.match(source, /retries:\s*3/);
    });
  }

  it('production Compose loads credentials from the ignored environment file', () => {
    const source = read('docker-compose.production.yml');
    assert.match(source, /env_file:\s*\n\s*- \.env\.production/);
    assert.doesNotMatch(
      source,
      /^\s+(?:AGENT_TOKEN|BRAVE_SEARCH_API_KEY|DISCORD_BOT_TOKEN|SUPABASE_(?:ANON_KEY|SERVICE_ROLE_KEY)):/m,
    );
  });

  it('Docker build context keeps SOUL and canonical Markdown source', () => {
    const ignore = read('.dockerignore');
    assert.doesNotMatch(ignore, /^\*\.md$/m);
    assert.match(ignore, /^\.env\.\*$/m);
    assert.match(ignore, /^reports\/$/m);
  });
});
