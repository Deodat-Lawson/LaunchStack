import { CONTRACTS } from "../data";
import { buildContractMenuItems, type ContractMenuT } from "../menu";

// The builder is pure, so the set of verbs is tested without a portal —
// the pattern DESIGN.md §4.5 asks every object menu to follow.
const t = ((key: string) => key) as unknown as ContractMenuT;
const noop = () => undefined;
const handlers = { onDecide: noop, onAsk: noop, onCopyLink: noop, onDelete: noop };
const contract = CONTRACTS[0]!;

describe("buildContractMenuItems", () => {
    it("opens with the object's name and ends with the destructive verb", () => {
        const items = buildContractMenuItems(contract, { ...handlers, onOpen: noop }, t);
        expect(items[0]).toEqual({ type: "label", id: "title", label: contract.vendor });
        const last = items[items.length - 1]!;
        expect(last).toMatchObject({ id: "delete", danger: true });
        expect(items[items.length - 2]).toMatchObject({ type: "separator" });
    });

    it("leaves Open out where the screen already is the object", () => {
        const ids = buildContractMenuItems(contract, handlers, t).map(item => item.id);
        expect(ids).not.toContain("open");
        expect(ids).toEqual(["title", "decide", "ask", "copy-link", "sep-danger", "delete"]);
    });

    it("calls the handler for the chosen verb", () => {
        const onDelete = jest.fn();
        const items = buildContractMenuItems(contract, { ...handlers, onDelete }, t);
        const del = items.find(item => item.id === "delete");
        if (del?.type !== "item") throw new Error("delete is an item");
        del.onSelect();
        expect(onDelete).toHaveBeenCalledTimes(1);
    });
});
