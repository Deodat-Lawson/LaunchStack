# @launchstack/export-engine

PDF rendering (ADR-009): the typed client for the Gotenberg document-rendering service — Office documents to PDF via LibreOffice, HTML and Markdown to PDF via Chromium. It deliberately does not contain conversion into evidence — nothing here produces ingestable output; it turns a document the product already has into the PDF a user downloads.

## Install

```bash
pnpm add @launchstack/export-engine
```

## Use

```ts
import { createGotenbergClient, PAPER_SIZES } from "@launchstack/export-engine";

const client = createGotenbergClient({
  baseUrl: "http://gotenberg:3000",
  username: "launchstack",
  password: "…",
});

const { pdf } = await client.officeToPdf({ file: docxBuffer, filename: "contract.docx" });
const styled = await client.htmlToPdf({
  html: exportHtml,
  pageProperties: { ...PAPER_SIZES.a4, printBackground: true },
});
```

## API

| Subpath | What it is                                                                                                                                   |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`     | `GotenbergClient` (`officeToPdf`, `htmlToPdf`, `markdownToPdf`, `health`), the error classes, `PAPER_SIZES`, `OFFICE_CONVERTIBLE_EXTENSIONS` |

Errors are typed: `RenderingConfigError` for a caller mistake (missing baseUrl, unconvertible extension, a Markdown wrapper without the `toHTML` hook), `RenderingServiceError` for anything the service said (`statusCode`, `detail`, and Gotenberg's `trace` id for log correlation; `statusCode: 0` is "unreachable/timed out").

## Configuration

Nothing here reads `process.env`. Connection settings are injected by the
composition root (`apps/web/src/server/rendering.ts` builds the client from
`GOTENBERG_SERVICE_URL` / `GOTENBERG_SERVICE_USERNAME` /
`GOTENBERG_SERVICE_PASSWORD`).

The service itself is the off-the-shelf `gotenberg/gotenberg:8` image,
declared in `docker-compose.yml` with basic auth enabled and a Chromium
deny-list that blocks private-network fetches (the SSRF guard the other
compute services express as `ALLOWED_FETCH_ORIGINS`).

## Stability

0.x. The client tracks Gotenberg 8's multipart API; the slice used is small
and stable (`/forms/libreoffice/convert`, `/forms/chromium/convert/{html,markdown}`, `/health`).

## License

Apache-2.0 — see [LICENSE](LICENSE). Gotenberg itself is MIT-licensed and
pulled as an image at deploy time, not redistributed by this package.
