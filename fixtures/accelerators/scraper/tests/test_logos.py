import unittest

from scraper.logos import names_someone_else, program_tokens, ranked
from scraper.parse import Page

ACME = Page.read(
    "https://acme.example/programs/",
    """<html><head><link rel="icon" href="/favicon-32.png"><link rel="apple-touch-icon" href="/touch.png"></head>
    <body><header><a class="brand-logo" href="/"><img src="/img/mark.svg" alt=""></a></header>
    <main><img src="/hero.jpg" alt="team">
    <img src="https://acme.example/uploads/partner-logo.png"><img src="/uploads/acme-logo-dark.png">
    <img src="/uploads/card.png" alt="Our partners and the Acme Labs logo shown together on stage"></main></body></html>""",
)
TOKENS = program_tokens("Acme Labs", "https://www.acme.example/")


class LogoChoice(unittest.TestCase):
    def test_trust_order(self) -> None:
        self.assertEqual(
            ranked(ACME, TOKENS),
            [
                "https://acme.example/img/mark.svg",
                "https://acme.example/uploads/acme-logo-dark.png",
                "https://acme.example/touch.png",
                "https://acme.example/favicon-32.png",
                "https://acme.example/favicon.ico",
            ],
        )

    def test_partner_logos_and_long_alt_text_are_not_the_programs_mark(self) -> None:
        self.assertNotIn("https://acme.example/uploads/partner-logo.png", ranked(ACME, TOKENS))
        self.assertNotIn("https://acme.example/uploads/card.png", ranked(ACME, TOKENS))

    def test_icons_never_replace_a_mark(self) -> None:
        self.assertEqual(
            ranked(ACME, TOKENS, marks_only=True),
            ["https://acme.example/img/mark.svg", "https://acme.example/uploads/acme-logo-dark.png"],
        )

    def test_header_wordmark_without_the_word_logo(self) -> None:
        page = Page.read(
            "https://capitalfactory.com/",
            '<header><a href="/"><img src="/brand/cf-wordmark-white.svg" alt="Capital Factory"></a><img src="/icons/search.svg" alt="Search"></header>',
        )
        self.assertEqual(
            ranked(page, program_tokens("Capital Factory", "https://capitalfactory.com/"), marks_only=True),
            ["https://capitalfactory.com/brand/cf-wordmark-white.svg"],
        )

    def test_declared_logo_counts_only_when_it_names_the_program(self) -> None:
        page = Page.read(
            "https://acme.example/",
            '<script type="application/ld+json">{"@graph":[{"@type":"Organization","name":"Acme Labs","logo":{"url":"https://acme.example/brand.png"}},'
            '{"@type":"Organization","name":"Zed Robotics","logo":"https://acme.example/zed.png"}]}</script>',
        )
        marks = ranked(page, TOKENS, marks_only=True)
        self.assertEqual(marks, ["https://acme.example/brand.png"])

    def test_file_names_that_name_another_company(self) -> None:
        self.assertTrue(names_someone_else("https://capitalfactory.com/company-logos/saronic.svg", program_tokens("Capital Factory", "https://capitalfactory.com/")))
        self.assertTrue(names_someone_else("https://x.example/iceye_logo-e1772810463817-300x85.png", program_tokens("Lifeline Ventures", "https://www.lifelineventures.com/")))
        self.assertTrue(names_someone_else("https://yesdelft.com/logo-tudelft-campus-white-150x100.png", program_tokens("YES!Delft", "https://yesdelft.com/")))

    def test_a_stored_icon_is_never_replaced_by_itself(self) -> None:
        import tempfile
        from datetime import datetime, timezone
        from pathlib import Path
        from unittest import mock

        from scraper import logos
        from scraper.outcome import Outcome
        from scraper.records import skeleton

        page = Page.read("https://zinc.example/", '<link rel="apple-touch-icon" href="/cropped-half-180x180.png">')
        program = skeleton("zinc", "Zinc", "https://zinc.example/", "https://zinc.example/", datetime(2026, 11, 11, tzinfo=timezone.utc))
        program["sources"][0]["quote"] = "https://zinc.example/cropped-half-180x180.png"
        with tempfile.TemporaryDirectory() as folder, mock.patch.object(logos, "LOGOS", Path(folder)):
            (Path(folder) / "zinc.png").write_bytes(b"png")
            outcome = Outcome("zinc", program, Path(folder) / "zinc.json")
            fetcher = mock.Mock()
            logos.refresh_logo(fetcher, outcome, '<link href="/cropped-half-180x180.png">', page, datetime(2026, 11, 11, tzinfo=timezone.utc), False)
        fetcher.fetch.assert_not_called()
        self.assertFalse(outcome.changed)

    def test_generic_file_names_name_nobody(self) -> None:
        self.assertFalse(names_someone_else("https://x.example/2026/07/Logo-Round-3-600x595.jpg", program_tokens("ClimateLaunchpad", "https://climatelaunchpad.org/")))
        self.assertFalse(names_someone_else("https://cdn.example/6749cd4bf1f583e1b4ab5c5c_Horizontal%20logo%2C%20full.png", program_tokens("Catalyst Fund", "https://catalyst.example/")))
        self.assertFalse(names_someone_else("https://x.example/logo_corfo2024_azul_min.png", program_tokens("CORFO", "https://www.corfo.gob.cl/")))


if __name__ == "__main__":
    unittest.main()
