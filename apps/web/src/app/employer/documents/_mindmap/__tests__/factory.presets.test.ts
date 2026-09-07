import { createNode } from "../model/factory";

describe("container presets", () => {
    it("gives groups and frames a visible outline by default", () => {
        // A zero-weight, stroke-none container placed on the canvas shows
        // nothing at all — which reads as the tool being broken, not as
        // minimalism. Both modes, both containers.
        for (const mode of ["light", "dark"] as const) {
            for (const shape of ["group", "frame"] as const) {
                const nd = createNode({ shape, mode, x: 0, y: 0 });
                expect(nd.style.stroke).not.toBe("none");
                expect(nd.style.strokeWidth).toBeGreaterThan(0);
            }
        }
    });

    it("keeps the group's fill open so its contents stay clickable", () => {
        const nd = createNode({ shape: "group", x: 0, y: 0 });
        expect(nd.style.fill).toBe("none");
        expect(nd.style.strokeStyle).toBe("dashed");
    });
});
