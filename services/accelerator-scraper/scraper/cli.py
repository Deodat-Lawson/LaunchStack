"""Command line for the catalogue scraper. See `scrape.py --help`."""

from __future__ import annotations

import argparse
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from . import PROGRAMS, discover
from .cadence import due_ids, record_ledger
from .enrichment import enrich, save
from .net import Fetcher
from .outcome import Outcome
from .quotes import commit, record_logo_review, record_observations, refresh_homepage, scrape_program
from .records import ID_PATTERN, load_program, program_ids, skeleton
from .tags import derive_tags

USAGE = """\
  scrape.py refresh                      every Program: quotes, logos, enrichment, tags
  scrape.py refresh antler hf0           only these Programs
  scrape.py refresh --due                only what the refresh cadence says is due
  scrape.py check                        report drift, write nothing, exit 1 on drift
  scrape.py add acme-labs --name "Acme Labs" --url https://acme.example/ [--apply URL]
  scrape.py discover harvest             refresh us-candidates.json from discovery-sources.json
  scrape.py discover report
  scrape.py discover vet                 accept or reject new and review candidates
  scrape.py discover add-confirmed       add the candidates an operator (or vet) confirmed
  scrape.py coverage                     regenerate COVERAGE.md from the dossiers
  scrape.py test                         run the scraper's unit tests (no network)
  scrape.py --data fixtures/accelerators refresh
"""


def now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def refresh(args: argparse.Namespace) -> int:
    moment = now()
    fetcher = Fetcher()
    if args.due and args.ids:
        raise SystemExit("--due picks the Programs itself and does not take ids")
    ids = due_ids(moment) if args.due else program_ids(args.ids)
    if not ids:
        print("nothing is due")
        return 0
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        outcomes = list(pool.map(lambda program_id: scrape_program(program_id, fetcher, moment, args.stamp), ids))
    for outcome in outcomes:
        print("\n".join(outcome.lines))
    stale = sum(item["outcome"] == "stale" for outcome in outcomes for item in outcome.observations)
    inaccessible = sum(item["outcome"] == "inaccessible" for outcome in outcomes for item in outcome.observations)
    written = sum(outcome.changed or outcome.stamped for outcome in outcomes)
    verb = "would write" if args.check else "wrote"
    print(
        f"scraped {len(ids)} programs: {sum(outcome.changed for outcome in outcomes)} updated, "
        f"{stale} stale quotes, {inaccessible} inaccessible, {verb} {written} files"
    )
    if args.check:
        return 1 if any(outcome.drift for outcome in outcomes) else 0
    commit(outcomes)
    record_observations(outcomes, moment)
    record_logo_review(outcomes, moment)
    if not args.no_enrich:

        def attempt(program_id: str) -> list[Path]:
            checks, discovery = enrich(load_program(program_id), fetcher, moment)
            if checks is None:
                print(f"enrich-failed\t{program_id}\tthe homepage could not be read; earlier checks were kept")
            return save(program_id, checks, discovery)

        with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
            changed = [path for paths in pool.map(attempt, ids) for path in paths]
        print(f"enriched {len(ids)} programs: wrote {len(changed)} check and discovery files")
    tags, tagged = derive_tags(moment)
    print(f"taxonomy: {tags} tags on {tagged} programs")
    record_ledger(outcomes, moment)
    return 0


def add(args: argparse.Namespace) -> int:
    if not ID_PATTERN.match(args.id):
        raise SystemExit("The id must be lowercase letters, digits, and hyphens (max 64)")
    for value in (args.url, args.apply or args.url):
        if urlparse(value).scheme not in {"http", "https"}:
            raise SystemExit(f"{value} is not an HTTP or HTTPS URL")
    path = PROGRAMS / f"{args.id}.json"
    if path.exists():
        raise SystemExit(f"{path} already exists; run scrape.py refresh {args.id}")
    moment = now()
    fetcher = Fetcher()
    program = skeleton(args.id, args.name.strip(), args.url, args.apply or args.url, moment)
    outcome = Outcome(args.id, program, path)
    refresh_homepage(fetcher, outcome, moment, stamp=True)
    print("\n".join(outcome.lines))
    homepage = next(source for source in program["sources"] if source["id"] == "homepage")
    if not homepage["quote"] or outcome.logo is None:
        raise SystemExit(f"{args.id} was not written: the page text or the logo could not be collected")
    if args.dry_run:
        print(f"would add\t{path}")
        return 0
    commit([outcome])
    checks, discovery = enrich(program, fetcher, moment)
    save(args.id, checks, discovery)
    derive_tags(moment)
    print(f"added\t{path}")
    return 0


def run_discover(args: argparse.Namespace) -> int:
    if args.action == "harvest":
        discover.harvest(now())
    elif args.action == "add-confirmed":
        discover.add_confirmed(now())
    elif args.action == "vet":
        discover.vet(now(), workers=args.workers)
    else:
        print(discover.summary(discover.load()))
    return 0


def coverage(_: argparse.Namespace) -> int:
    import subprocess

    from . import REPO

    return subprocess.call(
        ["pnpm", "--filter", "@launchstack/web", "accelerators:publish-intelligence"],
        cwd=REPO,
    )


def test(_: argparse.Namespace) -> int:
    suite = unittest.defaultTestLoader.discover(str(Path(__file__).parent / "tests"), top_level_dir=str(Path(__file__).parents[1]))
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    return 0 if result.wasSuccessful() else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="scrape.py",
        description="Keep the accelerator catalogue current from official pages, with no AI in the loop.",
        epilog=USAGE,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    commands = parser.add_subparsers(dest="command", required=True)
    refreshing = commands.add_parser("refresh", help="refresh Programs and write what changed")
    refreshing.add_argument("--due", action="store_true", help="only Programs due under the refresh cadence")
    refreshing.add_argument("--stamp", action="store_true", help="also move checkedAt on verified quotes")
    refreshing.add_argument("--no-enrich", action="store_true", help="skip contact, status, deadline, and deal checks")
    refreshing.set_defaults(handler=refresh, check=False)
    checking = commands.add_parser("check", help="report drift only; exit 1 when anything drifted")
    checking.set_defaults(handler=refresh, check=True, due=False, stamp=False, no_enrich=True)
    for command in (refreshing, checking):
        command.add_argument("ids", nargs="*", help="Program ids; default is every file in programs/")
        command.add_argument("--workers", type=int, default=8, help="Programs fetched in parallel (default 8)")
    adding = commands.add_parser("add", help="create a homepage record for a new Program")
    adding.add_argument("id")
    adding.add_argument("--name", required=True)
    adding.add_argument("--url", required=True)
    adding.add_argument("--apply")
    adding.add_argument("--dry-run", action="store_true")
    adding.set_defaults(handler=add)
    discovering = commands.add_parser("discover", help="find US startup programs for operator review")
    discovering.add_argument("action", choices=("harvest", "report", "vet", "add-confirmed"))
    discovering.add_argument("--workers", type=int, default=8, help="candidates fetched in parallel (default 8)")
    discovering.set_defaults(handler=run_discover)
    commands.add_parser("coverage", help="regenerate COVERAGE.md").set_defaults(handler=coverage)
    commands.add_parser("test", help="run the unit tests").set_defaults(handler=test)
    args = parser.parse_args(argv)
    return args.handler(args)


if __name__ == "__main__":
    sys.exit(main())
