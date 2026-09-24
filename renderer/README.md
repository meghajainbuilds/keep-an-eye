# Optional rendered-page fallback

This service receives only one public product URL per request. It never receives the collection, app password, phone subscriptions, or API keys. The main app first tries structured HTML and common embedded product JSON; it uses this service only when details are missing. There is no guarantee a store will permit automated access. There is no CAPTCHA bypass.

Build from the repository root with `docker build -f renderer/Dockerfile .`. Deploy separately from the app database, as the non-root user supplied in the image, with Chromium sandbox support and network-level restrictions blocking private, loopback, and metadata destinations. Do not disable the Chromium sandbox to work around hosting restrictions. Configure a random `BROWSER_RENDER_TOKEN` of at least 32 characters on both services, and set `BROWSER_RENDER_URL` on the main app. Use private service networking or HTTPS. Give the worker no persistent app volume or other secrets.

Rendering is off when these settings are absent. Requests are authenticated, one at a time, with a 20-second browser deadline and request/body limits. Service workers and WebSockets are blocked. Browser network requests are individually fulfilled through the DNS-pinned public-address fetcher. Browser cookies/authorization headers are not forwarded. Images and fonts are not downloaded; their URLs are read from markup. Public logs contain no product URLs or response bodies.

The Docker sandbox and hosting egress restrictions must be tested on the chosen host before enabling production rendering. Local functional testing alone does not establish container isolation. A token protects the endpoint but does not replace network isolation.
