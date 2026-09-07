import { buildPayload, instantiate, parsePayload } from "../model/clipboard";
import { createEdge, createNode } from "../model/factory";

function fixture() {
    const a = createNode({ shape: "rectangle", x: 100, y: 50, w: 80, h: 40, text: "A" });
    const b = createNode({ shape: "ellipse", x: 300, y: 150, w: 80, h: 40, text: "B" });
    const child = createNode({ shape: "rectangle", x: 110, y: 60, w: 20, h: 20, parentId: a.id });
    const edge = createEdge({ from: { nodeId: a.id }, to: { nodeId: b.id }, label: "link" });
    const stray = createEdge({ from: { nodeId: a.id }, to: { nodeId: "outsider" } });
    return { a, b, child, edge, stray };
}

describe("buildPayload", () => {
    it("records the top-left of the copied block", () => {
        const { a, b, edge } = fixture();
        expect(buildPayload([a, b], [edge]).origin).toEqual({ x: 100, y: 50 });
    });

    it("handles an empty selection", () => {
        expect(buildPayload([], []).origin).toEqual({ x: 0, y: 0 });
    });

    it("snapshots rather than aliasing", () => {
        const { a } = fixture();
        const payload = buildPayload([a], []);
        a.x = 999;
        expect(payload.nodes[0]!.x).toBe(100);
    });
});

describe("parsePayload", () => {
    it("round-trips its own JSON", () => {
        const { a, edge } = fixture();
        const payload = buildPayload([a], [edge]);
        expect(parsePayload(JSON.stringify(payload))?.nodes).toHaveLength(1);
    });

    it("rejects foreign or malformed text", () => {
        expect(parsePayload("just some text")).toBeNull();
        expect(parsePayload('{"magic":"someone-else"}')).toBeNull();
        expect(parsePayload("{}")).toBeNull();
    });
});

describe("instantiate", () => {
    it("assigns fresh ids", () => {
        const { a, b, edge } = fixture();
        const result = instantiate(buildPayload([a, b], [edge]), { x: 0, y: 0 });
        expect(result.nodes.map(n => n.id)).not.toContain(a.id);
        expect(new Set(result.nodes.map(n => n.id)).size).toBe(2);
    });

    it("translates by the offset", () => {
        const { a } = fixture();
        const result = instantiate(buildPayload([a], []), { x: 10, y: -5 });
        expect([result.nodes[0]!.x, result.nodes[0]!.y]).toEqual([110, 45]);
    });

    it("remaps internal connectors onto the copies", () => {
        const { a, b, edge } = fixture();
        const result = instantiate(buildPayload([a, b], [edge]), { x: 0, y: 0 });
        const copiedEdge = result.edges[0]!;
        expect(copiedEdge.from.nodeId).toBe(result.nodes[0]!.id);
        expect(copiedEdge.to.nodeId).toBe(result.nodes[1]!.id);
        expect(copiedEdge.labels[0]!.text).toBe("link");
    });

    it("remaps parentId inside the copied block", () => {
        const { a, child } = fixture();
        const result = instantiate(buildPayload([a, child], []), { x: 0, y: 0 });
        expect(result.nodes[1]!.parentId).toBe(result.nodes[0]!.id);
    });

    it("drops a parent reference that was not copied", () => {
        const { child } = fixture();
        const result = instantiate(buildPayload([child], []), { x: 0, y: 0 });
        expect(result.nodes[0]!.parentId).toBeNull();
    });

    it("drops a connector whose other end was not copied", () => {
        const { a, stray } = fixture();
        const result = instantiate(buildPayload([a], [stray]), { x: 0, y: 0 });
        // Keeping the original `nodeId` would wire the pasted copy back to the
        // source diagram — or dangle at an id the target document lacks.
        expect(result.edges).toHaveLength(0);
        expect(result.nodes).toHaveLength(1);
    });

    it("moves free endpoints and waypoints with the block", () => {
        const { a, b } = fixture();
        const edge = {
            ...createEdge({ from: { nodeId: a.id }, to: { point: { x: 400, y: 400 } } }),
            waypoints: [{ x: 200, y: 200 }],
        };
        const result = instantiate(buildPayload([a, b], [edge]), { x: 10, y: 10 });
        expect(result.edges[0]!.waypoints[0]).toEqual({ x: 210, y: 210 });
        expect(result.edges[0]!.to.point).toEqual({ x: 410, y: 410 });
    });

    it("clones style objects rather than sharing them", () => {
        const { a } = fixture();
        const payload = buildPayload([a], []);
        const result = instantiate(payload, { x: 0, y: 0 });
        result.nodes[0]!.style.fill = "oklch(0.5 0 0)";
        expect(payload.nodes[0]!.style.fill).not.toBe("oklch(0.5 0 0)");
    });
});
