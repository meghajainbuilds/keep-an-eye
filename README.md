# Keep an Eye

A personal shopping collection for things you want to find again. Save a product from any website on your phone, browse it by automatically assigned category and subcategory, and get a phone notification when a **readable merchant page** meets your price watch. Share the original link through your phone's native share sheet.

Built as a **One Build a Week** project. The repository stays private until its creator decides to release it. Later, anyone can copy the code and run their own private instance with Node.js 24+ and `npm install`.

## What works

| Job | First version |
| --- | --- |
| Save from any site | Store the original public URL, including sites that block metadata. Add a title or note yourself. |
| Find it later | Search titles, stores and notes. Browse Apparel → Dresses, Kids → Toys, Electronics → Audio, and more. Change the category when sorting misses. |
| One tap phone capture | iPhone Shortcut passes the shared URL to the app. You confirm before saving. |
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

Create an iPhone Shortcut called **Save to Keep an Eye**:

1. In Shortcut Details, enable **Show in Share Sheet** and accept **URLs** (or Safari web pages).
2. Add **Get URLs from Input** with **Shortcut Input**. Add **URL Encode** to encode the resulting URL, including all characters.
3. Add a **Text** action containing `https://YOUR-APP.example/?url=` followed by the encoded URL variable from step 2.
4. Add **Open URLs** with that text as input.
5. In Safari on a product page, tap **Share → Save to Keep an Eye**. The app opens with the link filled in; tap **Save this find**.

If your version of Shortcuts names an action differently, the important result is a URL of the form `https://YOUR-APP.example/?url=https%3A%2F%2Fstore.example%2Fitem`. You can first test it by pasting such a URL into Safari. Add the app to your Home Screen for quick access.

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
