# Deployment

Production deployment runbook: **[PRODUCTION_DEPLOY.md](PRODUCTION_DEPLOY.md)**

Related:

- [MESH_SCALING.md](MESH_SCALING.md) — multi-node / NAS / GPU routing
- [NPC_MCP_GATEWAY.md](NPC_MCP_GATEWAY.md) — Connect AI / MCP tokens
- [VISITOR_ONBOARDING.md](VISITOR_ONBOARDING.md) — demo vs team access

Quick smoke after deploy:

```bash
npm run smoke:mcp
node scripts/verify-production-schema.js
```

## Runtime hotfixes versus reproducible releases

The NAS deployment is sometimes updated with a scoped file hotfix when the local
working tree contains unrelated active changes. A hotfix copies only the reviewed
files into the running `denizen-server` container and restarts it. This is useful
for a focused production correction, but it creates an important operational gap:
the live container may be ahead of the last complete image build.

After a scoped hotfix:

1. run `node --check` on changed JavaScript inside the container;
2. confirm the office endpoint returns HTTP 200;
3. verify cache-bust revisions and expected markers from the served files;
4. inspect the public URL in a fresh browser session;
5. rebuild a clean image later so the next container replacement preserves the fix.

Never put NAS passwords, tokens, or `.env` values in documentation or deployment
logs. See [CURRENT_IMPLEMENTATION_STATUS.md](CURRENT_IMPLEMENTATION_STATUS.md) for
the audited live-state qualifications and NPC/demo verification checklist.

`docker-compose.production.yml` contains no deployment credentials. It loads the
ignored `.env.production` file at runtime; create that file from
`.env.production.template` before validating or starting the production stack.

## Reproducible source release

Build releases from a clean commit, not directly from a runtime-hotfixed or dirty
working directory:

```bash
npm test
npm run release:source
```

`release:source` refuses a dirty `denizen/` tree. It uses `git archive`, a
normalized gzip timestamp, and the committed `denizen/` tree to write three files
under `out/releases/`:

- `denizen-v<version>-<commit>.tar.gz` — committed application source;
- matching `.manifest.json` — full commit, Denizen tree hash, stable commit date;
- matching `.sha256` — archive checksum.

Running the command twice on the same clean commit must produce the same SHA-256.
Build `Dockerfile.production` from the extracted archive and retain the manifest
with the deployed image/tag. The production Dockerfile and both Compose files
probe `/api/health`; do not promote an image until its container reaches
`healthy`.
