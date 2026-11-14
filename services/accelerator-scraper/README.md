# Accelerator scraper

Deterministic catalogue refresh for `fixtures/accelerators`. No model calls.
The package is `scraper/`. Official pages are fetched with robots.txt and
crawl-delay honoured, cached on disk, and read with rules. Each extracted value
keeps the excerpt it came from.

A robots.txt fetch that fails (anything other than HTTP 404) disallows the host
and the page is recorded inaccessible. HTTP 404 means the host has no robots
file, which allows the fetch (RFC 9309). `ycombinator.com` is in scope; its
robots.txt is still honoured.

The HTTP cache is `fixtures/accelerators/.http-cache/` (gitignored). A second
run sends `ETag` / `Last-Modified` and reuses the stored body when the visible
text has not changed, so the written files stay byte-identical.

Playwright is a fallback for pages whose static HTML is too thin or is a JS
shell. If it is not installed, the page is still recorded and the run continues.

## Commands

From the repository root, on Python 3.12 (CI) or 3.9:

```sh
python3 services/accelerator-scraper/scrape.py test
python3 services/accelerator-scraper/scrape.py refresh
python3 services/accelerator-scraper/scrape.py refresh --due
python3 services/accelerator-scraper/scrape.py refresh antler
python3 services/accelerator-scraper/scrape.py check
python3 services/accelerator-scraper/scrape.py discover vet
python3 services/accelerator-scraper/scrape.py discover add-confirmed
python3 services/accelerator-scraper/scrape.py coverage
```

`--data` overrides the catalogue directory. This machine's system Python is
3.9, which runs the standard-library core. Use uv when you want the pinned
3.12 interpreter and Playwright:

```sh
uv venv --python 3.12 services/accelerator-scraper/.venv
uv pip install --python services/accelerator-scraper/.venv/bin/python \
  -r services/accelerator-scraper/requirements.txt \
  -r services/accelerator-scraper/requirements-render.txt
services/accelerator-scraper/.venv/bin/python -m playwright install chromium
services/accelerator-scraper/.venv/bin/python services/accelerator-scraper/scrape.py test
```

SVG logos still need `rsvg-convert` or ImageMagick on `PATH`.
