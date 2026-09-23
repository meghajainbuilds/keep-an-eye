# Keep an Eye

A small, considered shopping companion. Save a product from any website on your phone, keep the merchant link, set an absolute price target or a percentage drop, get an email when a **readable merchant page** meets it, and share through your phone's native share sheet. An optional OpenAI assistant helps make sense of your saved edit.

Built as an open source **One Build a Week** project. One person can copy and run their own private instance. No dependencies beyond Node.js 24+.

## What works

| Job | First version |
| --- | --- |
| Save from any site | Store the original public URL, including sites that block metadata. Add a title or note yourself. |
| One tap phone capture | iPhone Shortcut passes the shared URL to the app. You confirm before saving. |
| Price alert | Daily merchant page check; email when an observed price is at or under your target, or has dropped by your chosen percentage from the first price observed. Requires a readable product offer with currency and configured email. |
| Share | The native Share Sheet lets you choose WhatsApp, Messages, Messenger, or any installed destination. Desktop falls back to copying the link. |
| Shopping assistant | Optional Responses API conversation grounded in up to 50 saved items. It cannot change alerts or invent live prices. |

## Run locally on a Mac

1. Install [Node.js 24 or later](https://nodejs.org/) and clone this repository.
2. Run `cp .env.example .env` and edit `.env`. Set a private `APP_PASSWORD`, a distinct random `SESSION_SECRET`, and a distinct random `CRON_SECRET`. For secrets, `openssl rand -hex 32` is convenient. The other integrations are optional to start.
3. Run `npm start`. Open `http://localhost:3000`. Sign in and paste a product URL.
4. Run `npm test` to verify product extraction and alert behavior.

No account or API key is needed to save and share. To use the assistant, set `OPENAI_API_KEY` in `.env` and restart. The API key stays on your server. The default model is `gpt-5.4-mini`; use `OPENAI_MODEL` to change it. API usage can incur charges.

## Put it on your phone

The app needs a public HTTPS URL and a **persistent disk** for `DATA_DIR`; temporary server filesystems will lose your saved products. Deploy it on a Node host with a persistent volume, set the environment variables from `.env.example`, run `npm start`, and point `DATA_DIR` at the mounted volume. Use a single running instance because this version stores data in SQLite. Keep the app password private. This is a personal instance, not a multi-user service.

Create an iPhone Shortcut called **Save to Keep an Eye**:

1. In Shortcut Details, enable **Show in Share Sheet** and accept **URLs** (or Safari web pages).
2. Add **Get URLs from Input** with **Shortcut Input**. Add **URL Encode** to encode the resulting URL, including all characters.
3. Add a **Text** action containing `https://YOUR-APP.example/?url=` followed by the encoded URL variable from step 2.
4. Add **Open URLs** with that text as input.
5. In Safari on a product page, tap **Share → Save to Keep an Eye**. The app opens with the link filled in; tap **Save this find**.

If your version of Shortcuts names an action differently, the important result is a URL of the form `https://YOUR-APP.example/?url=https%3A%2F%2Fstore.example%2Fitem`. You can first test it by pasting such a URL into Safari. Add the app to your Home Screen for quick access.

## Make price alerts work

1. Verify a sender domain with [Resend](https://resend.com/docs/dashboard/domains/introduction). Configure `RESEND_API_KEY`, `RESEND_FROM` and `ALERT_EMAIL` on your server. The email goes to `ALERT_EMAIL`.
2. On GitHub, set repository **Actions secrets** `APP_URL` (the full HTTPS URL of your deployed app) and `CRON_SECRET` (the same value as your server). Enable Actions. The included workflow calls `/api/check-prices` daily at 15:23 UTC; you can run it manually under **Actions → Daily price check**.
3. Save a product and set **Alert me at** to an amount in the product's listed currency, or set a percentage drop from the first observed price. If you set both, either condition can trigger the email. Check the store yourself before buying. For an unreadable product page or a page missing currency, you can still save an alert, but automatic alerting waits until a readable price is available.

Scheduled GitHub workflows can run late and may be disabled in an inactive public repository. Alerts are approximate daily checks, not a guarantee that a promotion will be caught. The checker never emails based on AI generated prices. Variant selection, coupons, taxes, shipping and checkout prices are outside this version.

## Privacy and limits

- Products, notes, and alert state stay in your SQLite file. Share links go to the original merchant URL. No affiliate rewriting.
- One password protects one instance; sharing the password shares the whole collection. For a public multi-user app, add real accounts, user-level authorization, quotas, and abuse protections.
- Retailers can block automated fetching or expose a generic/incorrect variant in their structured data. A blocked or ambiguous page remains a saved link but cannot reliably trigger an alert. `price_source` and `observed_at` make observations auditable.
- HTML fetch rejects loopback and private network addresses, restricts ports, pins DNS resolution and limits redirects, response size and time. Run the service with ordinary network isolation as well.
- The assistant sends saved titles, descriptions, notes, and links to the OpenAI API only when you ask it a question. Avoid saving sensitive details in notes if you enable it.

## File map

- `server.mjs`: HTTP API, password session and static serving.
- `lib/product.mjs`: safe retrieval and conservative product extraction.
- `lib/alerts.mjs`: daily checker and email delivery.
- `lib/assistant.mjs`: optional, read-only shopping assistant.
- `public/`: responsive app with native sharing.
- `AGENTS.md`: product principles and suggested Codex follow-up prompts.

## The product bet

Shopping often starts long before checkout. A link you save is a signal of emerging intent; a target price is a condition under which you might act. The assistant uses your own saved context to help you decide, while the price checker relies on evidence from the merchant. The interesting next build is collections that remember *why* you saved something and help you choose across products.

This is a personal, open source prototype. See `LICENSE` for reuse terms.
