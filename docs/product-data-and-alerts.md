# Product data and price alerts

Extraction follows the Product, ProductGroup and Offer structures described in Google's documentation:
- https://developers.google.com/search/docs/appearance/structured-data/product
- https://developers.google.com/search/docs/appearance/structured-data/product-variants
- https://developers.google.com/search/docs/appearance/structured-data/merchant-listing

The extractor resolves linked JSON-LD nodes, offer identifiers, named color/size attributes, current price specifications, currency and availability. Embedded Shopify product JSON supplies named options and variant images. If a recognized Shopify page omits those options, a same-origin public product JSON endpoint is checked using the same network-safety restrictions. Tracking parameters do not determine variant identity. Related-product data must not replace the saved product.

Synthetic fixtures cover three merchant structures: JSON-LD plus named embedded options; summary ProductGroup plus detailed offers and a public commerce endpoint; and embedded product arrays with size/width options and unrelated recommendations. They contain no real saved products or customer information.

## Alert scopes

New saves automatically watch the whole product at a 20% drop from the first verified price. The whole-product price is the lowest available offer verified for the saved product/page (or its explicit product group), labeled “From” when there are multiple offers. A different available size or color may qualify. Colors on separate unlinked product pages require separate saved links; the app does not crawl the store to discover them.

Use **Price alerts · Product & variants** to add an exact combination. Select each available dimension, including width where applicable. Each variant has its own baseline, percentage or optional absolute target, pause state and notification state. An absolute target takes precedence over the percentage. Pausing the whole-product alert does not pause variant alerts. Existing exact watches migrate to independent watches with their original baselines and thresholds; a new whole-product watch is not silently enabled for them.

Unavailable, mismatched, conflicting, currency-changing or unreadable observations do not trigger alerts. An unavailable variant may be watched, but its baseline waits for a verified available price. Price checks run on the existing daily schedule. Phone delivery requires configured notifications; service acceptance does not prove a notification was displayed.

## Limits and privacy

Structured data improves coverage but cannot guarantee every merchant. Blocked pages, missing variant identities, member-only prices, checkout promotions and inconsistent markup may remain unverified. Existing rendered-page fallback can improve JavaScript-page coverage where configured. Preserve the link and any trustworthy name/image; never invent a price. No AI-generated price is used for alerts.

Raw pages, live investigations, personal collections, credentials and local preview databases stay outside source control. Network checks apply to redirects and the commerce fallback. Tests use fictional fixtures and mock notifications.
