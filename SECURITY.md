# Security Policy

Report vulnerabilities privately via GitHub's
[private vulnerability reporting](https://github.com/Dolonia333/DENIZEN/security/advisories/new).
Do not open public issues for security problems.

Full policy, scope, and the secrets-handling / rotation guidance: [denizen/SECURITY.md](denizen/SECURITY.md).

Short version: never commit credentials or internal IPs; load them from environment variables; if a secret was
ever committed, rotate it immediately (history deletion alone is not enough). PRs are scanned by gitleaks.
