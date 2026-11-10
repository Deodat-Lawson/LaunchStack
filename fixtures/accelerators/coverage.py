#!/usr/bin/env python3
"""Regenerate COVERAGE.md from the published Program contract."""

from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    raise SystemExit(
        subprocess.call(
            ["pnpm", "--filter", "@launchstack/web", "accelerators:publish-intelligence"],
            cwd=ROOT,
        )
    )


if __name__ == "__main__":
    main()
