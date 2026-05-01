"use client";

import React from "react";
import { Target, MapPin, Layers } from "lucide-react";
import m from "./metadata.module.css";
import type {
  MarketsInfo,
  MetadataFact,
} from "@launchstack/features/company-metadata";

interface MarketsSectionProps {
  markets: MarketsInfo;
}

export function MarketsSection({ markets }: MarketsSectionProps) {
  const primary = markets.primary ?? [];
  const verticals = markets.verticals ?? [];
  const geographies = markets.geographies ?? [];

  const blocks: Array<{
    title: string;
    icon: React.ComponentType<{ width?: number; height?: number }>;
    items: MetadataFact[];
    isGeo?: boolean;
  }> = [];
  if (primary.length > 0) {
    blocks.push({ title: "Primary segments", icon: Target, items: primary });
  }
  if (verticals.length > 0) {
    blocks.push({ title: "Verticals", icon: Layers, items: verticals });
  }
  if (geographies.length > 0) {
    blocks.push({
      title: "Geographies",
      icon: MapPin,
      items: geographies,
      isGeo: true,
    });
  }

  if (blocks.length === 0) return null;

  const gridClass =
    blocks.length >= 3 ? `${m.markets} ${m.marketsTriple}` : m.markets;

  return (
    <div className={gridClass}>
      {blocks.map((block) => (
        <MarketBlock key={block.title} {...block} />
      ))}
    </div>
  );
}

interface MarketBlockProps {
  title: string;
  icon: React.ComponentType<{ width?: number; height?: number }>;
  items: MetadataFact[];
  isGeo?: boolean;
}

function MarketBlock({ title, icon: Icon, items, isGeo }: MarketBlockProps) {
  return (
    <div className={m.marketBlock}>
      <div className={m.marketLabel}>
        <Icon width={12} height={12} />
        {title}
      </div>
      <div className={m.tagCloud}>
        {items.map((item, idx) => {
          const value = String(item.value);
          const isManual = item.priority === "manual_override";
          const tagClass = [
            m.tag,
            isGeo ? m.tagGeo : "",
            isManual ? m.tagManual : "",
          ]
            .filter(Boolean)
            .join(" ");
          const source = item.sources?.[0]?.doc_name;
          return (
            <span key={idx} className={m.tagWrap}>
              <span className={tagClass}>{value}</span>
              {(source || isManual) && (
                <span className={m.tagTooltip}>
                  {isManual ? "Edited by you" : `Source: ${source}`}
                </span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
