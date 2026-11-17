"""What the crawl reads first, and how tags see a whole page. No network."""

import unittest
from datetime import date, datetime, timezone

from scraper.enrichment import _quote, _tag_quotes
from scraper.facts import Findings, is_article
from scraper.parse import Page
from scraper.records import skeleton

RECORD = skeleton(
    "acme-labs",
    "Acme Labs",
    "https://acme.example/",
    "https://acme.example/apply",
    datetime(2026, 11, 9, tzinfo=timezone.utc),
)

FILLER = "Our community meets every week to share lessons and plan what comes next. " * 30


class Articles(unittest.TestCase):
    def test_posts_news_and_people_pages_are_articles(self) -> None:
        for url in (
            "https://acme.example/blog/applications-open-for-cohort-5",
            "https://acme.example/news/demo-day-recap",
            "https://www.techstars.com/newsroom/apply-to-c05-of-the-founder-catalyst-program",
            "https://www.socialalpha.org/announcement/social-alpha-announces-investment",
            "https://acme.example/case-studies/widgetco",
            "https://acme.example/2025/06/new-partner",
            "https://acme.example/portfolio/widgetco",
            "https://acme.example/team",
        ):
            self.assertTrue(is_article(url), url)

    def test_the_programs_own_pages_are_not(self) -> None:
        for url in (
            "https://acme.example/apply",
            "https://acme.example/accelerator/terms",
            "https://acme.example/faq",
            "https://acme.example/cohort-start-dates",
        ):
            self.assertFalse(is_article(url), url)

    def test_an_article_gives_announcements_but_not_terms_or_places(self) -> None:
        url = "https://acme.example/newsroom/apply-to-cohort-5"
        findings = Findings(RECORD, date(2026, 11, 9))
        findings.read(
            url,
            "application",
            Page.read(
                url,
                "<p>Applications close December 15, 2099. Our partner is a government entity "
                "based in Abu Dhabi. Social Alpha announces an investment of $500,000 in WidgetCo.</p>",
            ),
        )
        self.assertEqual([item["value"] for item in findings.found["deadlines"]], ["2099-12-15"])
        self.assertEqual(findings.found["location"], [])
        self.assertEqual(findings.found["dealText"], [])
        self.assertEqual(findings.found.get("dealComponents", []), [])


class TagQuotes(unittest.TestCase):
    def test_tag_wording_past_the_excerpt_becomes_its_own_quote(self) -> None:
        url = "https://acme.example/program"
        page = Page.read(
            url,
            f"<main><p>{FILLER}</p><p>We back pre-seed B2B software companies. "
            f"Lunch is served on Fridays.</p></main>",
        )
        excerpt = _quote(url, "details", page)
        self.assertNotIn("pre-seed", excerpt["excerpt"])
        quotes = _tag_quotes(url, excerpt, page)
        self.assertEqual([quote["excerpt"] for quote in quotes], ["We back pre-seed B2B software companies."])
        self.assertEqual(quotes[0]["url"], url)
        self.assertNotEqual(quotes[0]["id"], excerpt["id"])

    def test_wording_already_in_the_excerpt_is_not_repeated(self) -> None:
        url = "https://acme.example/program"
        page = Page.read(url, "<main><p>We back pre-seed B2B software companies.</p></main>")
        self.assertEqual(_tag_quotes(url, _quote(url, "details", page), page), [])


if __name__ == "__main__":
    unittest.main()
