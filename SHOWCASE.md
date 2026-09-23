# Keep an Eye

### One Build a Week · Shopping, intent, and AI

**The idea:** The shopping journey begins when something catches your eye, often weeks before you know whether to buy it. Yet most tools treat a saved link as a dead bookmark or a checkout lead. I wanted a place to preserve that early intent and make it useful when the moment changes.

I built a phone-first shopping collection for the things I might want to find again. Save a product from almost anywhere; it is sorted into a category and subcategory, such as Apparel → Dresses or Kids → Toys. Search and browse saved finds, attach your own note, and watch for a price drop. When a readable merchant page meets your threshold, the app texts you. Sharing sends the original merchant link to a friend.

**Why this shape:** The payoff of saving is being able to retrieve something weeks later. Automatic categories make the collection navigable, and search reaches names, stores and notes. Sorting uses AI when configured, with local rules as a fallback and a manual correction path. Price alerts require a stronger evidence bar: the checker uses a merchant page's product offer and currency and stays silent if it cannot read a credible price. Sharing uses the phone's native sheet.

**What I built with Codex:** A responsive web app, an iPhone Share Sheet shortcut flow, categorized browsing and search, a single-user backend with SQLite, a daily price checker with Twilio SMS alerts, optional OpenAI sorting and shopping questions, tests, and a setup guide. The repository has no npm dependencies. Each person can run a private copy when the code is released.

**What I would test next:** Which saved products actually lead to a purchase or a useful conversation? Does a note about *why* the product matters improve later decisions? How often can real retailer pages support a trustworthy alert for the exact variant a shopper intended? I would start with a small set of frequent savers before broadening retailer coverage.

**Why it matters to my work:** My work at Shopify and LTK taught me that the valuable problem is often upstream of checkout: how a person moves from inspiration to confidence. This project is a small way to explore that space directly, from a real phone workflow through the messy product data underneath it.

## A short demo

1. In Safari, share a product page to **Save to Keep an Eye**. The app opens with the link filled in.
2. Save it with a note and a 20% drop watch. Show the automatically assigned category, and correct it if needed.
3. Search for the item or browse its category weeks later. Share it from the card in the phone's native share sheet.
4. Show a real SMS price alert from a readable merchant page, or explain why an unreadable page remains saved without an alert.

The price alert requires a deployed instance, a readable merchant page, a configured Twilio SMS sender, and a scheduled daily check. The demo should say so plainly. The repository is private until the creator chooses to release it.
