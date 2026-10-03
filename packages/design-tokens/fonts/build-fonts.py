"""Rebuild Inter.woff2 and JetBrainsMono.woff2 from Google Fonts' sources.

The two files are what next/font/google used to download at build: the same
upstream TTFs Google Fonts serves (pinned below), cut to the same unicode
ranges and OpenType features. Google splits each face into one file per
subset; next/font/local takes one file per face, so here they are merged
into one. Self-hosting them is what keeps a build from depending on
fonts.googleapis.com — see README.md.

    python3 -m venv /tmp/fonts && /tmp/fonts/bin/pip install fonttools brotli
    /tmp/fonts/bin/python packages/design-tokens/fonts/build-fonts.py

Output is deterministic for a given fonttools version (the committed files were
built with 4.67.0).
"""

import io
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HERE = Path(__file__).resolve().parent
GOOGLE_FONTS = "https://raw.githubusercontent.com/google/fonts"

# Union of the unicode-range of every subset Google Fonts serves for these
# families: latin, latin-ext, vietnamese, greek, greek-ext, cyrillic,
# cyrillic-ext. Codepoints a face lacks are skipped.
UNICODES = ",".join(
    [
        # latin
        "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,"
        "U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,"
        "U+FEFF,U+FFFD",
        # latin-ext
        "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1D00-1DBF,"
        "U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C4,U+2113,"
        "U+2C60-2C7F,U+A720-A7FF",
        # vietnamese
        "U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,"
        "U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+1EA0-1EF9,U+20AB",
        # greek, greek-ext
        "U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF,"
        "U+1F00-1FFF",
        # cyrillic, cyrillic-ext
        "U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116,U+0460-052F,U+1C80-1C8A,"
        "U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F",
    ]
)

FACES = [
    {
        "out": "Inter.woff2",
        # Inter 4.001 (git-66647c0bb), both axes: opsz 14–32, wght 100–900.
        "commit": "e1d6480102fed30739fead0faee463101f892c8f",
        "path": "ofl/inter/Inter%5Bopsz,wght%5D.ttf",
        "license": ("ofl/inter/OFL.txt", "OFL-Inter.txt"),
        "axes": None,
        # The features Google keeps in its Inter files. tokens.css relies on
        # this set (tnum, frac); the cv/ss alternates were never served.
        "features": "calt,ccmp,dnom,frac,kern,locl,mark,mkmk,numr,pnum,tnum",
    },
    {
        "out": "JetBrainsMono.woff2",
        # JetBrains Mono 2.211. The app asks for weights 400 and 500 only, so
        # the wght axis is cut to that range.
        "commit": "2e05c1cf00a6e4f40a4b931600a90881c26e15cd",
        "path": "ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf",
        "license": ("ofl/jetbrainsmono/OFL.txt", "OFL-JetBrainsMono.txt"),
        "axes": {"wght": (400, 500)},
        "features": "calt,ccmp,frac,locl,mark",
    },
]


def fetch(commit: str, path: str) -> bytes:
    with urllib.request.urlopen(f"{GOOGLE_FONTS}/{commit}/{path}", timeout=60) as res:
        return res.read()


def build(face: dict) -> None:
    font = TTFont(io.BytesIO(fetch(face["commit"], face["path"])), recalcTimestamp=False)
    if face["axes"]:
        # Round-trip through bytes: the subsetter trips over the lazily
        # loaded gvar the instancer leaves behind.
        buf = io.BytesIO()
        instancer.instantiateVariableFont(font, face["axes"]).save(buf)
        font = TTFont(io.BytesIO(buf.getvalue()), recalcTimestamp=False)

    options = subset.Options()
    options.layout_features = face["features"].split(",")
    options.hinting = False
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=subset.parse_unicodes(UNICODES))
    subsetter.subset(font)

    out = HERE / face["out"]
    font.flavor = "woff2"
    font.save(out)
    print(f"{out.name}: {out.stat().st_size} bytes")

    license_path, license_out = face["license"]
    (HERE / license_out).write_bytes(fetch(face["commit"], license_path))


if __name__ == "__main__":
    for face in FACES:
        build(face)
