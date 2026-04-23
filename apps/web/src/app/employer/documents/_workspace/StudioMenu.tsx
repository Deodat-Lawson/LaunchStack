"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconBolt } from "./icons";
import { DEMOTED_FEATURES } from "./types";

export interface StudioMenuProps {
  /** Fires with the feature id when the user picks one; if omitted, falls back to direct navigation. */
  onPickFeature?: (featureId: string) => void;
  /** Fires when the main Studio button is clicked; if omitted, opens the menu. */
  onOpenStudio?: () => void;
}

/**
 * Studio "header" button + hover mega-menu — lives in the AskPanel topbar.
 * Clicking or hovering reveals the 9 demoted features. Primary action opens
 * the StudioDrawer (via `onOpenStudio`); falls back to direct navigation if
 * no handler is wired.
 */
export function StudioMenu({ onPickFeature, onOpenStudio }: StudioMenuProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setMenuOpen(true);
  };
  const close = () => {
    closeTimer.current = setTimeout(() => setMenuOpen(false), 120);
  };

  const pickFeature = (featureId: string, href: string) => {
    setMenuOpen(false);
    if (onPickFeature) {
      onPickFeature(featureId);
    } else {
      router.push(href);
    }
  };

  const features = DEMOTED_FEATURES;

  return (
    <div style={{ position: "relative" }} onMouseEnter={open} onMouseLeave={close}>
      <button
        onClick={() => {
          if (onOpenStudio) {
            setMenuOpen(false);
            onOpenStudio();
          } else {
            setMenuOpen((v) => !v);
          }
        }}
        title="Open Studio"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "5px 11px 5px 9px",
          borderRadius: 8,
          background: "linear-gradient(180deg, var(--accent), var(--accent-deep))",
          color: "white",
          fontSize: 12.5,
          fontWeight: 600,
          boxShadow: menuOpen
            ? "0 2px 10px var(--accent-glow), 0 0 0 3px var(--accent-glow)"
            : "0 1px 4px var(--accent-glow)",
          transition: "box-shadow 140ms, transform 120ms",
          transform: menuOpen ? "translateY(-0.5px)" : "none",
        }}
      >
        <IconBolt size={13} />
        Studio
      </button>

      {menuOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 60,
            width: 440,
            padding: 10,
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 12,
            boxShadow:
              "0 18px 42px var(--scrim-shadow), 0 2px 6px rgba(0,0,0,0.06)",
            animation: "lsw-fadeIn 120ms ease-out",
          }}
        >
          <div
            style={{
              padding: "6px 8px 10px",
              display: "flex",
              alignItems: "baseline",
              gap: 8,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>Studio</div>
            <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
              Tools that don&apos;t disturb your ask thread
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            {features.map((f) => {
              const Icon = f.Icon;
              return (
                <button
                  key={f.id}
                  onClick={() => pickFeature(f.id, f.href)}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 9,
                    padding: "8px 10px",
                    borderRadius: 8,
                    textAlign: "left",
                    transition: "background 120ms",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--line-2)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 6,
                      flexShrink: 0,
                      background: "var(--accent-soft)",
                      color: "var(--accent-ink)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Icon size={12} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{ display: "flex", alignItems: "baseline", gap: 6 }}
                    >
                      <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--ink)" }}>
                        {f.label}
                      </div>
                      {f.kbd && (
                        <span
                          className="mono"
                          style={{ fontSize: 9.5, color: "var(--ink-4)" }}
                        >
                          {f.kbd}
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--ink-3)",
                        lineHeight: 1.35,
                        marginTop: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                      }}
                    >
                      {f.desc}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export interface StudioFABProps {
  hidden?: boolean;
  /** Fires with a feature id when a pinned item is clicked; undefined id means "open Studio home". */
  onPickFeature?: (featureId: string | undefined) => void;
}

/** Floating action button — bottom-right. Hover reveals a mini quick-open panel. */
export function StudioFAB({ hidden, onPickFeature }: StudioFABProps) {
  const router = useRouter();
  const [hover, setHover] = useState(false);
  const [miniOpen, setMiniOpen] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pinnedIds: readonly string[] = ["draft", "workflows", "notes", "audit"];
  const pinned = pinnedIds
    .map((id) => DEMOTED_FEATURES.find((f) => f.id === id))
    .filter((f): f is NonNullable<typeof f> => !!f);

  const openMini = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setMiniOpen(true);
  };
  const closeMini = () => {
    hideTimer.current = setTimeout(() => setMiniOpen(false), 180);
  };

  const pickFeature = (featureId: string | undefined, href: string | null) => {
    setMiniOpen(false);
    if (onPickFeature) {
      onPickFeature(featureId);
    } else if (href) {
      router.push(href);
    }
  };

  if (hidden) return null;

  return (
    <div
      style={{
        position: "fixed",
        right: 18,
        bottom: 18,
        zIndex: 80,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 8,
      }}
      onMouseEnter={openMini}
      onMouseLeave={closeMini}
    >
      {miniOpen && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: 6,
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 12,
            boxShadow: "0 12px 28px var(--scrim-shadow)",
            animation: "lsw-fadeIn 120ms ease-out",
            minWidth: 200,
          }}
        >
          <div
            className="mono"
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.1em",
              color: "var(--ink-3)",
              textTransform: "uppercase",
              padding: "6px 10px 4px",
            }}
          >
            Quick open
          </div>

          {pinned.map((f) => {
            const Icon = f.Icon;
            return (
              <button
                key={f.id}
                onClick={() => pickFeature(f.id, f.href)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "7px 10px",
                  borderRadius: 7,
                  textAlign: "left",
                  fontSize: 12.5,
                  color: "var(--ink-2)",
                  transition: "background 120ms, color 120ms",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--line-2)";
                  e.currentTarget.style.color = "var(--ink)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "var(--ink-2)";
                }}
              >
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 5,
                    background: "var(--accent-soft)",
                    color: "var(--accent-ink)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Icon size={11} />
                </div>
                <span style={{ flex: 1 }}>{f.label}</span>
                {f.kbd && (
                  <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)" }}>
                    {f.kbd}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <button
        onClick={() => pickFeature(undefined, "/employer/documents?view=generator")}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        title="Studio"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: hover || miniOpen ? "10px 16px" : "10px 12px",
          borderRadius: 999,
          background: "linear-gradient(180deg, var(--accent), var(--accent-deep))",
          color: "white",
          fontSize: 13,
          fontWeight: 600,
          boxShadow:
            hover || miniOpen
              ? "0 10px 28px var(--accent-glow), 0 2px 6px rgba(0,0,0,0.12)"
              : "0 4px 14px var(--accent-glow), 0 1px 3px rgba(0,0,0,0.08)",
          transition:
            "padding 140ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 180ms, transform 120ms",
          transform: hover || miniOpen ? "translateY(-1px)" : "none",
        }}
      >
        <IconBolt size={15} />
        <span
          style={{
            maxWidth: hover || miniOpen ? 60 : 0,
            overflow: "hidden",
            whiteSpace: "nowrap",
            transition: "max-width 180ms cubic-bezier(0.2, 0.8, 0.2, 1)",
          }}
        >
          Studio
        </span>
      </button>
    </div>
  );
}
