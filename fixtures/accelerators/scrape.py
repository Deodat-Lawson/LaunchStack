#!/usr/bin/env python3
"""Keep the accelerator catalogue current from official pages, with no AI in the loop.

Run `python3 fixtures/accelerators/scrape.py --help`; the code lives in scraper/ and the
workflow is described in COLLECTION.md.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from scraper.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
