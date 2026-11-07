---
"@launchstack/document-conversion-engine": minor
---

`htmlToScreenshot` takes a picture of a complete HTML document through
Gotenberg's Chromium (`/forms/chromium/screenshot/html`): the whole page by
default, at the window size you give, as PNG, JPEG or WebP. It returns the
image bytes, their content type and Gotenberg's trace id. The shot is taken
after the load event plus `waitDelay`; waiting for the network to go idle is
off, so analytics beacons and long polls can't hold a request until it times
out.
