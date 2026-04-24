"use client";

import React, { useState, useEffect } from "react";
import { Globe, Target, MapPin } from "lucide-react";
import { legalTheme as s } from "~/app/employer/documents/components/LegalGeneratorTheme";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { VisibilityBadge } from "./VisibilityBadge";
import { PriorityBadge } from "./PriorityBadge";
import type {
  MarketsInfo,
  MetadataFact,
} from "@launchstack/features/company-metadata";

interface MarketsSectionProps {
  markets: MarketsInfo;
  isEditMode?: boolean;
  onFieldSave?: (path: string, value: string) => Promise<void>;
}

export function MarketsSection({
  markets,
  isEditMode,
  onFieldSave,
}: MarketsSectionProps) {
  const hasPrimary = markets.primary && markets.primary.length > 0;
  const hasVerticals = markets.verticals && markets.verticals.length > 0;
  const hasGeographies = markets.geographies && markets.geographies.length > 0;

  return (
    <div className={s.panel} style={{ padding: 22 }}>
      <div className="flex items-center gap-3" style={{ marginBottom: 4 }}>
        <div className={s.brandMarkSm}>
          <Globe className="h-[14px] w-[14px]" />
        </div>
        <div className="min-w-0">
          <h2
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 600,
              color: "var(--ink)",
              letterSpacing: "-0.01em",
            }}
          >
            Markets
          </h2>
          <p
            style={{
              margin: "2px 0 0",
              fontSize: 12,
              color: "var(--ink-3)",
            }}
          >
            Target markets and geographic presence
          </p>
        </div>
      </div>
      <hr className={s.hair} style={{ margin: "14px 0 18px" }} />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {hasPrimary && (
          <MarketGroup
            title="Primary markets"
            subfield="primary"
            icon={Target}
            items={markets.primary!}
            isEditMode={isEditMode}
            onFieldSave={onFieldSave}
          />
        )}
        {hasVerticals && (
          <MarketGroup
            title="Verticals"
            subfield="verticals"
            icon={Target}
            items={markets.verticals!}
            isEditMode={isEditMode}
            onFieldSave={onFieldSave}
          />
        )}
        {hasGeographies && (
          <MarketGroup
            title="Geographies"
            subfield="geographies"
            icon={MapPin}
            items={markets.geographies!}
            isEditMode={isEditMode}
            onFieldSave={onFieldSave}
          />
        )}
      </div>
    </div>
  );
}

interface MarketGroupProps {
  title: string;
  subfield: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  items: MetadataFact[];
  isEditMode?: boolean;
  onFieldSave?: (path: string, value: string) => Promise<void>;
}

function MarketItemEditor({
  path,
  initialValue,
  onSave,
}: {
  path: string;
  initialValue: string;
  onSave: (path: string, value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue(initialValue);
    setError(null);
  }, [initialValue]);

  const handleSave = async () => {
    if (value.trim() === initialValue) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(path, value.trim());
    } catch {
      setError("Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        className={s.input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={saving}
        style={{ flex: 1 }}
      />
      <button
        onClick={() => void handleSave()}
        disabled={saving || value.trim() === initialValue}
        className={`${s.btn} ${s.btnAccent} ${s.btnSm}`}
      >
        {saving ? "…" : "Save"}
      </button>
      {error && (
        <span style={{ fontSize: 11, color: "var(--danger)" }}>{error}</span>
      )}
    </div>
  );
}

function MarketGroup({
  title,
  subfield,
  icon: Icon,
  items,
  isEditMode,
  onFieldSave,
}: MarketGroupProps) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4" style={{ color: "var(--accent)" }} />
        <h4
          style={{
            margin: 0,
            fontSize: 12,
            fontWeight: 700,
            color: "var(--ink-2)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          {title}
        </h4>
      </div>
      {isEditMode && onFieldSave ? (
        <div className="space-y-2">
          {items.map((item, index) => (
            <div key={index}>
              <div className="mb-1 flex items-center gap-1">
                <PriorityBadge priority={item.priority} />
              </div>
              <MarketItemEditor
                path={`markets.${subfield}.${index}`}
                initialValue={String(item.value)}
                onSave={onFieldSave}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((item, index) => (
            <div
              key={index}
              className="group relative cursor-default"
              style={{
                padding: "5px 11px",
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 500,
                background: "var(--accent-soft)",
                color: "var(--accent-ink)",
                border: "1px solid oklch(from var(--accent) l c h / 0.2)",
              }}
            >
              {String(item.value)}

              {/* Hover tooltip */}
              <div
                className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 opacity-0 transition-opacity group-hover:opacity-100"
                style={{
                  padding: "10px 12px",
                  minWidth: 180,
                  background: "var(--panel)",
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  boxShadow: "0 10px 24px oklch(0 0 0 / 0.12)",
                }}
              >
                <div className="mb-1 flex items-center gap-1.5">
                  <VisibilityBadge visibility={item.visibility} />
                  <ConfidenceBadge confidence={item.confidence} />
                  <PriorityBadge priority={item.priority} />
                </div>
                {item.priority === "manual_override" ? (
                  <p
                    style={{
                      margin: 0,
                      fontSize: 10,
                      color: "var(--accent-ink)",
                      fontWeight: 600,
                    }}
                  >
                    Manual edit
                  </p>
                ) : item.sources.length > 0 ? (
                  <p
                    style={{
                      margin: 0,
                      fontSize: 10,
                      color: "var(--ink-3)",
                    }}
                  >
                    Source: {item.sources[0]?.doc_name ?? "Unknown"}
                  </p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
