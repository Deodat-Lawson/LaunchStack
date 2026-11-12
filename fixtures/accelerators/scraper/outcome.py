"""What one Program's refresh found and what it would write."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from . import iso


@dataclass
class Outcome:
    program_id: str
    program: dict
    path: Path
    changed: bool = False
    stamped: bool = False
    drift: bool = False
    reached: bool = False
    logo: tuple[Path, bytes] | None = None
    old_logo: Path | None = None
    suspect_logo: str | None = None
    lines: list[str] = field(default_factory=list)
    observations: list[dict[str, str]] = field(default_factory=list)

    def note(self, status: str, detail: str) -> None:
        self.lines.append(f"{status}\t{self.program_id}\t{detail}")

    def observe(self, evidence_id: str, outcome: str, now: datetime, detail: str) -> None:
        self.observations.append(
            {"programId": self.program_id, "evidenceId": evidence_id, "outcome": outcome, "checkedAt": iso(now), "detail": detail}
        )
