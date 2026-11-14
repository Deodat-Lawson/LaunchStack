import unittest

from scraper.parse import Page
from scraper.text import QUOTE_LIMIT, bot_wall, clip, collapse, mostly_quoted, searchable, still_quoted

FIRST = "We invest in technical teams at the earliest stage and work beside them for twelve weeks of building, selling, and hiring before a demo day for investors."
SECOND = "Founders keep full control of their company, receive office space in three cities, and join an alumni network that answers questions long after the program ends."
HTML = f"""<html><head><title>Acme Labs | Accelerator</title><style>.x{{}}</style><script>var hidden = 1;</script></head>
<body><main><p>Acme Labs backs   pre-seed founders .</p><p>{FIRST}</p><p>{SECOND}</p></main></body></html>"""


class ControlCharacters(unittest.TestCase):
    def test_nul_and_controls_never_reach_stored_text(self) -> None:
        # Postgres text rejects NUL, so one stray byte in a PDF excerpt failed the whole import.
        self.assertEqual(collapse("Apply\x00 by\x0bMarch\x7f 1"), "Apply by March 1")


class QuoteMatching(unittest.TestCase):
    def setUp(self) -> None:
        self.page = Page.read("https://acme.example/", HTML)
        self.haystack = searchable(self.page.visible(), HTML)

    def test_scripts_and_styles_are_not_visible(self) -> None:
        self.assertNotIn("hidden", self.page.visible())
        self.assertNotIn(".x{}", self.page.visible())

    def test_curated_quotes_match_exactly_with_loose_punctuation(self) -> None:
        self.assertTrue(still_quoted("backs pre-seed founders.", self.haystack))
        self.assertFalse(still_quoted("backs seed founders.", self.haystack))
        self.assertTrue(still_quoted("Acme Labs | Accelerator [...] pre-seed founders", self.haystack))

    def test_homepage_quotes_survive_reordering_but_not_replacement(self) -> None:
        self.assertTrue(mostly_quoted(f"{SECOND} {FIRST}", self.haystack))
        self.assertFalse(
            mostly_quoted(f"{FIRST} Applications for our final cohort closed in 2025 and the program has since wound down for good.", self.haystack)
        )
        self.assertFalse(mostly_quoted("", self.haystack))

    def test_bot_walls_and_empty_pages_are_not_content(self) -> None:
        self.assertIsNotNone(bot_wall("Acme Labs | Loading"))
        self.assertIsNotNone(bot_wall("Just a moment... " + "x" * 400))
        self.assertIsNone(bot_wall(self.page.visible()))

    def test_clip_ends_on_a_word(self) -> None:
        clipped = clip("word " * 400)
        self.assertTrue(clipped.endswith("word"))
        self.assertLessEqual(len(clipped), QUOTE_LIMIT)


if __name__ == "__main__":
    unittest.main()
