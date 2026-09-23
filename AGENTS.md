# Working on Keep an Eye with Codex

Product promise: a fast, calm place to remember products, watch a *verified* price, and share the original merchant URL. Save first; enrichment can fail gracefully.

- Never invent a price or treat an AI response as a price observation.
- Distinguish absolute targets from percentage drops. The percentage baseline is the first observed merchant price.
- Preserve original merchant links and never add affiliate parameters.
- Keep credentials on the server. Do not commit `.env` or `data/`.
- Run `npm test` after changing product extraction or alert logic.
- When adding a retailer, include one HTML fixture and explain how variants, currency, and blocked pages behave.

Good next prompts for Codex:
1. "Review the price extractor against three product pages I choose. Add fixture based tests. Explain any price ambiguity before changing logic."
2. "Help me replace the single user store with accounts and a hosted database without weakening privacy."
3. "Add collections for fall dresses and kids toys, keeping the one tap save flow."
