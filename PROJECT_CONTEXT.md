# Project handoff for Codex

Read `AGENTS.md` and `README.md` first. This file captures the decisions from the product conversation so the next Codex chat can continue without recreating them.

## Owner and goal

Megha is a PM learning to build with Codex through a "One Build a Week" portfolio project. Keep an Eye is a simple personal shopping collection: save a product from any website on an iPhone, find it again by automatically assigned category and subcategory, watch a price, and share the original link with friends. Explain work in plain, concise language, one step at a time; show how she can inspect and test each milestone.

The GitHub repository `meghajainbuilds/keep-an-eye` is **private** until Megha decides to release it. The code should eventually be copyable by others. Do not change visibility without her instruction.

## What exists

- Draft pull request #1: https://github.com/meghajainbuilds/keep-an-eye/pull/1
- Work branch: `codex/browse-categories-sms-alerts` (the name predates the switch away from SMS). The current application and phone push changes are on this branch; `main` does not have them yet.
- Mobile web app with password sign-in, saved finds, search, editable categories and subcategories, iPhone Shortcut direct POST capture, and native share sheet for WhatsApp, SMS/Messages, Messenger, etc.
- Price targets and percentage drops checked against readable merchant prices, with browser push notifications. On iPhone, this requires adding the HTTPS site to Home Screen and enabling notifications there.
- Optional OpenAI categorization when an API key is provided; local categorization works without one. The shopping assistant is also optional. Never invent prices.
- Node 24+ app, SQLite on a persistent disk, single running instance. Eleven local tests and GitHub Actions passed as of the phone push PR. There has been no live phone notification test yet.

## Hosting and cost decisions

Megha wants free or nearly free hobby services, preferably AI native, and has Lenny's Product Pass for Railway: she reports $20/month credit for 12 months after upgrading to Hobby and adding billing details. Check her actual Railway plan and credit before deploying. Deploy from the work branch so the push features are included. Use a Railway volume mounted at `/data`, set `DATA_DIR=/data`, and generate an HTTPS domain. Do not expose secrets in chat or GitHub.

Server variables needed: `APP_PASSWORD`, `SESSION_SECRET`, `CRON_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Distinct random session and cron secrets; keep VAPID keys stable across deploys. `OPENAI_API_KEY` can be omitted initially to control cost. See `README.md` and `.env.example`.

After deployment, set GitHub Actions secrets `APP_URL` and `CRON_SECRET` for the daily check, and test the live save, category edit, share, price watch, and iPhone push flow. A readable retailer offer is required for a genuine price alert. Avoid describing an accepted push as a delivered phone alert until observed.

## Next session prompt

"Read AGENTS.md, PROJECT_CONTEXT.md, and README.md in this private repository. Help me deploy the draft branch to Railway using my Product Pass, then test a live phone notification. Take one small step at a time and tell me how to inspect each step. Keep the repo private and flag any ongoing cost before I enable it."


## Deployment and capture update — September 23, 2026

- Live app: https://keep-an-eye-production.up.railway.app, deployed from `codex/browse-categories-sms-alerts`. Keep the repository private.
- Railway project `74dbcf4e-f7d0-4c89-964b-b17f38e0949a`, production environment `80378e9e-2a37-4ad8-b481-0a71ee8f1870`, web service `54cda175-29b1-4469-9d21-454ab9f2efe7`. Persistent /data volume, Node 24, one replica, npm test build gate.
- Daily price checks now run in Railway service `daily-price-check` (`14b32e50-7083-4e03-a45d-61b1abb3c4f5`) at 15:23 UTC. It calls the web service over Railway private networking using a reference to its CRON_SECRET. Do not also enable GitHub scheduling without avoiding duplicate checks.
- Megha confirmed $20 Railway credits. Optional OpenAI API features remain off. Credentials are in Railway Variables, never in this document.
- Product direction: shopping starts on any merchant website. The primary flow must be Share → Save to Keep an Eye. Manual paste is a fallback.
- The in-app setup guide creates a revocable save-only key for a direct POST Shortcut. Apple Shortcuts setup still requires the user’s iPhone; no native iOS share extension or automatic installer is claimed. The old query-string import retains confirmation for safety.
- An actual iPhone Shortcut run, native sharing, and visible phone push still need device testing.

## September 24: collection home and automatic watching

Megha approved building: collection first, all new/existing saves watched by default for at least a 20% drop, opt-out via Stop watching. Baseline is the first readable merchant price; daily checks, no duplicate low-price alerts until rebound. watch_enabled persists separately from thresholds. Shortcut setup and push controls are under Settings; no additional AI spending enabled. Her Shortcut successfully saved the Quince cardigan through share.google. Preview fetching was fixed in d4d165c; Refresh details now checks price too. Phone push delivery remains unverified until tested on her device.
