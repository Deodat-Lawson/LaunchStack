"""Keep the accelerator catalogue current from official pages, with no AI in the loop.

Run it through services/accelerator-scraper/scrape.py. The data directory is
fixtures/accelerators unless ACCELERATOR_DATA is set (scrape.py --data).
"""

from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path


def _data_root() -> Path:
    override = os.environ.get("ACCELERATOR_DATA")
    if override:
        return Path(override).resolve()
    return Path(__file__).resolve().parents[3] / "fixtures" / "accelerators"


def _repo_root(data: Path) -> Path:
    for parent in (data, *data.parents):
        if (parent / "apps" / "web").is_dir():
            return parent
    return data.parents[1]


ROOT = _data_root()
REPO = _repo_root(ROOT)
PROGRAMS = ROOT / "programs"
CHECKS = ROOT / "checks"
DISCOVERIES = ROOT / "discoveries"
INTELLIGENCE = ROOT / "intelligence"
OBSERVATIONS = INTELLIGENCE / "refresh-observations.json"
LEDGER = INTELLIGENCE / "check-ledger.json"
LOGO_REVIEW = INTELLIGENCE / "logo-review.json"
TAXONOMY = ROOT / "taxonomy.json"
VOCABULARY = ROOT / "tag-vocabulary.json"
CANDIDATES = ROOT / "us-candidates.json"
DISCOVERY_SOURCES = ROOT / "discovery-sources.json"
LOGOS = REPO / "apps" / "web" / "public" / "accelerators" / "logos"
CACHE = ROOT / ".http-cache"
USER_AGENT = "LaunchStackCatalogueRefresh/1.0"


def iso(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%S.000Z")
