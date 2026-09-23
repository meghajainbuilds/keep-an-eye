# Keep an Eye

### One Build a Week · Shopping, intent, and AI

**The idea:** The shopping journey begins when something catches your eye, often weeks before you know whether to buy it. Yet most tools treat a saved link as a dead bookmark or a checkout lead. I wanted a place to preserve that early intent and make it useful when the moment changes.

I built a phone-first shopping companion that lets you save a product from almost anywhere, attach your own reason for keeping it, watch for an observed price or percentage drop, and share the original merchant link with a friend. A small AI assistant helps compare the things you've saved. It only reasons over your collection; it does not invent live prices.

**Why this shape:** Saving has to work even when a retailer blocks extraction. The card can start with just a URL, and you can add context later. Price alerts require a stronger evidence bar, so the checker uses a merchant page's product offer and currency, records when it observed them, and stays silent if it cannot read a credible price. Sharing uses the phone's native sheet because the friend and the conversation matter more than a destination picker inside my app.

**What I built with Codex:** A responsive web app, an iPhone Share Sheet shortcut flow, a single-user backend with SQLite, a daily price checker, email alerts, an optional OpenAI shopping assistant, fixture tests, and an open source setup guide. The repository has no npm dependencies. Each person can run a private copy.

**What I would test next:** Which saved products actually lead to a purchase or a useful conversation? Does a note about *why* the product matters improve later decisions? How often can real retailer pages support a trustworthy alert for the exact variant a shopper intended? I would start with a small set of frequent savers before broadening retailer coverage.

**Why it matters to my work:** My work at Shopify and LTK taught me that the valuable problem is often upstream of checkout: how a person moves from inspiration to confidence. This project is a small way to explore that space directly, from a real phone workflow through the messy product data underneath it.

## A short demo

1. In Safari, share a product page to **Save to Keep an Eye**. The app opens with the link filled in.
2. Save it with a note and a 20% drop alert. Show the card with its observed price and target.
3. Share it from the card to a friend in the phone's native share sheet.
4. Ask the assistant how it fits with other saved finds, and show that it does not claim a live price.

The price alert requires a deployed instance, a readable merchant page, configured email, and a scheduled daily check. The demo should say so plainly.
