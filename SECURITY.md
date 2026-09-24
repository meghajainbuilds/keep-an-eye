# Security

This application is a single-user prototype for private self-hosting, not a multi-tenant service.

## Deployment requirements

- Use HTTPS, a strong private password, distinct random session and scheduler secrets, and a persistent private data directory. Example credentials are rejected at startup.
- Keep environment variables and SQLite backups outside source control. Browser push keys and save-only Shortcut keys must stay private.
- Configure one daily scheduler. Public workflow logs must never print the price-check response or saved-product data.
- Price fetching pins DNS, rejects non-public addresses, limits response size and redirects, and validates each redirect. Retain ordinary network isolation as an additional boundary.
- Use a reverse proxy with request limits for broader exposure. The built-in login throttling is not a substitute for production abuse protection.
- Optional AI features transmit saved product details to the configured provider. They are disabled unless an API key is supplied.

## Checks

Run `npm ci`, `npm test`, and `npm audit --audit-level=high`. Scan source and history with Gitleaks and run a JavaScript security static analysis such as Semgrep. Automated scanners are useful checks, not a guarantee of security.

For security reports, use GitHub private vulnerability reporting when enabled. Do not post credentials or personal collections in public issues.

## Before each commit and push

Run `npm run privacy:setup` in your checkout to configure local hooks and a neutral commit name/noreply email. Install Gitleaks. Put any additional personal phrases to block in a local `.privacy-patterns` file (one literal phrase per line); that file is ignored and must never be committed. Review the staged diff for real shopping examples that automated checks cannot identify. Hooks check the exact staged snapshot before commit and scan history before push. API-based updates bypass Git hooks: run the equivalent source and secret scans before any API write. CI repeats source privacy, credential, dependency, and static-analysis checks, but cannot retract information already pushed.

See renderer/README.md before enabling the optional browser service. Do not run it with app secrets or database access.
