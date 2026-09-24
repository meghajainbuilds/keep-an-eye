# Keep an Eye

A personal shopping collection for things you want to find again. Save a product from any website on your phone, browse it by automatically assigned category and subcategory, and get a phone notification when a **readable merchant page** meets your price watch. Share the original link through your phone's native share sheet.

Built as a **One Build a Week** project. The repository stays private until its creator decides to release it. Later, anyone can copy the code and run their own private instance with Node.js 24+ and `npm install`.

## What works

| Job | First version |
| --- | --- |
| Save from any site | Store the original public URL, including sites that block metadata. Add a title or note yourself. |
| Find it later | Search titles, stores and notes. Browse Apparel → Dresses, Kids → Toys, Electronics → Audio, and more. Change the category when sorting misses. |
| One tap phone capture | iPhone Share Sheet Shortcut saves the product URL directly using a revocable save-only key; no app switch or form. |
| Price alert | Daily merchant page check; phone notification when an observed price is at or under your target, or has dropped by your chosen percentage from the first price observed. Requires a readable product offer with currency and phone notifications enabled. |
| Share | The native Share Sheet lets you choose WhatsApp, Messages, Messenger, or any installed destination. Desktop falls back to copying the link. |
| Automatic sorting | With `OPENAI_API_KEY`, OpenAI returns a constrained category and subcategory at save time. Without it or if it fails, local rules sort common items; uncertain items go under Other. Existing saved finds receive local categorization on startup. |
| Shopping assistant | Optional Responses API conversation grounded in up to 50 saved items. It cannot change alerts or invent live prices. |

## Run locally on a Mac

1. Install [Node.js 24 or later](https://nodejs.org/) and clone this repository. Run `npm ci`.
2. Run `cp .env.example .env` and edit `.env`. Set a private `APP_PASSWORD`, a distinct random `SESSION_SECRET`, and a distinct random `CRON_SECRET`. For secrets, `openssl rand -hex 32` is convenient. The other integrations are optional to start.
3. Run `npm start`. Open `http://localhost:3000`. Sign in and paste a product URL.
4. Run `npm test` to verify product extraction and alert behavior.

No account or API key is needed to save, browse and share. To enable AI sorting and the assistant, set `OPENAI_API_KEY` in `.env` and restart. The key stays on your server. Sorting defaults to `gpt-5.4-nano` (`OPENAI_CATEGORIZATION_MODEL`); the optional shopping assistant defaults to `gpt-5.4-mini` (`OPENAI_MODEL`). Categorization sends the product title, description, URL and your note to OpenAI when you save it. API usage can incur charges. Without a key, local categorization still works for common product names, and every item can be corrected in Edit.

## Put it on your phone

The app needs a public HTTPS URL and a **persistent disk** for `DATA_DIR`; temporary server filesystems will lose your saved products and phone subscriptions. On Railway, connect the private GitHub repository, add a persistent volume and mount it at `/data`, set `DATA_DIR=/data`, set the secrets from `.env.example`, and run `npm start`. Confirm your Railway credit and usage limits before deploying. Use a single running instance because this version stores data in SQLite. Keep the app password private. This is a personal instance, not a multi-user service.

### Save while shopping: one-time iPhone setup

The primary flow is **product page → Share → Save to Keep an Eye → saved**. Open the app later to browse, edit categories, add notes, or stop/resume automatic watching.

Sign in and open **Settings → Manage iPhone saving** for the complete guide and your private saving key. In Apple Shortcuts:

1. Create **Save to Keep an Eye** and enable **Show in Share Sheet**, accepting URLs and Safari web pages.
2. Add **Get URLs from Input** with Shortcut Input, then **Get Item from List → First Item**.
3. In the app, create a saving key and copy its authorization header.
4. Add **Get Contents of URL**, using the address displayed in the app (`https://YOUR-APP/api/capture`). Set Method to POST. Add the Authorization header using the copied value (`Bearer YOUR_KEY`). Set Request Body to JSON; add a Text field named `url`, using the Item from List variable.
5. Add **Get Dictionary Value → message** from Contents of URL, then **Show Result** with that value.
6. On a product page in Safari or Chrome, use Share → Save to Keep an Eye. Grant the requested connection permission on first use. The Shortcut displays the server result without opening the app or asking you to complete a form.

This web app cannot install a Shortcut on your phone automatically. Setup must be completed once in Shortcuts. Do not share a Shortcut containing your private key.

The saving key is separate from your password, permits only saving a URL, and returns no collection data. Its SHA-256 hash persists in SQLite. Replace or disable it from the setup guide; replacement immediately invalidates the old key. It is only shown once, held in the setup dialog, and cleared when the dialog closes or you sign out. Never put the key or password in URL parameters. Save requests use authenticated POST; opening a link never silently writes to the collection.

Unreadable store pages still save as links. Price alerts require a verified merchant price with currency. Duplicate saves preserve your existing notes and watch settings. Legacy `/?url=...` links still open the confirmation form; use the POST Shortcut for direct saving.

## Get phone price alerts

1. Generate a VAPID key pair locally with `node --input-type=module -e "import webpush from 'web-push'; console.log(webpush.generateVAPIDKeys())"`. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT=mailto:you@example.com` on Railway. Keep the private key out of GitHub. Keep these keys across redeployments so existing phone subscriptions continue working.
2. On your iPhone, open the HTTPS app in Safari, choose **Share → Add to Home Screen**, and open it from the new icon. Sign in, then tap **Enable phone alerts** and allow notifications. On a supported desktop browser, you can enable alerts directly from the site. An iPhone requires iOS 16.4 or later for Home Screen web push.
3. On GitHub, set repository **Actions secrets** `APP_URL` (the full HTTPS URL of your deployed app) and `CRON_SECRET` (the same value as your server). Enable Actions. The included workflow calls `/api/check-prices` daily at 15:23 UTC; you can run it manually under **Actions → Daily price check**.
4. Save a product and set **Notify me when it reaches** to an amount in the product's listed currency, or set a percentage drop from the first observed price. If you set both, either condition can trigger a notification. Check the store yourself before buying. For an unreadable product page or a page missing currency, you can still save a watch, but automatic alerting waits until a readable price is available.

Scheduled GitHub workflows can run late. Alerts are approximate daily checks, not a guarantee that a promotion will be caught. The checker never sends an alert based on AI generated prices. A push service accepting an alert does not guarantee it appears on the phone. Variant selection, coupons, taxes, shipping and checkout prices are outside this version.

## Privacy and limits

- Products, notes, alert state and phone push subscriptions stay in your SQLite file. Share links go to the original merchant URL. No affiliate rewriting.
- One password protects one instance; sharing the password shares the whole collection. For a public multi-user app, add real accounts, user-level authorization, quotas, and abuse protections.
- Retailers can block automated fetching or expose a generic/incorrect variant in their structured data. A blocked or ambiguous page remains a saved link but cannot reliably trigger an alert. `price_source` and `observed_at` make observations auditable.
- HTML fetch rejects loopback and private network addresses, restricts ports, pins DNS resolution and limits redirects, response size and time. Run the service with ordinary network isolation as well.
- If AI sorting is enabled, the product title, description, URL and note are sent to OpenAI when saving. Asking the optional assistant sends up to 50 saved items. Avoid sensitive details in notes if you enable AI features.

## File map

- `server.mjs`: HTTP API, password session and static serving.
- `lib/product.mjs`: safe retrieval and conservative product extraction.
- `lib/categories.mjs`: AI categorization, local fallback and taxonomy.
- `lib/alerts.mjs`: daily price checker.
- `lib/push.mjs`: phone notification delivery through the browser push service.
- `lib/assistant.mjs`: optional, read-only shopping assistant.
- `public/`: responsive app with native sharing.
- `AGENTS.md`: product principles and suggested Codex follow-up prompts.

## The product bet

Shopping often starts long before checkout. A link you save is a signal of emerging intent; a target price is a condition under which you might act. The assistant uses your own saved context to help you decide, while the price checker relies on evidence from the merchant. The interesting next build is collections that remember *why* you saved something and help you choose across products.

This is a personal, open source prototype. See `LICENSE` for reuse terms.

## Product preview repair

Images and titles open the saved original link. Refresh details retries merchant metadata and checks the price for a saved card while preserving its link, custom title, notes, manual category, and price-watch state. The optional comparison assistant is hidden when it is not configured.

The Quince cardigan fixture contains observed Open Graph metadata from the Heather Pewter product page (September 24, 2026). It verifies the image and title, not a particular size or checkout price. Variant offers are not inferred from this preview fixture; price observation still requires an explicit offer with currency. Blocked pages remain saved links, with a compact missing-preview message. Fetches remain DNS-pinned and redirect-checked with a bounded 2 MB response limit.

## Automatic watches and collection home

Saving a product now starts a daily 20% watch against the first verified merchant price. Existing saved links without a threshold migrate to this default once. Stop/resume is explicit and persists across restarts; duplicate Shortcut saves do not re-enable a stopped watch. A price that remains under the threshold produces one accepted notification, then rearms only after rising above the threshold. Failed delivery is retried. Checks are serialized to prevent duplicate alerts from overlapping manual/scheduled checks, and currency mismatches never trigger alerts.

The collection opens first. All saved, Price drops, and Waiting for price are counted filters with explanatory empty states. Price drops includes any observed drop; notifications use the 20% threshold. Shortcut setup and phone notification controls live in Settings. Successful Shortcut saves or “I’ve set this up” dismiss the onboarding card. Notification permission still requires the user's phone; an installed Shortcut alone does not enable push.

Refresh details updates the first readable price and establishes a baseline for previously unpriced products. Preview repair in the earlier release only updated images/titles, which left the Quince cardigan unpriced until a price check ran. Metadata recovery does not invent a price or overwrite a manual title/category.
