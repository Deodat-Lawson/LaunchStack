"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { cn } from "~/lib/utils";

import { PLACES, type Place } from "../_lib/geography";
import { LAND_GRID } from "../_lib/land-grid";
import { FacetLink } from "./FacetLink";

export interface MapRegion {
    id: string;
    label: string;
    /** Programs in the catalogue that share this region. */
    count: number;
    /** The Programs list filtered by this region. */
    href: string;
}

/** Plate carrée in degrees: x runs 0–360 from the antimeridian, y down from the grid's north edge. */
const WIDTH = 360;
const HEIGHT = LAND_GRID.rows.length * LAND_GRID.step;
const x = (longitude: number) => longitude + 180;
const y = (latitude: number) => LAND_GRID.north - latitude;

/** Every land cell as a zero-length round-capped stroke: one path draws the whole dot field. */
const LAND_DOTS = LAND_GRID.rows
    .flatMap((row, r) =>
        Array.from({ length: LAND_GRID.columns }, (_, c) =>
            parseInt(row[c >> 2]!, 16) & (8 >> (c & 3))
                ? `M${c * LAND_GRID.step + LAND_GRID.step / 2} ${r * LAND_GRID.step + LAND_GRID.step / 2}h0`
                : ""
        )
    )
    .join("");

/**
 * The regions a Program says it takes companies from, pinned on a dot map:
 * cities as pins, countries and regions as a soft area around a pin. Each region
 * is also a link below the map to the other Programs that cover it; pointing at
 * either one points at the other.
 */
export function RegionMap({ regions }: { regions: readonly MapRegion[] }) {
    const t = useTranslations("accelerators.overview");
    const format = useFormatter();
    const [active, setActive] = useState<string | null>(null);
    const placed = regions.flatMap(region => {
        const place = PLACES[region.id];
        return place ? [{ region, place }] : [];
    });
    // Areas under pins, largest first, so a city inside a region stays on top.
    const ordered = [...placed].sort((left, right) => right.place.radius - left.place.radius);
    const activePlace = placed.find(item => item.region.id === active);
    return (
        <div className="space-y-3">
            <div className="border-line bg-panel-2 overflow-hidden rounded-xl border">
                <svg
                    viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                    role="img"
                    aria-label={t("mapLabel", {
                        regions: format.list(regions.map(region => region.label)),
                    })}
                    className="block h-auto w-full"
                >
                    <path
                        d={LAND_DOTS}
                        fill="none"
                        strokeWidth={0.95}
                        strokeOpacity={0.55}
                        strokeLinecap="round"
                        stroke="var(--line-dot)"
                    />
                    {ordered.map(({ region, place }) => (
                        <Marker
                            key={region.id}
                            place={place}
                            active={active === region.id}
                            dimmed={active !== null && active !== region.id}
                            onActive={on => setActive(on ? region.id : null)}
                        />
                    ))}
                    {activePlace && (
                        <MarkerLabel place={activePlace.place} label={activePlace.region.label} />
                    )}
                </svg>
            </div>
            <ul className="flex flex-wrap gap-1.5">
                {regions.map(region => {
                    const place = PLACES[region.id];
                    return (
                        <li key={region.id} className="min-w-0">
                            <FacetLink
                                href={region.href}
                                label={region.label}
                                count={region.count}
                                active={active === region.id}
                                onActive={on => setActive(on ? region.id : null)}
                                marker={
                                    place ? (
                                        <span
                                            aria-hidden
                                            className={cn(
                                                "size-2 shrink-0 rounded-full",
                                                place.radius > 0
                                                    ? "border-brand/60 bg-brand/15 border border-dashed"
                                                    : "bg-brand"
                                            )}
                                        />
                                    ) : undefined
                                }
                            />
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

function Marker({
    place,
    active,
    dimmed,
    onActive,
}: {
    place: Place;
    active: boolean;
    dimmed: boolean;
    onActive: (active: boolean) => void;
}) {
    return (
        <g
            onPointerEnter={() => onActive(true)}
            onPointerLeave={() => onActive(false)}
            className={cn("transition-opacity duration-200", dimmed && "opacity-30")}
        >
            {place.points.map(([longitude, latitude]) => {
                const cx = x(longitude);
                const cy = y(latitude);
                return (
                    <g key={`${longitude},${latitude}`}>
                        {place.radius > 0 && (
                            <circle
                                cx={cx}
                                cy={cy}
                                r={place.radius}
                                strokeWidth={0.5}
                                strokeDasharray="1.4 1.4"
                                strokeOpacity={0.6}
                                fillOpacity={active ? 0.25 : 0.1}
                                className="fill-brand stroke-brand transition-[fill-opacity]"
                            />
                        )}
                        {active && (
                            <circle
                                cx={cx}
                                cy={cy}
                                r={3.2}
                                fillOpacity={0.4}
                                className="fill-brand origin-center animate-ping [transform-box:fill-box] motion-reduce:animate-none"
                            />
                        )}
                        <circle cx={cx} cy={cy} r={3.2} fillOpacity={0.2} className="fill-brand" />
                        <circle
                            cx={cx}
                            cy={cy}
                            r={1.6}
                            strokeWidth={0.6}
                            stroke="var(--panel-2)"
                            className="fill-brand"
                        />
                    </g>
                );
            })}
        </g>
    );
}

/** The active region's name over its first point, kept inside the map at the edges. */
function MarkerLabel({ place, label }: { place: Place; label: string }) {
    const [longitude, latitude] = place.points[0]!;
    const cx = x(longitude);
    const top = y(latitude) - Math.max(place.radius, 3.2) - 2.5;
    const anchor = cx < 40 ? "start" : cx > WIDTH - 40 ? "end" : "middle";
    return (
        <text
            x={cx}
            y={top < 8 ? y(latitude) + Math.max(place.radius, 3.2) + 7 : top}
            textAnchor={anchor}
            fontSize={6.5}
            strokeWidth={2}
            fill="var(--ink)"
            stroke="var(--panel-2)"
            paintOrder="stroke"
            className="pointer-events-none font-medium"
        >
            {label}
        </text>
    );
}
