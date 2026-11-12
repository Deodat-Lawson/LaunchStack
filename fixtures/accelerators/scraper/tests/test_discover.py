import unittest
from datetime import datetime, timezone

from scraper.discover import (
    STARTUP_WORDS,
    Source,
    aliases_for,
    ap_state_list,
    directory_links,
    key_for,
    kind_for,
    labelled_columns,
    loc_gafc_appendix,
    merge,
    sbir_gafc_table,
    strip_footnotes,
    texas_incubator_directory,
    website_of,
)

NOW = datetime(2026, 11, 11, tzinfo=timezone.utc)


def source(parser: str, **options) -> Source:
    return Source("test", "https://lists.example.gov/page", "test", parser, options.pop("state", None), options.pop("year", None), options)


class Parsers(unittest.TestCase):
    def test_loc_appendix_with_wrapped_lines_and_page_numbers(self) -> None:
        body = """APPENDIX IV. GAFC Winners, 2014–16 (listed alphabetically by state; 187 total)

Alabama
Birmingham: Velocity (2015)

California
San Diego: CONNECT (2016); Hera Labs (2015, 2016); La Cocina’s Business Incubator Program (2016);
Rosie Network’s Military Entrepreneur Center (2016)
                                     108
District of Columbia
Washington: EatsPlace (2014); Halcyon Incubator (2015)
"""
        rows = [(item.name, item.state, item.year) for item in loc_gafc_appendix(body, source("loc-gafc-appendix"))]
        self.assertIn(("Rosie Network’s Military Entrepreneur Center", "CA", 2016), rows)
        self.assertIn(("Hera Labs", "CA", 2015), rows)
        self.assertIn(("Hera Labs", "CA", 2016), rows)
        self.assertIn(("Halcyon Incubator", "DC", 2015), rows)
        self.assertFalse(any(name.isdigit() for name, _, _ in rows))

    def test_sbir_table(self) -> None:
        body = (
            "<table><tr><th>Track</th><th>State</th><th>Awardees</th></tr>"
            "<tr><td>GAFC</td><td>AZ</td><td>SEED SPOT</td></tr>"
            "<tr><td>SBIR Catalyst</td><td>IL (KY, TN)</td><td>Southern Illinois Research Park, Inc. and partners</td></tr></table>"
        )
        rows = [(item.name, item.state) for item in sbir_gafc_table(body, source("sbir-gafc-table"))]
        self.assertEqual(rows, [("SEED SPOT", "AZ"), ("Southern Illinois Research Park, Inc.", "IL")])

    def test_ap_state_list(self) -> None:
        body = "<ul><li>W. Va., ADL Ventures LLC</li><li>Ala., Arrowpoint Labs Foundation</li><li>Join us</li></ul>"
        rows = [(item.name, item.state) for item in ap_state_list(body, source("ap-state-list"))]
        self.assertEqual(rows, [("ADL Ventures LLC", "WV"), ("Arrowpoint Labs Foundation", "AL")])

    def test_directory_links_name_learn_more_links_from_their_heading(self) -> None:
        body = """<nav><a href="https://agency.example.gov/about">About</a></nav><section>
        <h1>INSPYRE Innovation Hub</h1><p>A hub.</p><a href="https://inspyrehub.com/">Learn more</a>
        <p><strong>Awesome Inc</strong><br><a title="Awesome Inc" href="http://www.awesomeinc.org/">http://www.awesomeinc.org/</a></p>
        <a href="https://www.facebook.com/awesome">Facebook</a><a href="https://x.example/brochure.pdf">Brochure</a>
        <a href="https://lists.example.gov/other">Same site</a></section><footer><a href="https://vendor.example/">Site by Vendor</a></footer>"""
        rows = [(item.name, item.website) for item in directory_links(body, source("directory-links", state="NY", start="<section>", end="<footer"))]
        self.assertEqual(rows, [("INSPYRE Innovation Hub", "https://inspyrehub.com/"), ("Awesome Inc", "http://www.awesomeinc.org/")])

    def test_directory_links_fail_loudly_when_the_layout_changes(self) -> None:
        with self.assertRaises(ValueError):
            directory_links("<p>new layout</p>", source("directory-links", start="<section>"))

    def test_texas_directory(self) -> None:
        body = "Business Incubator Profiles\n3 Day Startup (3DS)\nLocation: Austin\nFounded: 2008\nWebsite: http://3daystartup.org/\n\nBUSINESS INCUBATORS\nAccelerated Ventures at Baylor University\nLocation: Waco\nWebsite: www.baylor.edu/ventures\n"
        rows = [(item.name, item.city, item.website) for item in texas_incubator_directory(body, source("texas-incubator-directory", state="TX"))]
        self.assertEqual(rows, [("3 Day Startup (3DS)", "Austin", "http://3daystartup.org/"), ("Accelerated Ventures at Baylor University", "Waco", "https://www.baylor.edu/ventures")])

    def test_labelled_columns_split_and_wrapped_websites(self) -> None:
        body = (
            "Cushing                                Tulsa\n"
            "Central Oklahoma Business &            Gradient Innovation Hub2\n"
            "Development Corp.1                     Address: 21 N Greenwood\n"
            "Address: 114 N. Harrison Avenue        Website: www.joingradient.com\n"
            "Contact Name: Mark Cotner              \n"
            "Website: www.workforce.example.edu/rose-\n"
            "cybersecurity-incubator\n"
        )
        rows = [(item.city, item.name, item.website) for item in labelled_columns(body, source("labelled-columns", state="OK"))]
        self.assertIn(("Cushing", "Central Oklahoma Business & Development Corp.", "https://www.workforce.example.edu/rose-cybersecurity-incubator"), rows)
        self.assertIn(("Tulsa", "Gradient Innovation Hub", "https://www.joingradient.com"), rows)

    def test_footnote_markers(self) -> None:
        self.assertEqual(strip_footnotes("Project 381012"), "Project 3810")
        self.assertEqual(strip_footnotes("Startup 4051"), "Startup 405")
        self.assertEqual(strip_footnotes("The Verge"), "The Verge")


class ReviewFile(unittest.TestCase):
    def test_keys_ignore_legal_suffixes_and_aliases_follow_dba(self) -> None:
        self.assertEqual(key_for("ADL Ventures LLC"), key_for("ADL Ventures"))
        self.assertEqual(key_for("gener8tor Management LLC"), "gener8tor")
        self.assertIn("Innosphere", aliases_for("Rocky Mountain Innovation Initiative dba Innosphere"))

    def test_websites_are_normalised(self) -> None:
        self.assertEqual(website_of("www.centraltech.edu"), "https://www.centraltech.edu")
        self.assertIsNone(website_of("n/a"))

    def test_kind_is_a_guess_from_name_and_site(self) -> None:
        self.assertEqual(kind_for("Long Beach Accelerator"), "accelerator")
        self.assertEqual(kind_for("Downstate Biotech Incubator"), "incubator")
        self.assertEqual(kind_for("Shipley Center", "https://www.clarkson.edu/shipley"), "university program")
        self.assertEqual(kind_for("Kentucky Science and Technology Corporation Council"), "support organisation")

    def test_operator_decisions_survive_a_harvest(self) -> None:
        existing = {
            "seed-spot": {
                "key": "seed-spot", "name": "SEED SPOT", "aliases": [], "kind": "accelerator", "state": "AZ", "cities": [],
                "years": [2015], "sources": [], "status": "rejected", "website": None, "applyUrl": None, "programId": None, "note": "kept",
            }
        }
        rows = sbir_gafc_table("<tr><td>GAFC</td><td>AZ</td><td>SEED SPOT</td></tr>", source("sbir-gafc-table", year=2021))
        merged = merge(rows, existing, NOW)
        self.assertEqual(merged["seed-spot"]["status"], "rejected")
        self.assertEqual(merged["seed-spot"]["note"], "kept")
        self.assertEqual(merged["seed-spot"]["years"], [2015, 2021])

    def test_a_listed_website_waits_for_review(self) -> None:
        body = '<section><h2>Zed Startup Studio</h2><a href="https://zed-studio.example/">Learn more</a></section>'
        merged = merge(directory_links(body, source("directory-links")), {}, NOW)
        entry = merged["zed-startup-studio"]
        self.assertEqual((entry["status"], entry["website"]), ("review", "https://zed-studio.example/"))

    def test_startup_wording(self) -> None:
        self.assertTrue(STARTUP_WORDS.search("We help founders build companies"))
        self.assertTrue(STARTUP_WORDS.search("Our incubation program"))
        self.assertFalse(STARTUP_WORDS.search("We sell office furniture to small businesses"))


if __name__ == "__main__":
    unittest.main()
