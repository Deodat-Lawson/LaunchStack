import {
    countsAt,
    mostMoved,
    moves,
    movedIn,
    rowsFor,
    seatLayout,
    seatOrder,
    sidesOf,
    stanceAt,
} from "~/app/employer/tools/scenarios/_lib/room";
import type { ScenarioPerson, Stance } from "~/lib/scenarios/types";

function person(id: string, history: Stance[], name = id): ScenarioPerson {
    return {
        id,
        name,
        handle: id,
        role: "",
        bio: "",
        interests: [],
        grounding: "invented",
        sources: [],
        stanceHistory: history,
        lastThought: null,
        currentSolution: null,
        budget: null,
        buyingRole: null,
        switchingCost: null,
        firstObjection: null,
        wouldPay: null,
        objection: null,
        startStance: history[0] ?? 0,
        stance: history[history.length - 1] ?? 0,
        activity: 0.5,
        followers: 0,
        following: 0,
        posts: 0,
        comments: 0,
        basis: null,
    } as ScenarioPerson;
}

describe("the room's layout", () => {
    it("adds rows as the room fills", () => {
        expect([1, 7, 8, 24, 25, 48, 49, 90, 91, 140, 141, 200].map(rowsFor)).toEqual([
            1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
        ]);
    });

    it.each([
        [1, 1000],
        [12, 1000],
        [12, 320],
        [30, 1000],
        [30, 320],
        [80, 1000],
        [200, 1000],
        [200, 320],
    ])("seats %i people in %ipx without overlap or spill", (count, width) => {
        const layout = seatLayout(count, width, { inset: 10, gap: 12 });
        expect(layout.seats).toHaveLength(count);
        for (const s of layout.seats) {
            expect(s.x - layout.size / 2).toBeGreaterThanOrEqual(-0.5);
            expect(s.x + layout.size / 2).toBeLessThanOrEqual(width + 0.5);
            expect(s.y - layout.size / 2).toBeGreaterThanOrEqual(0);
            expect(s.y + layout.size / 2).toBeLessThanOrEqual(layout.height);
        }
        let closest = Infinity;
        for (let i = 0; i < count; i++) {
            for (let j = i + 1; j < count; j++) {
                const a = layout.seats[i]!;
                const b = layout.seats[j]!;
                closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
            }
        }
        // Faces wear a ring: neighbours keep the gap between them as well.
        expect(closest).toBeGreaterThanOrEqual(layout.size + (layout.size > 4 ? 12 : 0) - 0.5);
    });

    it("fills the room left to right, so each side of opinion gets a wedge", () => {
        const { seats } = seatLayout(30, 900);
        for (let i = 1; i < seats.length; i++) {
            expect(seats[i]!.angle).toBeLessThanOrEqual(seats[i - 1]!.angle);
        }
        expect(seats[0]!.x).toBeLessThan(seats[seats.length - 1]!.x);
    });

    it("shows faces up to sixty people and dots past that", () => {
        expect(seatLayout(60, 900).faces).toBe(true);
        expect(seatLayout(61, 900).faces).toBe(false);
    });
});

describe("who sits where", () => {
    const maya = person("a1", [0, -1, -2, -1]);
    const priya = person("a3", [1, 1, 2, 2]);
    const rafael = person("a12", [0, 0, 0, 0]);
    const ben = person("a10", [0, -1, -1, -2]);
    const people = [priya, rafael, maya, ben];

    it("reads the stance after a round, the start being round 0", () => {
        expect(stanceAt(maya, 0)).toBe(0);
        expect(stanceAt(maya, 2)).toBe(-2);
        expect(stanceAt(maya, 9)).toBe(-1);
    });

    it("seats the most critical on the left, and keeps neighbours when nobody moves", () => {
        expect(seatOrder(people, 2).map(p => p.id)).toEqual(["a1", "a10", "a12", "a3"]);
        expect(seatOrder(people, 3).map(p => p.id)).toEqual(["a10", "a1", "a12", "a3"]);
        expect(seatOrder(people, 0).map(p => p.id)).toEqual(["a10", "a1", "a12", "a3"]);
    });

    it("counts each side and who moved", () => {
        expect(countsAt(people, 1)).toEqual([0, 2, 1, 1, 0]);
        expect(sidesOf(countsAt(people, 3))).toEqual({ critical: 2, neutral: 1, supportive: 1 });
        expect(movedIn(people, 2).map(p => p.id)).toEqual(["a3", "a1"]);
        expect(movedIn(people, 0)).toEqual([]);
    });

    it("ranks who moved most by steps, then by how far they ended from the start", () => {
        expect(moves(maya)).toBe(3);
        expect(moves(rafael)).toBe(0);
        expect(mostMoved(people, 3).map(p => p.id)).toEqual(["a1", "a10", "a3"]);
    });
});
