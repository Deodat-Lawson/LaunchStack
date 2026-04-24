"use client";

import { useEffect, useMemo, useState } from "react";
import { IconBolt, IconX } from "./icons";
import { renderStudioPane } from "./StudioPanes";
import { STUDIO_GROUPS, type StudioFeature } from "./types";

export interface StudioDrawerProps {
  open: boolean;
  initialFeatureId?: string | null;
  onClose: () => void;
  /**
   * When `true`, renders as a flex sibling that fills the remaining workspace
   * width (replacing the chat area). When `false` (default), keeps the legacy
   * right-side overlay behavior with its own backdrop.
   */
  inline?: boolean;
  /**
   * Role of the current user. When not `employer`/`owner`, Management entries
   * marked `companyOnly` are hidden.
   */
  role?: string | null;
  /**
   * Feature id that's currently rendered in the main workspace area. Hides the
   * Expand button when viewing the already-expanded feature.
   */
  activeFeatureId?: string;
  /**
   * Promote the current pane to the main workspace area — the drawer closes
   * and the picked feature replaces Chat. If omitted, the Expand button is
   * hidden.
   */
  onExpand?: (featureId: string) => void;
}

/** Feature ids that render an interactive pane (not just a link-out). */
const CUSTOM_PANE_IDS = new Set([
  "draft",
  "rewrite",
  "notes",
  "workflows",
  "video-gen",
  "image-gen",
  "audio-gen",
  "marketing",
  "metadata",
  "settings",
  "analytics",
]);

const COMPANY_ROLES = new Set(["employer", "owner"]);

export function StudioDrawer({
  open,
  initialFeatureId,
  onClose,
  inline = false,
  role,
  activeFeatureId,
  onExpand,
}: StudioDrawerProps) {
  const visibleGroups = useMemo(() => {
    const canSeeCompany = role ? COMPANY_ROLES.has(role) : true;
    return STUDIO_GROUPS.map((g) => ({
      ...g,
      features: g.features.filter((f) => canSeeCompany || !f.companyOnly),
    })).filter((g) => g.features.length > 0);
  }, [role]);

  const firstFeatureId = visibleGroups[0]?.features[0]?.id ?? "draft";
  const [activeId, setActiveId] = useState<string>(
    initialFeatureId ?? firstFeatureId,
  );

  useEffect(() => {
    if (open && initialFeatureId) setActiveId(initialFeatureId);
  }, [open, initialFeatureId]);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  const active: StudioFeature = useMemo(() => {
    for (const g of visibleGroups) {
      const found = g.features.find((f) => f.id === activeId);
      if (found) return found;
    }
    return visibleGroups[0]?.features[0] ?? {
      id: "draft",
      label: "Templated Drafts",
      Icon: () => null,
      desc: "",
    };
  }, [visibleGroups, activeId]);

  if (!open) return null;

  const pane = renderStudioPane(active, onClose);
  const canExpand = !!onExpand && activeFeatureId !== active.id;

  const body = (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        width: inline
          ? "100%"
          : CUSTOM_PANE_IDS.has(active.id)
            ? 1280
            : 820,
        maxWidth: inline ? "100%" : "96vw",
        height: "100%",
        flex: inline ? 1 : undefined,
        background: "var(--panel)",
        borderLeft: inline ? "none" : "1px solid var(--line)",
        boxShadow: inline ? "none" : "-24px 0 60px var(--scrim-shadow)",
        display: "flex",
        animation: inline ? "lsw-fadeIn 140ms ease-out" : "lsw-drawerIn 220ms ease-out",
        transition: "width 180ms ease-out",
      }}
    >
      {/* Left rail — grouped feature list */}
      <aside
        style={{
          width: 240,
          flexShrink: 0,
          borderRight: "1px solid var(--line)",
          background: "var(--panel-2)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px 14px 10px",
            display: "flex",
            alignItems: "center",
            gap: 9,
          }}
        >
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 5,
              background: "var(--accent-soft)",
              color: "var(--accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <IconBolt size={13} />
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>Studio</div>
        </div>

        <div style={{ padding: "2px 8px 8px", overflowY: "auto", flex: 1 }}>
          {visibleGroups.map((group, gi) => (
            <div key={group.id} style={{ marginTop: gi === 0 ? 0 : 12 }}>
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
              {group.features.map((f) => {
                const Icon = f.Icon;
                const isActive = f.id === activeId;
                const isComing = f.comingSoon === true;
                return (
                  <button
                    key={f.id}
                    onClick={() => setActiveId(f.id)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      padding: "7px 9px",
                      marginBottom: 1,
                      borderRadius: 6,
                      textAlign: "left",
                      background: isActive ? "var(--accent-soft)" : "transparent",
                      transition: "background 100ms",
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) e.currentTarget.style.background = "var(--line-2)";
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 5,
                        background: isActive ? "var(--panel)" : "var(--line-2)",
                        color: isActive ? "var(--accent)" : "var(--ink-2)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Icon size={12} />
                    </div>
                    <span
                      style={{
                        flex: 1,
                        fontSize: 12.5,
                        fontWeight: isActive ? 600 : 500,
                        color: isActive ? "var(--accent-ink)" : "var(--ink-2)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {f.label}
                    </span>
                    {isComing && (
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
                          flexShrink: 0,
                        }}
                        title="Coming soon"
                      >
                        SOON
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </aside>

      {/* Right detail pane */}
      <section
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 10,
            right: 12,
            display: "flex",
            alignItems: "center",
            gap: 6,
            zIndex: 5,
          }}
        >
          {canExpand && (
            <button
              onClick={() => onExpand!(active.id)}
              title={`Expand ${active.label} to main view`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                height: 30,
                padding: "0 12px",
                borderRadius: 7,
                border: "1px solid var(--line)",
                background: "var(--panel)",
                color: "var(--ink-2)",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                transition: "background 120ms, color 120ms, border-color 120ms",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--accent-soft)";
                e.currentTarget.style.color = "var(--accent-ink)";
                e.currentTarget.style.borderColor = "var(--accent)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--panel)";
                e.currentTarget.style.color = "var(--ink-2)";
                e.currentTarget.style.borderColor = "var(--line)";
              }}
            >
              <svg
                width={12}
                height={12}
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 8V4h4M16 12v4h-4M4 4l5 5M16 16l-5-5" />
              </svg>
              Expand
            </button>
          )}
          <button
            onClick={onClose}
            title="Close Studio"
            style={{
              width: 30,
              height: 30,
              borderRadius: 7,
              color: "var(--ink-3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--line-2)";
              e.currentTarget.style.color = "var(--ink)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--ink-3)";
            }}
          >
            <IconX size={14} />
          </button>
        </div>
        {pane}
      </section>
    </div>
  );

  if (inline) return body;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        background: "var(--scrim)",
        backdropFilter: "blur(3px)",
        display: "flex",
        justifyContent: "flex-end",
        animation: "lsw-fadeIn 140ms",
      }}
    >
      {body}
    </div>
  );
}

