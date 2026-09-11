"""
CriticMarkup parsing — the translation that makes review actions addressable.

These are unit tests over the markup grammar rather than round-trips through
adeu, so a change in adeu's emitted format shows up here as a precise failure
instead of an empty review pane.
"""

import pytest

from app.critic import parse_review_items, strip_markup


class TestReplacementPairs:
    """A replacement is a delete and an insert sharing one metadata block."""

    MARKUP = (
        "The Term shall be {--twelve (12) months--}{++twenty-four (24) months++}"
        "{>>[Chg:1 delete] Jane Doe (pairs with 2)\n[Chg:2 insert] Jane Doe (pairs with 1)<<}"
        " from the Effective Date."
    )

    def test_both_sides_are_returned(self):
        items = parse_review_items(self.MARKUP)
        assert [i.id for i in items] == ["Chg:1", "Chg:2"]

    def test_each_side_reports_its_own_text(self):
        """The bug this guards: binding both entries to the span nearest the
        metadata block reports the deletion as if it inserted the new text."""
        items = {i.id: i for i in parse_review_items(self.MARKUP)}
        assert items["Chg:1"].kind == "delete"
        assert items["Chg:1"].text == "twelve (12) months"
        assert items["Chg:2"].kind == "insert"
        assert items["Chg:2"].text == "twenty-four (24) months"

    def test_pairing_is_reported_both_ways(self):
        items = {i.id: i for i in parse_review_items(self.MARKUP)}
        assert items["Chg:1"].paired_with == "Chg:2"
        assert items["Chg:2"].paired_with == "Chg:1"

    def test_author_is_carried(self):
        for item in parse_review_items(self.MARKUP):
            assert item.author == "Jane Doe"


class TestComments:
    def test_iso_timestamp_does_not_bleed_into_the_body(self):
        """An ISO date contains colons, so a naive "up to the next colon" split
        leaves half the timestamp in the comment text."""
        markup = (
            "{==the indemnity clause==}"
            "{>>[Com:5] Bob Smith @ 2026-08-01T10:00:00Z: please double-check this<<}"
        )
        (item,) = parse_review_items(markup)
        assert item.id == "Com:5"
        assert item.kind == "comment"
        assert item.author == "Bob Smith"
        assert item.date == "2026-08-01T10:00:00Z"
        assert item.text == "please double-check this"

    def test_comment_without_a_date(self):
        markup = "{==clause==}{>>[Com:2] Alice: needs review<<}"
        (item,) = parse_review_items(markup)
        assert item.date is None
        assert item.text == "needs review"

    def test_multi_line_comment_body_is_joined(self):
        markup = "{==x==}{>>[Com:1] Alice: first line\nsecond line<<}"
        (item,) = parse_review_items(markup)
        assert "first line" in item.text
        assert "second line" in item.text

    def test_comment_anchors_to_the_highlighted_text(self):
        markup = "{==the indemnity clause==}{>>[Com:5] Bob: check<<}"
        (item,) = parse_review_items(markup)
        assert item.anchor_text == "the indemnity clause"


class TestKinds:
    def test_standalone_insert(self):
        (item,) = parse_review_items("{++new words++}{>>[Chg:9 insert] Ann<<}")
        assert (item.kind, item.text, item.paired_with) == ("insert", "new words", None)

    def test_standalone_delete(self):
        (item,) = parse_review_items("{--gone--}{>>[Chg:9 delete] Ann<<}")
        assert (item.kind, item.text) == ("delete", "gone")

    def test_format_change(self):
        (item,) = parse_review_items("{==bolded==}{>>[Chg:4 format] Ann<<}")
        assert item.kind == "format"


class TestOrderingAndDedup:
    def test_items_follow_document_order(self):
        markup = (
            "{++b++}{>>[Chg:2 insert] A<<} middle {++a++}{>>[Chg:1 insert] A<<}"
        )
        assert [i.id for i in parse_review_items(markup)] == ["Chg:2", "Chg:1"]

    def test_repeated_ids_are_reported_once(self):
        """adeu repeats an id in every block that touches its span."""
        markup = "{++x++}{>>[Chg:1 insert] A<<} and {++x++}{>>[Chg:1 insert] A<<}"
        assert len(parse_review_items(markup)) == 1

    def test_document_with_no_revisions(self):
        assert parse_review_items("Just ordinary prose, nothing tracked.") == []


class TestStripMarkup:
    @pytest.mark.parametrize(
        "markup,expected",
        [
            ("{++added++}", "added"),
            ("{--removed--}", ""),
            ("{~~old~>new~~}", "new"),
            ("{==highlighted==}", "highlighted"),
            ("{>>a comment<<}", ""),
            ("keep {--drop--}{++take++} end", "keep take end"),
        ],
    )
    def test_resolves_to_accepted_text(self, markup, expected):
        assert strip_markup(markup) == expected
