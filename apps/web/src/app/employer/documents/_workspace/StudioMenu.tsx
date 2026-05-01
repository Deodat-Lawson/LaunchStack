"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconBolt } from "./icons";
import { STUDIO_GROUPS } from "./types";

export interface StudioMenuProps {
  /** Fires with the feature id when the user picks one; if omitted, falls back to direct navigation. */
  onPickFeature?: (featureId: string) => void;
  /** Fires when the main Studio button is clicked; if omitted, opens the menu. */
  onOpenStudio?: () => void;
  /** Role of the current user — filters company-only Management entries. */
  role?: string | null;
}

const COMPANY_ROLES = new Set(["employer", "owner"]);

/**
 * Studio "header" button + hover mega-menu — lives in the AskPanel / expanded
 * tool topbar. **`onOpenStudio`** should open the drawer/sidebar only; individual
 * tiles call **`onPickFeature`** to jump straight to full-width workspace (parent
 * wires `expandFeature` vs `openFeature` accordingly).
 */
export function StudioMenu({ onPickFeature, onOpenStudio, role }: StudioMenuProps) {
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

  const canSeeCompany = role ? COMPANY_ROLES.has(role) : true;
  const groups = STUDIO_GROUPS.map((g) => ({
    ...g,
    features: g.features.filter((f) => canSeeCompany || !f.companyOnly),
  })).filter((g) => g.features.length > 0);

  const pickFeature = (featureId: string, href?: string) => {
    setMenuOpen(false);
    if (onPickFeature) {
      onPickFeature(featureId);
    } else if (href) {
      router.push(href);
    }
  };

  return (
    <div style={{ position: "relative" }} onMouseEnter={open} onMouseLeave={close}>
      <button
        type="button"
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
            width: 460,
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
              Tools and management for your workspace
            </div>
          </div>

          {groups.map((group) => (
            <div key={group.id} style={{ marginTop: 4 }}>
              <div
                className="mono"
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  color: "var(--ink-3)",
                  textTransform: "uppercase",
                  padding: "6px 10px 4px",
                }}
              >
                {group.label}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                {group.features.map((f) => {
                  const Icon = f.Icon;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => pickFeature(f.id, f.href)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "7px 10px",
                        minHeight: 40,
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
                          style={{ display: "flex", alignItems: "center", gap: 6 }}
                        >
                          <div
                            style={{
                              fontSize: 12.5,
                              fontWeight: 500,
                              color: "var(--ink)",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {f.label}
                          </div>
                          {f.comingSoon && (
                            <span
                              className="mono"
                              style={{
                                fontSize: 9,
                                fontWeight: 600,
                                letterSpacing: "0.04em",
                                color: "var(--ink-3)",
                                padding: "1px 5px",
                                borderRadius: 4,
                                background: "var(--line-2)",
                              }}
                            >
                              SOON
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
          ))}
        </div>
      )}
    </div>
  );
}
