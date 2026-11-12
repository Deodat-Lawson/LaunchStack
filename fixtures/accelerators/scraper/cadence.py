"""The refresh proposal: daily near a known deadline, weekly for open intakes, monthly otherwise."""

from __future__ import annotations

import json
from datetime import datetime, timedelta

from . import CHECKS, LEDGER, iso
from .outcome import Outcome
from .records import load_program, program_ids


def load_ledger() -> dict[str, dict[str, str]]:
    return json.loads(LEDGER.read_text()).get("programs", {}) if LEDGER.exists() else {}


def record_ledger(outcomes: list[Outcome], now: datetime) -> None:
    ledger = load_ledger()
    for outcome in outcomes:
        entry = ledger.setdefault(outcome.program_id, {})
        entry["lastAttemptAt"] = iso(now)
        if outcome.reached:
            entry["lastSuccessAt"] = iso(now)
    LEDGER.parent.mkdir(exist_ok=True)
    LEDGER.write_text(json.dumps({"programs": dict(sorted(ledger.items()))}, indent=2) + "\n")


def _findings(program_id: str) -> dict:
    path = CHECKS / f"{program_id}.json"
    return json.loads(path.read_text())["findings"] if path.exists() else {}


def refresh_interval(program: dict, now: datetime) -> timedelta:
    findings = _findings(program["id"])
    dates = [cycle.get("dateOnly") or (cycle.get("deadlineAt") or "")[:10] for cycle in program["cycles"]]
    dates += [item["value"] for item in findings.get("deadlines", [])]
    today, soon = now.date().isoformat(), (now + timedelta(days=30)).date().isoformat()
    upcoming = [value for value in dates if value and value >= today]
    if any(value <= soon for value in upcoming):
        return timedelta(days=1)
    open_now = any(item["value"] is True for item in findings.get("applicationsOpen", []))
    if upcoming or open_now or any(cycle["rolling"] for cycle in program["cycles"]):
        return timedelta(days=7)
    return timedelta(days=30)


def due_ids(now: datetime) -> list[str]:
    """Programs whose last attempt is older than their interval (an hour of slack for schedules)."""
    ledger = load_ledger()
    due = []
    for program_id in program_ids():
        last = ledger.get(program_id, {}).get("lastAttemptAt")
        interval = refresh_interval(load_program(program_id), now) - timedelta(hours=1)
        if last is None or now - datetime.fromisoformat(last.replace("Z", "+00:00")) >= interval:
            due.append(program_id)
    return due
