# Vantage recorded demo

This portable package shows a recorded synthetic Vantage review using the current UI source. It requires built-in Windows PowerShell 5.1. The recorded bundle needs no Node.js, Docker, database, sign-in, or API keys.

Double-click `Start-Vantage-Demo.cmd`. Open `http://127.0.0.1:3177/` if the browser does not open. Keep the launcher window open; press Ctrl+C or close it to stop the server. For another port or no browser, run `powershell -NoProfile -ExecutionPolicy Bypass -File .\Start-Vantage-Demo.ps1 -Port 3178 -NoBrowser` from this directory. Ports 3104 and 3111 are rejected. It listens on loopback only; execution policy is changed only for the launcher process.

The report contains recorded synthetic data and does not run live generation. Source access reflects the captured sample and does not establish live authorization. Review, context and other preview edits are held in memory and reset on reload; theme preference may be remembered. The alternative native Rules report was not captured and is omitted. Unsupported native writes are unavailable; no new commitments are created. The demo does not establish production permissions or validate production data access.

Before serving, the launcher verifies the bundled manifest and each listed file's SHA-256 hash and size. Unlisted files are not served. If verification fails, obtain a complete package or rebuild it.

For source builds, use Node 24 and pnpm 10, install with `pnpm install --frozen-lockfile`, and run `node scripts/dev/vantage-portable-build.mjs` from the repository root. The build copies the current UI source and assets into the recorded bundle; no symlinks are needed on the receiving laptop. Bundled fonts carry their OFL licenses.

Copy the entire `apps/vantage-demo` folder to another Windows laptop, or extract the prepared ZIP. Keep `recorded`, its hashed assets, and both launcher files together. The prebuilt files are committed on `demo/vantage-portable-windows-20261102`; no build or installation is needed to run them. Use a current Edge or Chrome browser.
