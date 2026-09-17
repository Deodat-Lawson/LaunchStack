import { buildOrderMenuItems, buildPartnerMenuItems, buildRunMenuItems } from "../partnerContextMenu";
import type { PartnerItemDto, RunDto } from "../../api";

const item = {
    org: { name: "Acme Distribution", domain: "acme.example" },
    relationship: { id: "r1", stage: "contacted", kind: "distributor" },
    evidenceCount: 3,
    stale: false,
} as unknown as PartnerItemDto;

describe("partner menu builders", () => {
    it("moves a partner between stages, with the current one checked", () => {
        const onMoveToStage = jest.fn();
        const items = buildPartnerMenuItems(item, {
            onOpen: jest.fn(),
            onMoveToStage,
            onDraftOutreach: jest.fn(),
            onFilterStage: jest.fn(),
            onFilterKind: jest.fn(),
            onCopyName: jest.fn(),
            onCopyDomain: jest.fn(),
        });
        expect(items.map(i => i.id)).toEqual([
            "title",
            "open",
            "stage",
            "outreach",
            "sep-filter",
            "filter-stage",
            "filter-kind",
            "sep-copy",
            "copy-name",
            "copy-domain",
        ]);
        const stage = items.find(i => i.id === "stage");
        const current = stage?.type === "submenu" ? stage.items.find(i => i.id === "stage-contacted") : null;
        expect(current).toMatchObject({ checked: true, disabled: true });
        const qualified = stage?.type === "submenu" ? stage.items.find(i => i.id === "stage-qualified") : null;
        if (qualified?.type === "item") qualified.onSelect();
        expect(onMoveToStage).toHaveBeenCalledWith("qualified");
        expect(items.find(i => i.id === "filter-stage")).toMatchObject({ label: "Show only Contacted" });
    });

    it("leaves filters and the domain out where they do not apply", () => {
        const items = buildPartnerMenuItems(
            { ...item, org: { name: "No Domain" } } as unknown as PartnerItemDto,
            { onOpen: jest.fn(), onMoveToStage: jest.fn(), onCopyName: jest.fn(), onCopyDomain: jest.fn() }
        );
        expect(items.map(i => i.id)).toEqual(["title", "open", "stage", "sep-copy", "copy-name"]);
    });

    it("describes a run and holds a new one while another is going", () => {
        const run = { id: "abcdef123456", status: "completed" } as RunDto;
        const items = buildRunMenuItems(run, { expanded: false, running: true }, {
            onToggleDetails: jest.fn(),
            onStartAnother: jest.fn(),
            onCopyId: jest.fn(),
        });
        expect(items[0]).toMatchObject({ label: "Run abcdef12 · completed" });
        expect(items.find(i => i.id === "details")).toMatchObject({ label: "Show details" });
        expect(items.find(i => i.id === "start")).toMatchObject({ disabled: true });
    });

    it("checks the current order in the header menu", () => {
        const onOrder = jest.fn();
        const items = buildOrderMenuItems("activity", onOrder);
        expect(items.find(i => i.id === "order-activity")).toMatchObject({ checked: true });
        const created = items.find(i => i.id === "order-created");
        if (created?.type === "item") created.onSelect();
        expect(onOrder).toHaveBeenCalledWith("created");
    });
});
