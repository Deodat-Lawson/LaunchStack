"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Minus } from "lucide-react";

import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

import { SWATCHES } from "../model/palette";

/**
 * Small inspector controls.
 *
 * They exist because the shadcn kit has no numeric stepper or colour picker,
 * and every one of these is used from several panels — the inspector, the page
 * settings and the connector tools all need the same swatch grid.
 */

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Section({
    title,
    children,
    action,
}: {
    title: string;
    children: React.ReactNode;
    action?: React.ReactNode;
}) {
    return (
        <section className="border-line border-b px-3 py-3 last:border-b-0">
            <div className="mb-2 flex items-center justify-between">
                <h3 className="text-ink-3 font-mono text-[10px] font-semibold uppercase tracking-[0.08em]">
                    {title}
                </h3>
                {action}
            </div>
            <div className="space-y-2">{children}</div>
        </section>
    );
}

export function Row({ children }: { children: React.ReactNode }) {
    return <div className="flex items-center gap-2">{children}</div>;
}

export function Label({ children }: { children: React.ReactNode }) {
    return <span className="text-ink-3 w-14 shrink-0 text-[11px]">{children}</span>;
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

interface NumberFieldProps {
    value: number;
    onChange: (next: number) => void;
    min?: number;
    max?: number;
    step?: number;
    suffix?: string;
    /** Shown when the selection holds more than one distinct value. */
    mixed?: boolean;
    "aria-label"?: string;
}

/**
 * A numeric input that also scrubs: dragging left/right on the field changes
 * the value, which is how you nudge a stroke width without aiming at a 4px
 * spinner.
 */
export function NumberField({
    value,
    onChange,
    min,
    max,
    step = 1,
    suffix,
    mixed,
    ...rest
}: NumberFieldProps) {
    const [draft, setDraft] = useState<string | null>(null);
    const dragging = useRef<{ startX: number; startValue: number } | null>(null);

    const clampValue = (v: number) => {
        let next = v;
        if (min !== undefined) next = Math.max(min, next);
        if (max !== undefined) next = Math.min(max, next);
        return Math.round(next * 100) / 100;
    };

    return (
        <div className="relative flex-1">
            <Input
                {...rest}
                value={draft ?? (mixed ? "" : String(Math.round(value * 100) / 100))}
                placeholder={mixed ? "Mixed" : undefined}
                onChange={e => setDraft(e.target.value)}
                onBlur={() => {
                    if (draft !== null) {
                        const parsed = Number.parseFloat(draft);
                        if (Number.isFinite(parsed)) onChange(clampValue(parsed));
                        setDraft(null);
                    }
                }}
                onKeyDown={e => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                        (e.target as HTMLInputElement).blur();
                        return;
                    }
                    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                        e.preventDefault();
                        const delta =
                            (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? step * 10 : step);
                        onChange(clampValue(value + delta));
                        setDraft(null);
                    }
                }}
                onPointerDown={e => {
                    if (e.detail === 0) return;
                    dragging.current = { startX: e.clientX, startValue: value };
                }}
                onPointerMove={e => {
                    const state = dragging.current;
                    if (!state || e.buttons === 0) return;
                    const dx = e.clientX - state.startX;
                    if (Math.abs(dx) < 3) return;
                    onChange(clampValue(state.startValue + Math.round(dx / 2) * step));
                }}
                onPointerUp={() => {
                    dragging.current = null;
                }}
                className="h-7 px-2 text-[12px]"
                inputMode="decimal"
            />
            {suffix && (
                <span className="text-ink-4 pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px]">
                    {suffix}
                </span>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Segmented control
// ---------------------------------------------------------------------------

export interface SegmentOption<T extends string> {
    value: T;
    label?: string;
    icon?: React.ReactNode;
    title?: string;
}

export function Segmented<T extends string>({
    options,
    value,
    onChange,
    className,
}: {
    options: readonly SegmentOption<T>[];
    value: T | null;
    onChange: (next: T) => void;
    className?: string;
}) {
    return (
        <div
            className={cn("border-line bg-panel-2 flex flex-1 rounded-md border p-0.5", className)}
        >
            {options.map(option => (
                <button
                    key={option.value}
                    type="button"
                    title={option.title ?? option.label}
                    aria-pressed={value === option.value}
                    onClick={() => onChange(option.value)}
                    className={cn(
                        "flex h-6 flex-1 items-center justify-center rounded-[4px] text-[11px] font-medium transition-colors",
                        value === option.value
                            ? "bg-panel text-ink shadow-sm"
                            : "text-ink-3 hover:text-ink-2"
                    )}
                >
                    {option.icon ?? option.label}
                </button>
            ))}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

export interface ColorFieldProps {
    value: string;
    onChange: (next: string) => void;
    /** Offer "no fill"/"no stroke". */
    allowNone?: boolean;
    /** Which half of each swatch to apply — fills use light, strokes saturated. */
    tone?: "fill" | "stroke" | "ink";
    label: string;
}

export function ColorField({ value, onChange, allowNone, tone = "fill", label }: ColorFieldProps) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (!ref.current?.contains(e.target as Node)) setOpen(false);
        };
        window.addEventListener("mousedown", onDown);
        return () => window.removeEventListener("mousedown", onDown);
    }, [open]);

    const colorFor = (swatch: (typeof SWATCHES)[number]) =>
        tone === "fill" ? swatch.fill : tone === "stroke" ? swatch.stroke : swatch.ink;

    return (
        <div ref={ref} className="relative flex-1">
            <button
                type="button"
                onClick={() => setOpen(v => !v)}
                aria-label={label}
                className="border-line bg-panel hover:border-ink-4 flex h-7 w-full items-center gap-2 rounded-md border px-2 transition-colors"
            >
                <span
                    className="border-line size-4 shrink-0 rounded-[3px] border"
                    style={{
                        background: value === "none" ? "transparent" : value,
                        backgroundImage:
                            value === "none"
                                ? "linear-gradient(45deg, var(--line) 25%, transparent 25%, transparent 75%, var(--line) 75%)"
                                : undefined,
                        backgroundSize: value === "none" ? "6px 6px" : undefined,
                    }}
                />
                <span className="text-ink-2 flex-1 truncate text-left text-[11px]">
                    {value === "none" ? "None" : nameForColor(value, tone)}
                </span>
                <ChevronDown className="text-ink-3 size-3" />
            </button>

            {open && (
                <div className="z-dropdown border-line bg-panel shadow-2 absolute right-0 mt-1 w-[228px] rounded-lg border p-2">
                    <div className="grid grid-cols-7 gap-1">
                        {allowNone && (
                            <button
                                type="button"
                                title="None"
                                onClick={() => {
                                    onChange("none");
                                    setOpen(false);
                                }}
                                className="border-line flex size-6 items-center justify-center rounded border"
                            >
                                <Minus className="text-ink-3 size-3" />
                            </button>
                        )}
                        {SWATCHES.map(swatch => {
                            const color = colorFor(swatch);
                            return (
                                <button
                                    key={swatch.id}
                                    type="button"
                                    title={swatch.name}
                                    onClick={() => {
                                        onChange(color);
                                        setOpen(false);
                                    }}
                                    className="border-line flex size-6 items-center justify-center rounded border"
                                    style={{ background: color }}
                                >
                                    {value === color && (
                                        <Check
                                            className="size-3"
                                            style={{
                                                color:
                                                    tone === "fill" ? swatch.ink : "var(--panel)",
                                            }}
                                        />
                                    )}
                                </button>
                            );
                        })}
                    </div>
                    <div className="border-line mt-2 border-t pt-2">
                        <label className="text-ink-3 flex items-center gap-2 text-[11px]">
                            Custom
                            <input
                                type="color"
                                onChange={e => onChange(e.target.value)}
                                className="border-line bg-panel h-6 w-full cursor-pointer rounded border"
                                aria-label="Custom colour"
                            />
                        </label>
                    </div>
                </div>
            )}
        </div>
    );
}

function nameForColor(value: string, tone: "fill" | "stroke" | "ink"): string {
    const match = SWATCHES.find(s =>
        tone === "fill"
            ? s.fill === value
            : tone === "stroke"
              ? s.stroke === value
              : s.ink === value
    );
    return match?.name ?? value.replace(/^oklch\(|\)$/g, "").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Slider
// ---------------------------------------------------------------------------

export function Slider({
    value,
    onChange,
    min = 0,
    max = 1,
    step = 0.01,
    "aria-label": ariaLabel,
}: {
    value: number;
    onChange: (next: number) => void;
    min?: number;
    max?: number;
    step?: number;
    "aria-label"?: string;
}) {
    return (
        <input
            type="range"
            value={value}
            min={min}
            max={max}
            step={step}
            aria-label={ariaLabel}
            onChange={e => onChange(Number(e.target.value))}
            className="bg-line h-1.5 flex-1 cursor-pointer appearance-none rounded-full accent-[var(--accent)]"
        />
    );
}

// ---------------------------------------------------------------------------
// Icon button
// ---------------------------------------------------------------------------

export function IconToggle({
    active,
    onClick,
    title,
    children,
    disabled,
}: {
    active?: boolean;
    onClick: () => void;
    title: string;
    children: React.ReactNode;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            title={title}
            aria-label={title}
            aria-pressed={active}
            disabled={disabled}
            onClick={onClick}
            className={cn(
                "flex size-7 items-center justify-center rounded-md transition-colors disabled:opacity-40",
                active ? "bg-brand-soft text-brand-ink" : "text-ink-2 hover:bg-panel-2"
            )}
        >
            {children}
        </button>
    );
}
