"""Keep the accelerator catalogue current from official pages, with no AI in the loop.

Run it through fixtures/accelerators/scrape.py; COLLECTION.md describes the workflow.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
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
LOGOS = ROOT.parents[1] / "apps" / "web" / "public" / "accelerators" / "logos"
USER_AGENT = "LaunchStackCatalogueRefresh/1.0"


def iso(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%S.000Z")
