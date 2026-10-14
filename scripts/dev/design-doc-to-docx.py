# /// script
# requires-python = ">=3.9"
# dependencies = ["python-docx>=1.1"]
# ///
"""
Turn a design-doc markdown file into a .docx that uses the LaunchStack
Technical Design template's own formatting, ready to upload to Google Docs
(Drive → Upload → Open with Google Docs).

The template is downloaded from Google Docs as .docx and its elements are
cloned, never restyled: the shaded label, Title, meta line, rule, Heading 1/2,
the purple-bordered callout, body and guidance paragraphs, the bordered table
with its lavender header, and the footer. Whatever the template looks like,
the output looks like it.

Markdown subset (anything else is an error, not silently dropped):
  # title · ## N Section · ### subsection · paragraphs · **bold** *italic*
  `code` [text](url) · "- " bullets · "1. " numbered (one level) ·
  pipe tables · "> " blockquote · ![alt](relative/path.png) on its own line · ---

  uv run scripts/dev/design-doc-to-docx.py \
      docs/design/accelerators/technical-design-review.md \
      ~/Downloads/Accelerators-Technical-Design.docx
"""

from __future__ import annotations

import argparse
import copy
import re
import sys
import tempfile
import urllib.request
from pathlib import Path

import docx
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Emu, Inches, Pt, RGBColor
from docx.text.paragraph import Paragraph

TEMPLATE_URL = (
    "https://docs.google.com/document/d/1foc0Any7c4rQ9pf0Goiwlid4GDVJrFM_HxcQ_Akr0wc/export?format=docx"
)
CONTENT_WIDTH_TWIPS = 10080  # 7 in between the template's 0.75 in margins
MAX_IMAGE_WIDTH = Inches(7.0)
MAX_IMAGE_HEIGHT = Inches(8.6)
MUTED = RGBColor(0x4C, 0x4D, 0x53)
ACCENT = "4a29b2"
MONO = "JetBrains Mono"


# WordprocessingML requires pPr / tcPr children in schema order; strict
# consumers (Word, Quick Look) silently ignore out-of-order properties.
PPR_ORDER = [
    "w:pStyle", "w:keepNext", "w:keepLines", "w:pageBreakBefore", "w:framePr", "w:widowControl",
    "w:numPr", "w:suppressLineNumbers", "w:pBdr", "w:shd", "w:tabs", "w:suppressAutoHyphens",
    "w:kinsoku", "w:wordWrap", "w:overflowPunct", "w:topLinePunct", "w:autoSpaceDE", "w:autoSpaceDN",
    "w:bidi", "w:adjustRightInd", "w:snapToGrid", "w:spacing", "w:ind", "w:contextualSpacing",
    "w:mirrorIndents", "w:suppressOverlap", "w:jc", "w:textDirection", "w:textAlignment",
    "w:textboxTightWrap", "w:outlineLvl", "w:divId", "w:cnfStyle", "w:rPr", "w:sectPr", "w:pPrChange",
]
TCPR_ORDER = [
    "w:cnfStyle", "w:tcW", "w:gridSpan", "w:hMerge", "w:vMerge", "w:tcBorders", "w:shd", "w:noWrap",
    "w:tcMar", "w:textDirection", "w:tcFitText", "w:vAlign", "w:hideMark",
]


def put_ordered(parent, new, order):
    """Replace any child with new's tag, inserting new at its schema position."""
    for old in parent.findall(new.tag):
        parent.remove(old)
    rank = {qn(t): n for n, t in enumerate(order)}
    mine = rank.get(new.tag, len(order))
    for child in parent:
        if rank.get(child.tag, len(order)) > mine:
            child.addprevious(new)
            return new
    parent.append(new)
    return new


def element(tag, **attrs):
    el = OxmlElement(tag)
    for k, v in attrs.items():
        el.set(qn(k), v)
    return el


def center(p_el):
    put_ordered(p_el.find(qn("w:pPr")), element("w:jc", **{"w:val": "center"}), PPR_ORDER)

# ── Template prototypes ──────────────────────────────────────────────────────


class Template:
    """Cloneable elements taken from the template body, located by content."""

    def __init__(self, path: Path):
        self.doc = docx.Document(str(path))
        body = list(self.doc.element.body.iterchildren())
        paras = [(el, Paragraph(el, self.doc)) for el in body if el.tag == qn("w:p")]
        def find(pred, what):
            for el, p in paras:
                if pred(p):
                    return el
            raise SystemExit(f"template: could not find the {what} paragraph")

        self.label = find(lambda p: "DESIGN TEMPLATE" in p.text, "label")
        self.title = find(lambda p: p.style.name == "Title", "title")
        self.meta = find(lambda p: p.text.startswith("Feature "), "meta")
        self.rule = next(el for el in body if el.find(".//" + qn("w:pict")) is not None)
        self.h1 = find(lambda p: p.style.name == "Heading 1", "Heading 1")
        self.h2 = find(lambda p: p.style.name == "Heading 2", "Heading 2")
        self.callout = find(lambda p: p.text.startswith("What it is."), "callout")
        self.guidance = find(lambda p: p.text.startswith("One paragraph."), "guidance")
        self.body = find(lambda p: p.text == "[paragraph]", "body")
        tables = [el for el in body if el.tag == qn("w:tbl")]
        if not tables:
            raise SystemExit("template: no table to copy")
        self.table = max(tables, key=lambda t: len(t.find(qn("w:tblGrid"))))

    def clear_body(self):
        body = self.doc.element.body
        for el in list(body.iterchildren()):
            if el.tag != qn("w:sectPr"):
                body.remove(el)

    def append(self, el):
        self.doc.element.body.find(qn("w:sectPr")).addprevious(el)


def base_rpr(p_el):
    """rPr of the paragraph's last text run (the non-label run), else its pPr/rPr."""
    runs = [r for r in p_el.iter(qn("w:r")) if r.find(qn("w:t")) is not None]
    for r in reversed(runs):
        rpr = r.find(qn("w:rPr"))
        if rpr is not None:
            out = copy.deepcopy(rpr)
            for tag in ("w:b", "w:bCs", "w:i", "w:iCs", "w:rtl"):
                for x in out.findall(qn(tag)):
                    out.remove(x)
            return out
    ppr_rpr = p_el.find(qn("w:pPr") + "/" + qn("w:rPr"))
    return copy.deepcopy(ppr_rpr) if ppr_rpr is not None else OxmlElement("w:rPr")


def emptied(proto):
    """Deep copy of a paragraph keeping only its pPr."""
    el = copy.deepcopy(proto)
    for child in list(el):
        if child.tag != qn("w:pPr"):
            el.remove(child)
    return el


# ── Inline markdown → runs ───────────────────────────────────────────────────

INLINE = re.compile(
    r"(\*\*.+?\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)"
    r"|(?<![\w*])\*(?!\s)[^*]+?(?<!\s)\*(?![\w*])"
    r"|(?<![\w_])_(?!\s)[^_]+?(?<!\s)_(?![\w_]))"
)
WHOLE_ITALIC = re.compile(r"\*[^*].*[^*]\*|_[^_].*[^_]_")


def segments(text, bold=False, italic=False):
    """Yield (text, bold, italic, code, url) segments."""
    pos = 0
    for m in INLINE.finditer(text):
        if m.start() > pos:
            yield text[pos : m.start()], bold, italic, False, None
        tok = m.group(0)
        if tok.startswith("**"):
            yield from segments(tok[2:-2], True, italic)
        elif tok.startswith("`"):
            yield tok[1:-1], bold, italic, True, None
        elif tok.startswith("["):
            label, url = re.match(r"\[([^\]]+)\]\(([^)]+)\)", tok).groups()
            for t, b, i, c, _ in segments(label, bold, italic):
                yield t, b, i, c, url
        else:
            yield from segments(tok[1:-1], bold, True)
        pos = m.end()
    if pos < len(text):
        yield text[pos:], bold, italic, False, None


def make_run(text, rpr, bold, italic, code, link):
    r = OxmlElement("w:r")
    rp = copy.deepcopy(rpr)
    def put(tag, **attrs):
        el = OxmlElement(tag)
        for k, v in attrs.items():
            el.set(qn(k), v)
        rp.append(el)
    if code:
        for x in rp.findall(qn("w:rFonts")):
            rp.remove(x)
        put("w:rFonts", **{"w:ascii": MONO, "w:hAnsi": MONO, "w:cs": MONO, "w:eastAsia": MONO})
    if bold:
        put("w:b", **{"w:val": "1"})
    if italic:
        put("w:i", **{"w:val": "1"})
    if link or code:
        for x in rp.findall(qn("w:color")):
            rp.remove(x)
        put("w:color", **{"w:val": ACCENT if link else "4c4d53"})
    if link:
        put("w:u", **{"w:val": "single"})
    # schema order matters to Word: rFonts, b, i, color, sz, u … — sort known tags
    order = ["w:rStyle", "w:rFonts", "w:b", "w:bCs", "w:i", "w:iCs", "w:color", "w:sz", "w:szCs", "w:u", "w:shd", "w:rtl"]
    rank = {qn(t): n for n, t in enumerate(order)}
    kids = sorted(list(rp), key=lambda e: rank.get(e.tag, 99))
    for k in list(rp):
        rp.remove(k)
    for k in kids:
        rp.append(k)
    r.append(rp)
    t = OxmlElement("w:t")
    t.set(qn("xml:space"), "preserve")
    t.text = text
    r.append(t)
    return r


def fill(p_el, text, rpr, part, force_italic=False):
    for t, b, i, c, url in segments(text, False, force_italic):
        run = make_run(t, rpr, b, i, c, url)
        if url:
            h = OxmlElement("w:hyperlink")
            h.set(qn("r:id"), part.relate_to(url, RT.HYPERLINK, is_external=True))
            h.append(run)
            p_el.append(h)
        else:
            p_el.append(run)
    return p_el


# ── Block builders ───────────────────────────────────────────────────────────


class Builder:
    def __init__(self, tpl: Template, base_dir: Path):
        self.t = tpl
        self.part = tpl.doc.part
        self.base_dir = base_dir
        self.body_rpr = base_rpr(tpl.body)
        self._lists = ListNumbering(tpl.doc)

    def para(self, proto, text, rpr=None, italic=False):
        el = fill(emptied(proto), text, rpr if rpr is not None else base_rpr(proto), self.part, italic)
        self.t.append(el)
        return el

    def heading(self, level, text):
        if level == 2:
            m = re.match(r"(\d+)\s+(.*)", text)
            text = f"{m.group(1)} \u00a0\u00a0{m.group(2)}" if m else text
            self.para(self.t.h1, text)
        else:
            self.para(self.t.h2, text)

    def body(self, text):
        if WHOLE_ITALIC.fullmatch(text):
            self.para(self.t.guidance, text[1:-1], italic=True)
        else:
            self.para(self.t.body, text, self.body_rpr)

    def callout(self, text):
        self.para(self.t.callout, text, base_rpr(self.t.callout))

    def rule(self):
        self.t.append(copy.deepcopy(self.t.rule))

    def list_items(self, items, ordered):
        num_id = self._lists.new(ordered)
        for text in items:
            el = emptied(self.t.body)
            ppr = el.find(qn("w:pPr"))
            num = element("w:numPr")
            num.append(element("w:ilvl", **{"w:val": "0"}))
            num.append(element("w:numId", **{"w:val": str(num_id)}))
            put_ordered(ppr, num, PPR_ORDER)
            put_ordered(ppr, element("w:ind", **{"w:left": "720", "w:hanging": "360"}), PPR_ORDER)
            fill(el, text, self.body_rpr, self.part)
            self.t.append(el)

    def image(self, alt, rel):
        path = (self.base_dir / rel).resolve()
        if not path.exists():
            raise SystemExit(f"image not found: {rel}")
        el = emptied(self.t.body)
        center(el)
        self.t.append(el)
        p = Paragraph(el, self.t.doc)
        run = p.add_run()
        pic = run.add_picture(str(path), width=MAX_IMAGE_WIDTH)
        if pic.height > MAX_IMAGE_HEIGHT:
            ratio = MAX_IMAGE_HEIGHT / pic.height
            pic.height, pic.width = MAX_IMAGE_HEIGHT, Emu(int(pic.width * ratio))
        doc_pr = run._r.find(".//" + qn("wp:docPr"))
        if doc_pr is not None:
            doc_pr.set("descr", alt)
        center(self.para(self.t.guidance, alt, italic=True))

    def table(self, header, rows):
        proto = self.t.table
        tbl = copy.deepcopy(proto)
        trs = tbl.findall(qn("w:tr"))
        head_tr, body_tr = trs[0], trs[1]
        head_tc, body_tc = head_tr.find(qn("w:tc")), body_tr.find(qn("w:tc"))
        for tr in trs:
            tbl.remove(tr)
        tbl_pr = tbl.find(qn("w:tblPr"))
        put_ordered(tbl_pr, element("w:tblW", **{"w:w": str(CONTENT_WIDTH_TWIPS), "w:type": "dxa"}),
                    ["w:tblStyle", "w:tblpPr", "w:tblOverlap", "w:bidiVisual", "w:tblStyleRowBandSize",
                     "w:tblStyleColBandSize", "w:tblW", "w:jc", "w:tblCellSpacing", "w:tblInd",
                     "w:tblBorders", "w:shd", "w:tblLayout", "w:tblCellMar", "w:tblLook"])
        grid = tbl.find(qn("w:tblGrid"))
        for g in list(grid):
            grid.remove(g)
        widths = column_widths(header, rows)
        for w in widths:
            grid.append(element("w:gridCol", **{"w:w": str(w)}))

        def row(tr_proto, tc_proto, cells):
            tr = copy.deepcopy(tr_proto)
            for tc in tr.findall(qn("w:tc")):
                tr.remove(tc)
            # the template's placeholder rows carry a fixed height; content rows size to text
            for tr_pr in tr.findall(qn("w:trPr")):
                for h in tr_pr.findall(qn("w:trHeight")):
                    tr_pr.remove(h)
            rpr = base_rpr(tc_proto.find(qn("w:p")))
            bold_proto = tc_proto is head_tc
            for col, text in enumerate(cells):
                tc = copy.deepcopy(tc_proto)
                put_ordered(tc.find(qn("w:tcPr")), element("w:tcW", **{"w:w": str(widths[col]), "w:type": "dxa"}), TCPR_ORDER)
                p = tc.find(qn("w:p"))
                for x in tc.findall(qn("w:p"))[1:]:
                    tc.remove(x)
                new_p = emptied(p)
                tc.replace(p, new_p)
                fill(new_p, f"**{text}**" if bold_proto and text and not text.startswith("**") else text, rpr, self.part)
                tr.append(tc)
            tbl.append(tr)

        row(head_tr, head_tc, header)
        for r in rows:
            row(body_tr, body_tc, r + [""] * (len(header) - len(r)))
        self.t.append(tbl)
        spacer = emptied(self.t.body)
        self.t.append(spacer)


def column_widths(header, rows):
    """Every column fits its longest word; the rest is shared by average text length."""
    n = len(header)
    plain = lambda s: re.sub(r"[*`_\[\]]|\]\([^)]*\)", "", s)
    mins, weight = [], []
    for c in range(n):
        cells = [header[c]] + [r[c] for r in rows if c < len(r)]
        longest = max((len(w) for cell in cells for w in plain(cell).split()), default=4)
        head_longest = max((len(w) for w in plain(header[c]).split()), default=4)
        mins.append(max(longest * 115, head_longest * 135) + 360)
        weight.append(min(max(sum(len(plain(x)) for x in cells) / len(cells), 6), 90))
    if sum(mins) >= CONTENT_WIDTH_TWIPS:
        widths = [int(CONTENT_WIDTH_TWIPS * m / sum(mins)) for m in mins]
    else:
        spare = CONTENT_WIDTH_TWIPS - sum(mins)
        widths = [int(m + spare * w / sum(weight)) for m, w in zip(mins, weight)]
    widths[-1] += CONTENT_WIDTH_TWIPS - sum(widths)
    return widths


class ListNumbering:
    """Adds one bullet and one decimal abstract definition; a fresh num per ordered list."""

    def __init__(self, doc):
        self.numbering = doc.part.numbering_part.element
        self.bullet_abs = self._abstract(9001, "bullet", "\u2022")
        self.decimal_abs = self._abstract(9002, "decimal", "%1.")
        self.next_id = 9100

    def _abstract(self, aid, fmt, text):
        a = OxmlElement("w:abstractNum"); a.set(qn("w:abstractNumId"), str(aid))
        lvl = OxmlElement("w:lvl"); lvl.set(qn("w:ilvl"), "0")
        for tag, val in (("w:start", "1"), ("w:numFmt", fmt), ("w:lvlText", text), ("w:lvlJc", "left")):
            e = OxmlElement(tag); e.set(qn("w:val"), val); lvl.append(e)
        ppr = OxmlElement("w:pPr"); ind = OxmlElement("w:ind")
        ind.set(qn("w:left"), "720"); ind.set(qn("w:hanging"), "360"); ppr.append(ind); lvl.append(ppr)
        a.append(lvl)
        first_num = self.numbering.find(qn("w:num"))
        (first_num.addprevious(a) if first_num is not None else self.numbering.append(a))
        return aid

    def new(self, ordered):
        self.next_id += 1
        num = OxmlElement("w:num"); num.set(qn("w:numId"), str(self.next_id))
        an = OxmlElement("w:abstractNumId"); an.set(qn("w:val"), str(self.decimal_abs if ordered else self.bullet_abs))
        num.append(an)
        if ordered:
            ov = OxmlElement("w:lvlOverride"); ov.set(qn("w:ilvl"), "0")
            so = OxmlElement("w:startOverride"); so.set(qn("w:val"), "1"); ov.append(so); num.append(ov)
        self.numbering.append(num)
        return self.next_id


# ── Markdown block parser ────────────────────────────────────────────────────


def split_row(line):
    cells = line.strip().strip("|").split("|")
    return [c.strip() for c in cells]


def convert(md_path: Path, tpl: Template) -> None:
    lines = md_path.read_text(encoding="utf-8").splitlines()
    # The template footer already carries "LaunchStack / Technical Design".
    while lines and (not lines[-1].strip() or re.fullmatch(r"LaunchStack\s+/\s+Technical Design", lines[-1].strip())):
        lines.pop()
    if lines and lines[-1].strip() == "---":
        lines.pop()

    b = Builder(tpl, md_path.parent)
    tpl.clear_body()
    b.para(tpl.label, "**LaunchStack \u00a0/\u00a0 TECHNICAL DESIGN**")
    i, seen_title, seen_meta = 0, False, False
    while i < len(lines):
        line = lines[i]
        s = line.strip()
        if not s:
            i += 1
            continue
        if s.startswith("```") or s.startswith("<"):
            raise SystemExit(f"line {i + 1}: unsupported block (code fence/HTML): {s[:60]}")
        if s.startswith("# ") and not seen_title:
            b.para(tpl.title, s[2:].strip())
            seen_title = True
        elif seen_title and not seen_meta and s.startswith("Feature "):
            meta = re.sub(r"\s+·\s+", " \u00a0·\u00a0 ", s)
            b.para(tpl.meta, meta)
            b.rule()
            seen_meta = True
        elif s.startswith("### "):
            b.heading(3, s[4:].strip())
        elif s.startswith("## "):
            b.heading(2, s[3:].strip())
        elif s == "---":
            b.rule()
        elif s.startswith(">"):
            quote = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                quote.append(lines[i].strip()[1:].strip())
                i += 1
            b.callout(" ".join(q for q in quote if q))
            continue
        elif re.fullmatch(r"!\[[^\]]*\]\([^)]+\)", s):
            alt, rel = re.match(r"!\[([^\]]*)\]\(([^)]+)\)", s).groups()
            b.image(alt, rel)
        elif s.startswith("|"):
            block = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                block.append(lines[i])
                i += 1
            if len(block) < 2 or not re.fullmatch(r"\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?", block[1].strip()):
                raise SystemExit(f"line {i - len(block) + 1}: table without a header separator")
            b.table(split_row(block[0]), [split_row(r) for r in block[2:]])
            continue
        elif re.match(r"[-*] ", s) or re.match(r"\d+\. ", s):
            ordered = bool(re.match(r"\d+\. ", s))
            items = []
            pat = r"\d+\. " if ordered else r"[-*] "
            while i < len(lines) and re.match(pat, lines[i].strip()):
                items.append(re.sub("^" + pat, "", lines[i].strip()))
                i += 1
                # continuation lines (wrapped by prettier) belong to the item
                while i < len(lines) and lines[i].startswith("  ") and lines[i].strip() and not re.match(r"[-*] |\d+\. ", lines[i].strip()):
                    items[-1] += " " + lines[i].strip()
                    i += 1
            b.list_items(items, ordered)
            continue
        else:
            para = [s]
            i += 1
            while i < len(lines):
                nxt = lines[i].strip()
                if not nxt or re.match(r"(#{1,3} |>|\||!\[|---$|[-*] |\d+\. |```)", nxt):
                    break
                para.append(nxt)
                i += 1
            b.body(" ".join(para))
            continue
        i += 1

    for section in tpl.doc.sections:
        for p in section.footer.paragraphs:
            for r in p.runs:
                if "Technical Design Template" in r.text:
                    r.text = r.text.replace("Technical Design Template", "Technical Design")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("markdown", type=Path)
    ap.add_argument("output", type=Path)
    ap.add_argument("--template", type=Path, help="template .docx (default: download the Google Docs template)")
    args = ap.parse_args(argv)
    template = args.template
    if template is None:
        template = Path(tempfile.mkdtemp()) / "template.docx"
        urllib.request.urlretrieve(TEMPLATE_URL, template)
    tpl = Template(template)
    convert(args.markdown, tpl)
    args.output.expanduser().parent.mkdir(parents=True, exist_ok=True)
    tpl.doc.save(str(args.output.expanduser()))
    print(f"wrote {args.output.expanduser()}")


if __name__ == "__main__":
    sys.exit(main())
