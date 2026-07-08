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
