# Project context

Keep an Eye is a self-hosted, single-user shopping collection. Products are saved through an authenticated iPhone Shortcut or the web app. New products are watched daily for a 20% drop from the first verified price; watching can be stopped per item.

Source code contains no user collection or production configuration. SQLite databases, environment files, and notification subscriptions belong only on a private deployment. Use synthetic fixtures for tests. Never add deployment identifiers, personal notes, account details, or actual saved products to documentation or test fixtures.

Read AGENTS.md, README.md, and SECURITY.md before making changes. Google Share Sheet input must be filtered to HTTP(S) URLs before selecting the first link; text beginning with source: is not a website URL.
