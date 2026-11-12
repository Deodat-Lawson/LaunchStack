import unittest
from datetime import date, datetime, timezone

from scraper.facts import Findings
from scraper.parse import Page
from scraper.records import skeleton
from scraper.tags import alias_pattern

RECORD = skeleton("acme-labs", "Acme Labs", "https://acme.example/", "https://acme.example/apply", datetime(2026, 11, 9, tzinfo=timezone.utc))
TODAY = date(2026, 11, 9)
HTML = """<html><head><script type="application/ld+json">
{"@context":"https://schema.org","@type":"Organization","name":"Acme Labs","email":"mailto:programs@acme.example","telephone":"+1 415 555 0199"}
</script></head><body><nav><a href="/apply">Apply now</a><a href="/portfolio">Our companies</a>
<a href="mailto:hello@acme.example">Email us</a><a href="mailto:jane.doe@acme.example">Jane</a>
<a href="mailto:info@tracker.example">x</a><a href="tel:+1 (415) 555-0100">+1 (415) 555-0100</a></nav>
<p>Applications are now open. The application deadline is November 30, 2099 at midnight.</p>
<p>Our last cohort closed on 1 March 2020. Demo day is June 5, 2099.</p>
<p>Program Dates Dec 17, 2099 Feb 17, 2100 Deadline Dec 10, 2099. Refund Deadline (Dec 20, 2099).</p>
<p>Oct 18 2099 — Final Deadline</p>
<p>Acme Labs is a program for builders. <a href="/blog/sample-applications">Read sample applications</a></p>
<p>We invest $150,000 in each selected startup in exchange for 7% equity.</p>
<p>We accept less than 2% of applicants. Our acceptance rate is 3% for the spring batch.</p>
</body></html>"""


def read(html: str, url: str = "https://acme.example/") -> Findings:
    findings = Findings(RECORD, TODAY)
    findings.read(url, "details", Page.read(url, html))
    return findings


class Rules(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.findings = read(HTML)

    def values(self, key: str) -> list:
        return [item["value"] for item in self.findings.found[key]]

    def test_only_role_mailboxes_on_the_programs_domain(self) -> None:
        self.assertEqual(sorted(self.values("emails")), ["hello@acme.example", "programs@acme.example"])

    def test_structured_data_contacts_are_cited_from_the_page_source(self) -> None:
        self.assertIn("+1 415 555 0199", self.values("phones"))
        excerpts = [item["excerpt"] for item in self.findings.evidence.values()]
        self.assertIn('"email": "mailto:programs@acme.example"', excerpts)

    def test_links(self) -> None:
        self.assertIn("+1 (415) 555-0100", self.values("phones"))
        self.assertIn("https://acme.example/apply", self.values("routes"))
        self.assertEqual(self.values("applicationUrl"), ["https://acme.example/apply"])
        self.assertEqual(self.values("portfolioPages"), ["https://acme.example/portfolio"])
        self.assertEqual(self.values("examplePages"), ["https://acme.example/blog/sample-applications"])
        self.assertEqual(self.values("name"), ["Acme Labs"])

    def test_status_wording(self) -> None:
        self.assertEqual(self.values("applicationsOpen"), [True])
        self.assertEqual(self.values("operatingStatus"), [])

    def test_deadlines_need_wording_a_year_and_a_future_date(self) -> None:
        self.assertEqual(sorted(self.values("deadlines")), ["2099-10-18", "2099-11-30", "2099-12-10"])

    def test_selectivity_keeps_bounds_apart_from_exact_rates(self) -> None:
        self.assertCountEqual(self.values("selectivity"), [{"rate": 0.03, "bounded": False}, {"rate": None, "bounded": True}])

    def test_deal_wording_needs_an_offer_and_no_news(self) -> None:
        self.assertTrue(any("$150,000" in value for value in self.values("dealText")))
        news = read("<p>Our news. Portfolio company Zed raises $40M Series B led by Big Fund, and we are proud of them.</p>", "https://acme.example/news")
        self.assertEqual(news.found["dealText"], [])

    def test_every_finding_cites_evidence_on_this_program(self) -> None:
        for items in self.findings.found.values():
            for item in items:
                self.assertIn(item["evidenceId"], self.findings.evidence)


class TagAliases(unittest.TestCase):
    def test_whole_words_with_a_trailing_hyphen(self) -> None:
        self.assertTrue(alias_pattern("AI", True).search("AI-powered tools"))
        self.assertFalse(alias_pattern("AI", True).search("OpenAI"))
        self.assertFalse(alias_pattern("seed stage", False).search("pre-seed stage"))

    def test_korean_aliases_match_with_attached_particles(self) -> None:
        self.assertTrue(alias_pattern("액셀러레이터", False).search("스타트업 액셀러레이터입니다"))


if __name__ == "__main__":
    unittest.main()
