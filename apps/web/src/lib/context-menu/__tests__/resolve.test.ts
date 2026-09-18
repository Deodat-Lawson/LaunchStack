import { resolveMenu } from "../resolve";
import { registerActions, listActions, resetActionsForTests } from "../registry";
import { APP_TARGET_KIND, type ActionDefinition, type ContextTarget, type MenuOpenContext } from "../types";

function ctx(chain: ContextTarget[]): MenuOpenContext {
    return { x: 0, y: 0, via: "pointer", chain, selection: null, element: null };
}

function ids(items: ReturnType<typeof resolveMenu>["items"]): string[] {
    return items.map(item => item.id);
}

const APP: ContextTarget = { kind: APP_TARGET_KIND };

describe("resolveMenu", () => {
    it("uses the primary target's own items and names the menu after it", () => {
        const { items, ariaLabel } = resolveMenu(
            ctx([
                {
                    kind: "source",
                    label: "Actions for memory.md",
                    items: () => [
                        { type: "item", id: "open", label: "Open", onSelect: () => undefined },
                    ],
                },
                APP,
            ]),
            []
        );
        expect(ids(items)).toEqual(["open"]);
        expect(ariaLabel).toBe("Actions for memory.md");
    });

    it("keeps ancestors out unless they opted in with inherit", () => {
        const row: ContextTarget = {
            kind: "row",
            items: () => [{ type: "item", id: "row.open", label: "Open", onSelect: () => undefined }],
        };
        const pane: ContextTarget = {
            kind: "pane",
            items: () => [{ type: "item", id: "pane.new", label: "New", onSelect: () => undefined }],
        };
        expect(ids(resolveMenu(ctx([row, pane, APP]), []).items)).toEqual(["row.open"]);
        expect(ids(resolveMenu(ctx([row, { ...pane, inherit: true }, APP]), []).items)).toEqual([
            "row.open",
            "sep-group-1",
            "pane.new",
        ]);
    });

    it("puts overlays first and still treats the next target as primary", () => {
        const actions: ActionDefinition[] = [
            {
                id: "selection.copy",
                label: "Copy",
                appliesTo: t => t.kind === "selection",
                run: () => undefined,
            },
        ];
        const { items, ariaLabel } = resolveMenu(
            ctx([
                { kind: "selection", overlay: true },
                {
                    kind: "message",
                    label: "Message actions",
                    items: () => [{ type: "item", id: "quote", label: "Quote", onSelect: () => undefined }],
                },
                APP,
            ]),
            actions
        );
        expect(ids(items)).toEqual(["selection.copy", "sep-group-1", "quote"]);
        expect(ariaLabel).toBe("Message actions");
    });

    it("falls back to the app root only when nothing else contributed", () => {
        const actions: ActionDefinition[] = [
            {
                id: "app.theme",
                label: "Theme",
                appliesTo: t => t.kind === APP_TARGET_KIND,
                run: () => undefined,
            },
        ];
        expect(ids(resolveMenu(ctx([APP]), actions).items)).toEqual(["app.theme"]);
        expect(ids(resolveMenu(ctx([{ kind: "empty", items: () => [] }, APP]), actions).items)).toEqual([
            "app.theme",
        ]);
        expect(
            ids(
                resolveMenu(
                    ctx([
                        {
                            kind: "row",
                            items: () => [{ type: "item", id: "x", label: "X", onSelect: () => undefined }],
                        },
                        APP,
                    ]),
                    actions
                ).items
            )
        ).toEqual(["x"]);
    });

    it("sorts registered actions by order and parks danger last after a separator", () => {
        const actions: ActionDefinition[] = [
            { id: "b", label: "B", order: 2, appliesTo: t => t.kind === "row", run: () => undefined },
            { id: "del", label: "Delete", danger: true, appliesTo: t => t.kind === "row", run: () => undefined },
            { id: "a", label: "A", order: 1, appliesTo: t => t.kind === "row", run: () => undefined },
            { id: "other", label: "Other", appliesTo: t => t.kind === "folder", run: () => undefined },
        ];
        const { items } = resolveMenu(ctx([{ kind: "row" }, APP]), actions);
        expect(ids(items)).toEqual(["a", "b", "sep-row-danger", "del"]);
    });

    it("carries disabled reasons, checks, dynamic labels and submenus through", () => {
        const actions: ActionDefinition[] = [
            {
                id: "rename",
                label: t => `Rename ${String(t.id)}`,
                appliesTo: () => true,
                disabled: () => "Still indexing",
                run: () => undefined,
            },
            {
                id: "pin",
                label: "Pin",
                appliesTo: () => true,
                checked: () => true,
                run: () => undefined,
            },
            {
                id: "move",
                label: "Move to",
                appliesTo: () => true,
                children: () => [{ type: "item", id: "move.a", label: "A", onSelect: () => undefined }],
                run: () => undefined,
            },
        ];
        const { items } = resolveMenu(ctx([{ kind: "row", id: "r1" }, APP]), actions);
        const rename = items.find(i => i.id === "rename");
        expect(rename).toMatchObject({
            type: "item",
            label: "Rename r1",
            disabled: true,
            disabledReason: "Still indexing",
        });
        expect(items.find(i => i.id === "pin")).toMatchObject({ checked: true });
        expect(items.find(i => i.id === "move")).toMatchObject({
            type: "submenu",
            items: [{ id: "move.a" }],
        });
    });

    it("never lets an action that throws in appliesTo break the menu", () => {
        const actions: ActionDefinition[] = [
            {
                id: "boom",
                label: "Boom",
                appliesTo: () => {
                    throw new Error("nope");
                },
                run: () => undefined,
            },
            { id: "ok", label: "Ok", appliesTo: () => true, run: () => undefined },
        ];
        expect(ids(resolveMenu(ctx([{ kind: "row" }, APP]), actions).items)).toEqual(["ok"]);
    });
});

describe("action registry", () => {
    beforeEach(() => resetActionsForTests());

    it("lets a later registration shadow an earlier one until it unregisters", () => {
        const base: ActionDefinition = { id: "x", label: "base", appliesTo: () => true, run: () => undefined };
        const scoped: ActionDefinition = { id: "x", label: "scoped", appliesTo: () => true, run: () => undefined };
        const dropBase = registerActions([base]);
        const dropScoped = registerActions([scoped]);
        expect(listActions().map(a => a.label)).toEqual(["scoped"]);
        dropScoped();
        expect(listActions().map(a => a.label)).toEqual(["base"]);
        dropBase();
        expect(listActions()).toEqual([]);
    });
});
