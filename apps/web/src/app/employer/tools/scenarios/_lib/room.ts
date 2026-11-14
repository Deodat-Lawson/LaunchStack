import type { ScenarioPerson, Stance } from "~/lib/scenarios/types";

/**
 * The Room: everyone in a run gets a seat in a half-circle, critical on the
 * left and supportive on the right, the way a parliament seats its parties.
 * Plain geometry and ordering, no React, so the layout is pinned by a unit
 * test. Seats are ordered by angle across all rows, so each side of opinion
 * fills a wedge of the room rather than a row.
 */

export interface Seat {
    x: number;
    y: number;
    /** Radians from the right-hand floor (0) to the left-hand floor (π). */
    angle: number;
    radius: number;
}

export interface RoomLayout {
    seats: Seat[];
    /** Diameter of one seat, px. */
    size: number;
    /** Faces when the room has space for them; dots for big casts. */
    faces: boolean;
    rows: number;
    cx: number;
    /** The floor line: y of the centre of the half-circle. */
    cy: number;
    outer: number;
    inner: number;
    width: number;
    height: number;
}

/** Faces up to this many people; past it, dots carry the room. */
export const MAX_FACES = 60;

/** Rows by headcount: a single arc for a handful, more rows as the room fills. */
export function rowsFor(count: number): number {
    if (count <= 7) return 1;
    if (count <= 24) return 2;
    if (count <= 48) return 3;
    if (count <= 90) return 4;
    if (count <= 140) return 5;
    return 6;
}

/** How far into the half-circle the innermost row sits, as a share of the outer radius. */
function innerShare(rows: number): number {
    return rows === 1 ? 1 : rows === 2 ? 0.56 : rows === 3 ? 0.46 : 0.4;
}

/**
 * Where each seat goes for `count` people in a box `width` wide. The seat
 * size is worked out from the rows themselves: as big as `maxSize` allows
 * while neighbours along a row, and the rows, stay `gap` apart (room for a
 * ring round each face). `inset` keeps the outer row clear of the box edge
 * (for the band drawn behind the seats); `maxRadius` stops a wide screen
 * from spreading a small room thin.
 */
export function seatLayout(
    count: number,
    width: number,
    opts: {
        maxSize?: number;
        maxRadius?: number;
        inset?: number;
        top?: number;
        floor?: number;
        gap?: number;
    } = {}
): RoomLayout {
    const rows = rowsFor(count);
    const inset = opts.inset ?? 0;
    const room = Math.min(width - 2 * inset, 2 * (opts.maxRadius ?? 270));
    const floor = opts.floor ?? 0.07;
    const gap = opts.gap ?? 2;
    const share = innerShare(rows);

    const shape = (size: number) => {
        const outer = Math.max(size, (room - size) / 2);
        const inner = rows === 1 ? outer : outer * share;
        const radii = Array.from({ length: rows }, (_, i) =>
            rows === 1 ? outer : inner + ((outer - inner) * i) / (rows - 1)
        );
        // Seats per row in proportion to the row's length; the remainder goes outward first.
        const total = radii.reduce((a, r) => a + r, 0);
        const perRow = radii.map(r => Math.floor((count * r) / total));
        let left = count - perRow.reduce((a, n) => a + n, 0);
        for (let i = rows - 1; left > 0; i = (i - 1 + rows) % rows) {
            perRow[i]! += 1;
            left -= 1;
        }
        // The tightest pair of neighbours: along a row, or between rows.
        let spacing = Infinity;
        radii.forEach((r, i) => {
            const k = perRow[i]!;
            if (k > 1)
                spacing = Math.min(spacing, 2 * r * Math.sin((Math.PI - 2 * floor) / (k - 1) / 2));
        });
        if (rows > 1) spacing = Math.min(spacing, (outer - inner) / (rows - 1));
        return { outer, inner, radii, perRow, spacing };
    };

    // The seat shrinks until its neighbours clear it; a smaller seat widens the room, so this settles.
    let size = Math.min(opts.maxSize ?? 50, room / 2);
    let s = shape(size);
    for (let i = 0; i < 8; i++) {
        const fit = Math.max(4, Math.min(opts.maxSize ?? 50, s.spacing - gap));
        if (fit >= size - 0.25) break;
        size = fit;
        s = shape(size);
    }

    const cx = width / 2;
    const cy = (opts.top ?? 6) + s.outer + size / 2;
    const seats: Seat[] = [];
    s.radii.forEach((radius, row) => {
        const k = s.perRow[row]!;
        for (let j = 0; j < k; j++) {
            const angle =
                k === 1 ? Math.PI / 2 : Math.PI - floor - ((Math.PI - 2 * floor) * j) / (k - 1);
            seats.push({
                x: cx + radius * Math.cos(angle),
                y: cy - radius * Math.sin(angle),
                angle,
                radius,
            });
        }
    });
    // Left to right across the whole room; inner before outer at the same angle.
    seats.sort((a, b) => b.angle - a.angle || a.radius - b.radius);
    return {
        seats,
        size,
        faces: count <= MAX_FACES,
        rows,
        cx,
        cy,
        outer: s.outer,
        inner: s.inner,
        width,
        height: cy + size / 2 + 4,
    };
}

/** Where someone stood after `round` (0 is the start). */
export function stanceAt(person: ScenarioPerson, round: number): Stance {
    const h = person.stanceHistory;
    if (h.length === 0) return round === 0 ? person.startStance : person.stance;
    return h[Math.min(Math.max(0, round), h.length - 1)] ?? person.stance;
}

/**
 * Who sits where after `round`: most critical first (the left), then by where
 * they ended and where they began, so a person keeps their neighbours from
 * one round to the next unless their mind changes.
 */
export function seatOrder(people: readonly ScenarioPerson[], round: number): ScenarioPerson[] {
    return [...people].sort(
        (a, b) =>
            stanceAt(a, round) - stanceAt(b, round) ||
            a.stance - b.stance ||
            a.startStance - b.startStance ||
            a.id.localeCompare(b.id, "en", { numeric: true })
    );
}

export interface Sides {
    critical: number;
    neutral: number;
    supportive: number;
}

/** People per side from per-stance counts (critical → supportive). */
export function sidesOf(counts: readonly number[]): Sides {
    return {
        critical: (counts[0] ?? 0) + (counts[1] ?? 0),
        neutral: counts[2] ?? 0,
        supportive: (counts[3] ?? 0) + (counts[4] ?? 0),
    };
}

/** Per-stance counts after `round`, from the people themselves. */
export function countsAt(
    people: readonly ScenarioPerson[],
    round: number
): [number, number, number, number, number] {
    const out: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    for (const p of people) {
        const i = stanceAt(p, round) + 2;
        out[i] = (out[i] ?? 0) + 1;
    }
    return out;
}

/** The people whose stance changed during `round`. */
export function movedIn(people: readonly ScenarioPerson[], round: number): ScenarioPerson[] {
    if (round < 1) return [];
    return people.filter(p => stanceAt(p, round) !== stanceAt(p, round - 1));
}

/** How many times someone changed their mind, by steps on the scale. */
export function moves(person: ScenarioPerson): number {
    const h = person.stanceHistory;
    let n = 0;
    for (let i = 1; i < h.length; i++) n += Math.abs(h[i]! - h[i - 1]!);
    return n;
}

/** The people who moved the most, the furthest from where they began first among equals. */
export function mostMoved(people: readonly ScenarioPerson[], limit: number): ScenarioPerson[] {
    return [...people]
        .filter(p => moves(p) > 0)
        .sort(
            (a, b) =>
                moves(b) - moves(a) ||
                Math.abs(b.stance - b.startStance) - Math.abs(a.stance - a.startStance) ||
                a.name.localeCompare(b.name)
        )
        .slice(0, limit);
}
