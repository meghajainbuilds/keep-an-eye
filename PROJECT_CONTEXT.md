# Project handoff for Codex

Read `AGENTS.md` and `README.md` first. This file captures the decisions from the product conversation so the next Codex chat can continue without recreating them.

## Owner and goal

Megha is a PM learning to build with Codex through a "One Build a Week" portfolio project. Keep an Eye is a simple personal shopping collection: save a product from any website on an iPhone, find it again by automatically assigned category and subcategory, watch a price, and share the original link with friends. Explain work in plain, concise language, one step at a time; show how she can inspect and test each milestone.

The GitHub repository `meghajainbuilds/keep-an-eye` is **private** until Megha decides to release it. The code should eventually be copyable by others. Do not change visibility without her instruction.

## What exists

- Draft pull request #1: https://github.com/meghajainbuilds/keep-an-eye/pull/1
- Work branch: `codex/browse-categories-sms-alerts` (the name predates the switch away from SMS). The current application and phone push changes are on this branch; `main` does not have them yet.
- Mobile web app with password sign-in, saved finds, search, editable categories and subcategories, iPhone Shortcut URL capture, and native share sheet for WhatsApp, SMS/Messages, Messenger, etc.
- Price targets and percentage drops checked against readable merchant prices, with browser push notifications. On iPhone, this requires adding the HTTPS site to Home Screen and enabling notifications there.
- Optional OpenAI categorization when an API key is provided; local categorization works without one. The shopping assistant is also optional. Never invent prices.
- Node 24+ app, SQLite on a persistent disk, single running instance. Eleven local tests and GitHub Actions passed as of the phone push PR. There has been no live phone notification test yet.

## Hosting and cost decisions

Megha wants free or nearly free hobby services, preferably AI native, and has Lenny's Product Pass for Railway: she reports $20/month credit for 12 months after upgrading to Hobby and adding billing details. Check her actual Railway plan and credit before deploying. Deploy from the work branch so the push features are included. Use a Railway volume mounted at `/data`, set `DATA_DIR=/data`, and generate an HTTPS domain. Do not expose secrets in chat or GitHub.

Server variables needed: `APP_PASSWORD`, `SESSION_SECRET`, `CRON_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Distinct random session and cron secrets; keep VAPID keys stable across deploys. `OPENAI_API_KEY` can be omitted initially to control cost. See `README.md` and `.env.example`.

After deployment, set GitHub Actions secrets `APP_URL` and `CRON_SECRET` for the daily check, and test the live save, category edit, share, price watch, and iPhone push flow. A readable retailer offer is required for a genuine price alert. Avoid describing an accepted push as a delivered phone alert until observed.

## Next session prompt

"Read AGENTS.md, PROJECT_CONTEXT.md, and README.md in this private repository. Help me deploy the draft branch to Railway using my Product Pass, then test a live phone notification. Take one small step at a time and tell me how to inspect each step. Keep the repo private and flag any ongoing cost before I enable it."
