import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from scraper import PROGRAMS
from scraper.cadence import refresh_interval
from scraper.records import ID_PATTERN, is_homepage_record, skeleton, write_if_changed

NOW = datetime(2026, 11, 11, tzinfo=timezone.utc)


class Records(unittest.TestCase):
    def test_new_records_are_homepage_records(self) -> None:
        self.assertTrue(is_homepage_record(skeleton("acme-labs", "Acme Labs", "https://acme.example/", "https://acme.example/apply", NOW)))

    def test_catalogue_kinds(self) -> None:
        if (PROGRAMS / "accel-atoms.json").exists():
            self.assertTrue(is_homepage_record(json.loads((PROGRAMS / "accel-atoms.json").read_text())))
        if (PROGRAMS / "y-combinator.json").exists():
            self.assertFalse(is_homepage_record(json.loads((PROGRAMS / "y-combinator.json").read_text())))

    def test_ids(self) -> None:
        self.assertTrue(ID_PATTERN.match("acme-labs"))
        self.assertFalse(ID_PATTERN.match("Acme Labs"))

    def test_unchanged_content_is_not_rewritten(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "record.json"
            self.assertTrue(write_if_changed(path, {"checkedAt": "a", "value": 1}))
            self.assertFalse(write_if_changed(path, {"checkedAt": "b", "value": 1}))
            self.assertTrue(write_if_changed(path, {"checkedAt": "c", "value": 2}))


class Cadence(unittest.TestCase):
    def program(self, **cycle) -> dict:
        record = skeleton("zz-cadence-test", "Cadence Test", "https://cadence.example/", "https://cadence.example/", NOW)
        record["cycles"][0].update(cycle)
        return record

    def test_intervals(self) -> None:
        soon = (NOW + timedelta(days=10)).date().isoformat()
        later = (NOW + timedelta(days=90)).date().isoformat()
        self.assertEqual(refresh_interval(self.program(dateOnly=soon), NOW), timedelta(days=1))
        self.assertEqual(refresh_interval(self.program(dateOnly=later), NOW), timedelta(days=7))
        self.assertEqual(refresh_interval(self.program(rolling=True), NOW), timedelta(days=7))
        self.assertEqual(refresh_interval(self.program(), NOW), timedelta(days=30))


if __name__ == "__main__":
    unittest.main()
