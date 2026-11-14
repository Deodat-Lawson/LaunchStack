#!/usr/bin/env python3
"""Keep the accelerator catalogue current from official pages, with no AI in the loop.

Run `python3 services/accelerator-scraper/scrape.py --help`. The package is scraper/.
Data lives in fixtures/accelerators unless `--data` is set. COLLECTION.md describes the workflow.
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

if "--data" in sys.argv:
    index = sys.argv.index("--data")
    try:
        os.environ["ACCELERATOR_DATA"] = str(Path(sys.argv[index + 1]).resolve())
    except IndexError:
        sys.exit("scrape.py --data needs a directory")
    del sys.argv[index : index + 2]

from scraper.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
