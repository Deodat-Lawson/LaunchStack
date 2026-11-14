"""Robots policy and the on-disk cache. No network."""

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from scraper.cache import HttpCache
from scraper.net import robots_policy


class Robots(unittest.TestCase):
    def test_4xx_robots_allows_and_unreachable_robots_disallows(self) -> None:
        # RFC 9309 §2.3.1.3: 4xx means "unavailable" (no rules); §2.3.1.4: 5xx means "unreachable".
        self.assertEqual(robots_policy(404), "allow")
        self.assertEqual(robots_policy(401), "allow")
        self.assertEqual(robots_policy(403), "allow")
        self.assertEqual(robots_policy(429), "disallow")
        self.assertEqual(robots_policy(500), "disallow")
        self.assertEqual(robots_policy(None), "disallow")


class Cache(unittest.TestCase):
    def test_round_trip_keeps_the_body_and_validators(self) -> None:
        with TemporaryDirectory() as folder:
            cache = HttpCache(Path(folder))
            cache.store("https://acme.example/a", b"<p>Hello</p>", "text/html", '"abc"', "Tue, 15 Nov 1994 12:45:26 GMT", "https://acme.example/a")
            loaded = cache.load("https://acme.example/a")
            self.assertIsNotNone(loaded)
            assert loaded is not None
            self.assertEqual(loaded["body"], b"<p>Hello</p>")
            self.assertEqual(loaded["etag"], '"abc"')
            self.assertEqual(loaded["last_modified"], "Tue, 15 Nov 1994 12:45:26 GMT")
            self.assertIsNone(cache.load("https://acme.example/missing"))


if __name__ == "__main__":
    unittest.main()
