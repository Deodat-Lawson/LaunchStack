"use client";

import {
  type ComponentType,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { IconPlus, IconSearch, type IconProps } from "./icons";
import { DEMOTED_FEATURES, SOURCE_META, type WorkspaceSource } from "./types";

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  sources: WorkspaceSource[];
  onOpenAdd: () => void;
  onPickSource: (id: string) => void;
  /** If provided, feature rows open Studio with this id instead of hard-navigating. */
  onPickFeature?: (featureId: string) => void;
}

interface PaletteItem {
  kind: "action" | "feature" | "source";
  id: string;
  label: string;
  sub?: string;
  Icon: ComponentType<IconProps>;
  onRun: () => void;
}

export function CommandPalette({
  open,
  onClose,
  sources,
  onOpenAdd,
  onPickSource,
  onPickFeature,
}: CommandPaletteProps) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open]);

  const navigate = useCallback(
    (href: string) => {
      router.push(href);
    },
    [router],
  );

  const items = useMemo<PaletteItem[]>(() => {
    const base: PaletteItem[] = [];
    base.push({
      kind: "action",
      id: "add",
      label: "Add a new source",
      sub: "Files, folder, audio, connect…",
      Icon: IconPlus,
      onRun: onOpenAdd,
    });
    DEMOTED_FEATURES.forEach((f) =>
      base.push({
        kind: "feature",
        id: f.id,
        label: f.label,
        sub: f.desc,
        Icon: f.Icon,
        onRun: () => {
          if (onPickFeature) onPickFeature(f.id);
          else navigate(f.href);
        },
      }),
    );
    sources.forEach((s) => {
      const meta = SOURCE_META[s.type] ?? SOURCE_META.doc;
      base.push({
        kind: "source",
        id: s.id,
        label: s.title,
        sub: `${meta.label} · ${s.size || s.added}`,
        Icon: meta.Icon,
        onRun: () => onPickSource(s.id),
      });
    });
    const qq = q.toLowerCase().trim();
    if (!qq) return base;
    return base.filter(
      (i) =>
        i.label.toLowerCase().includes(qq) ||
        (i.sub ?? "").toLowerCase().includes(qq),
    );
  }, [q, sources, onOpenAdd, onPickSource, onPickFeature, navigate]);

  useEffect(() => {
    if (idx >= items.length) setIdx(0);
  }, [items, idx]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown") {
        e.preventDefault();
        setIdx((i) => Math.min(i + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const it = items[idx];
        if (it) {
          it.onRun();
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, items, idx, onClose]);

  if (!open) return null;

  const groups = {
    action: { label: "Actions", items: items.filter((i) => i.kind === "action") },
    feature: { label: "Features", items: items.filter((i) => i.kind === "feature") },
    source: { label: "Sources", items: items.filter((i) => i.kind === "source") },
  } as const;

  let counter = -1;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 120,
        background: "var(--scrim)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
        animation: "lsw-fadeIn 140ms",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 620,
          maxWidth: "92vw",
          background: "var(--panel)",
          borderRadius: 14,
          boxShadow: "0 30px 80px var(--scrim-shadow), 0 0 0 1px var(--line)",
          overflow: "hidden",
          animation: "lsw-modalIn 180ms",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 18px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <IconSearch size={14} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
            }}
            placeholder="Jump to anything — sources, features, actions…"
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: 15,
              color: "var(--ink)",
            }}
          />
          <span
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--ink-3)",
              padding: "2px 6px",
              border: "1px solid var(--line)",
              borderRadius: 4,
            }}
          >
            ESC
          </span>
        </div>
        <div style={{ maxHeight: 420, overflowY: "auto", padding: "6px 0" }}>
          {Object.entries(groups).map(([k, g]) =>
            g.items.length === 0 ? null : (
              <div key={k}>
                <div
                  className="mono"
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    color: "var(--ink-3)",
                    textTransform: "uppercase",
                    padding: "10px 18px 4px",
                  }}
                >
                  {g.label}
                </div>
                {g.items.map((it) => {
                  counter += 1;
                  const active = counter === idx;
                  const Icon = it.Icon;
                  const itemIdx = items.indexOf(it);
                  return (
                    <div
                      key={it.id + k}
                      onMouseEnter={() => setIdx(itemIdx)}
                      onClick={() => {
                        it.onRun();
                        onClose();
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "8px 18px",
                        cursor: "pointer",
                        background: active ? "var(--accent-soft)" : "transparent",
                      }}
                    >
                      <div
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 6,
                          background: active ? "var(--panel)" : "var(--line-2)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: active ? "var(--accent)" : "var(--ink-2)",
                        }}
                      >
                        <Icon size={13} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 500,
                            color: active ? "var(--accent-ink)" : "var(--ink)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {it.label}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--ink-3)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {it.sub}
                        </div>
                      </div>
                      {active && (
                        <span
                          className="mono"
                          style={{
                            fontSize: 10,
                            color: "var(--accent)",
                            padding: "2px 6px",
                            border: "1px solid var(--accent)",
                            borderRadius: 4,
                          }}
                        >
                          ↵
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ),
          )}
          {items.length === 0 && (
            <div
              style={{
                padding: "30px 18px",
                textAlign: "center",
                color: "var(--ink-3)",
                fontSize: 13,
              }}
            >
              No matches for <span className="mono">&ldquo;{q}&rdquo;</span>
            </div>
          )}
        </div>
        <div
          style={{
            padding: "9px 18px",
            borderTop: "1px solid var(--line)",
            display: "flex",
            gap: 14,
            fontSize: 10,
            color: "var(--ink-3)",
          }}
          className="mono"
        >
          <span>
            <span
              style={{
                padding: "1px 5px",
                border: "1px solid var(--line)",
                borderRadius: 4,
              }}
            >
              ↑↓
            </span>{" "}
            navigate
          </span>
          <span>
            <span
              style={{
                padding: "1px 5px",
                border: "1px solid var(--line)",
                borderRadius: 4,
              }}
            >
              ↵
            </span>{" "}
            open
          </span>
          <span style={{ marginLeft: "auto" }}>{items.length} results</span>
        </div>
      </div>
    </div>
  );
}
