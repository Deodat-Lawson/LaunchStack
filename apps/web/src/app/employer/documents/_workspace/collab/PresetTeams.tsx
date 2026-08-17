"use client";

/**
 * Preset teams — a whole room added in one click.
 *
 * Deliberately placed above the roster: a workspace that has never run a
 * meeting has four generic starter agents and no idea what a good room looks
 * like, and "write six system prompts first" is the step where people give up.
 *
 * Applying is additive. A handle already in use is shown as a conflict *before*
 * the click rather than reported as a skip afterwards, because the resolution
 * (rename the existing agent, or accept the pack minus that seat) is a decision
 * only the user can make.
 */

import React, { useCallback, useEffect, useState } from "react";

import { Badge, Button, Card, Section } from "~/app/employer/_components/primitives";
import { StatusNote } from "../settings/ui";
import { initialsOf, type PersonaPack } from "./types";

interface PresetTeamsProps {
  /** Refreshes the roster after a pack lands. */
  onApplied: () => Promise<void> | void;
}

export function PresetTeams({ onApplied }: PresetTeamsProps) {
  const [packs, setPacks] = useState<PersonaPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/collab/agents/presets");
      const body = (await response.json()) as { packs?: PersonaPack[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not load preset teams");
      setPacks(body.packs ?? []);
    } catch (err) {
      setNotice({
        tone: "danger",
        text: err instanceof Error ? err.message : "Could not load preset teams",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const apply = useCallback(
    async (pack: PersonaPack) => {
      setApplying(pack.id);
      setNotice(null);
      try {
        const response = await fetch("/api/collab/agents/presets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ packId: pack.id }),
        });
        const body = (await response.json()) as {
          created?: string[];
          skipped?: string[];
          error?: string;
        };
        if (!response.ok) throw new Error(body.error ?? "Could not add that team");

        const created = body.created ?? [];
        const skipped = body.skipped ?? [];
        setNotice({
          tone: "ok",
          text:
            created.length === 0
              ? `Every agent in ${pack.name} is already on the roster. Nothing changed.`
              : `Added ${created.length} agent${created.length === 1 ? "" : "s"}` +
                (skipped.length > 0
                  ? `. Kept your existing ${skipped.map((k) => `@${k}`).join(", ")}.`
                  : "."),
        });
        await load();
        await onApplied();
      } catch (err) {
        setNotice({
          tone: "danger",
          text: err instanceof Error ? err.message : "Could not add that team",
        });
      } finally {
        setApplying(null);
      }
    },
    [load, onApplied],
  );

  if (loading && packs.length === 0) return null;

  return (
    <Section
      title="Preset teams"
      description="A room that already works — roles that do not overlap, prompts that give each agent something to defend, and a turn policy that suits how that room argues."
    >
      {notice && <StatusNote tone={notice.tone === "ok" ? "ok" : "danger"}>{notice.text}</StatusNote>}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {packs.map((pack) => (
          <PackCard
            key={pack.id}
            pack={pack}
            busy={applying === pack.id}
            onApply={() => void apply(pack)}
          />
        ))}
      </div>
    </Section>
  );
}

function PackCard({
  pack,
  busy,
  onApply,
}: {
  pack: PersonaPack;
  busy: boolean;
  onApply: () => void;
}) {
  const allPresent = pack.conflicts.length === pack.personas.length;

  return (
    <Card>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 240, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 14 }}>{pack.name}</strong>
              <Badge>{pack.personas.length} agents</Badge>
              {allPresent && <Badge>Already added</Badge>}
            </div>
            <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)" }}>{pack.description}</p>
            <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>
              Best for: {pack.bestFor}
            </p>
          </div>

          <Button onClick={onApply} disabled={busy || allPresent}>
            {busy ? "Adding…" : allPresent ? "On the roster" : "Add this team"}
          </Button>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {pack.personas.map((persona) => {
            const conflict = pack.conflicts.includes(persona.key);
            return (
              <div
                key={persona.key}
                title={
                  conflict
                    ? `You already have @${persona.key} — it will be left exactly as it is`
                    : persona.promptPreview
                }
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px 6px 6px",
                  border: "1px solid var(--line)",
                  borderRadius: 999,
                  opacity: conflict ? 0.55 : 1,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: persona.accent ?? "var(--ink-3)",
                    color: "white",
                    fontSize: 9,
                    fontWeight: 700,
                    display: "grid",
                    placeItems: "center",
                    flex: "none",
                  }}
                >
                  {initialsOf(persona.displayName)}
                </span>
                <span style={{ fontSize: 12 }}>
                  <span style={{ fontWeight: 600 }}>{persona.role}</span>
                  <span style={{ color: "var(--ink-3)", marginLeft: 6 }}>@{persona.key}</span>
                </span>
              </div>
            );
          })}
        </div>

        <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>
          Suggested: {pack.suggested.turnPolicy.replace(/_/g, " ")}
          {pack.suggested.moderatorKey ? ` chaired by @${pack.suggested.moderatorKey}` : ""}, up to{" "}
          {pack.suggested.maxTurns} turns.
          {pack.conflicts.length > 0 && !allPresent
            ? ` Your existing ${pack.conflicts.map((k) => `@${k}`).join(", ")} will be kept as-is.`
            : ""}
        </p>
      </div>
    </Card>
  );
}
