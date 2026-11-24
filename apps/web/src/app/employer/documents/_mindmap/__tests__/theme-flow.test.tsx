/** @jest-environment jsdom */

import React from "react";
import { render, screen } from "@testing-library/react";

import { applySwatch, applyTheme, insertShape } from "../model/commands";
import { activePage, nodeById } from "../model/doc";
import { drawnInLines, kindColours } from "../model/flowchart/look";
import { neutralsFor, swatchFor, THEME_BY_ID } from "../model/palette";
import { shapeDef } from "../model/shapes";
import { EditorStore } from "../model/store";
import { buildTemplate } from "../model/templates";
import { applyThemeToDoc } from "../model/theme";
import type { DiagramNode, MindmapDoc } from "../model/types";
import { ThemePicker } from "../ui/ThemePicker";

/**
 * Picking a theme on a flowchart keeps every box's colour and changes the
 * paper and the lighting. It used to repaint the boxes in the theme's
 * branch colours: Ocean turned a Start pill teal and a decision violet, and
 * the dark twin did the same (2026-11-23).
 */

const isBox = (nd: DiagramNode) =>
    !shapeDef(nd.shape).container &&
    nd.shape !== "text" &&
    nd.shape !== "sticky" &&
    !drawnInLines(nd.shape);

const boxes = (doc: MindmapDoc) => activePage(doc).nodes.filter(isBox);
const looks = (doc: MindmapDoc) =>
    activePage(doc).nodes.map(n => [n.id, n.style, n.textStyle.color]);

describe("a theme on a flowchart", () => {
    const light = buildTemplate("flowchart", "F", "light");

    it("keeps colour by kind in the dark twin, and only the lighting changes", () => {
        const dark = applyThemeToDoc(light, "midnight");
        for (const nd of boxes(dark)) {
            const kind = kindColours(nd.shape, "dark");
            expect([nd.text, nd.style.fill, nd.style.stroke, nd.textStyle.color]).toEqual([
                nd.text,
                kind.fill,
                kind.line,
                kind.ink,
            ]);
            expect(nd.style.strokeWidth).toBe(0);
        }
        for (const e of activePage(dark).edges) {
            expect(e.style.stroke).toBe(neutralsFor("dark").inkSoft);
        }
        expect(activePage(dark).background.color).toBe(THEME_BY_ID.midnight!.background);
    });

    it("comes back exactly as it was", () => {
        const back = applyThemeToDoc(applyThemeToDoc(light, "midnight"), "default");
        expect(looks(back)).toEqual(looks(light));
        expect(activePage(back).edges.map(e => e.style)).toEqual(
            activePage(light).edges.map(e => e.style)
        );
    });

    it.each(["ocean", "sunset", "forest", "mono"])(
        "%s, in the same lighting, changes the paper and no box",
        themeId => {
            const themed = applyThemeToDoc(light, themeId);
            expect(looks(themed)).toEqual(looks(light));
            expect(activePage(themed).background.color).toBe(THEME_BY_ID[themeId]!.background);
        }
    );

    it("keeps a colour someone picked, in the new lighting", () => {
        const store = new EditorStore(buildTemplate("blank", "F", "light"));
        const id = insertShape(store, "process", { x: 0, y: 0 });
        store.selectNodes([id]);
        applySwatch(store, "pink");
        applyTheme(store, "midnight");
        const nd = nodeById(activePage(store.getState().doc), id)!;
        const pink = swatchFor("pink", "dark");
        expect([nd.style.fill, nd.style.stroke, nd.textStyle.color]).toEqual([
            pink.fill,
            pink.stroke,
            pink.ink,
        ]);
    });

    it("keeps stage colours and paper lanes", () => {
        const timeline = applyThemeToDoc(buildTemplate("timeline", "T", "light"), "midnight");
        const fresh = buildTemplate("timeline", "T", "dark");
        expect(boxes(timeline).map(n => n.style.fill)).toEqual(boxes(fresh).map(n => n.style.fill));
        const lanes = activePage(
            applyThemeToDoc(buildTemplate("swimlane", "S", "light"), "midnight")
        ).nodes.filter(n => n.shape === "swimlane-h");
        const freshLanes = activePage(buildTemplate("swimlane", "S", "dark")).nodes.filter(
            n => n.shape === "swimlane-h"
        );
        expect(lanes.map(n => n.style.fill)).toEqual(freshLanes.map(n => n.style.fill));
    });
});

describe("a theme on a mindmap", () => {
    it("still colours topics by branch, in the theme's colours", () => {
        const map = applyThemeToDoc(buildTemplate("mindmap", "M", "light"), "ocean");
        const root = activePage(map).nodes.find(n => n.shape === "mind-root")!;
        expect(root.style.fill).toBe(swatchFor(THEME_BY_ID.ocean!.root, "light").stroke);
    });
});

describe("the theme picker on a flowchart", () => {
    it("shows each theme as kind-coloured boxes on its own paper", () => {
        render(<ThemePicker activeId="default" onPick={() => {}} flow />);
        const tile = screen
            .getAllByRole("button")
            .find(b => b.getAttribute("aria-pressed") === "true")!;
        const colours = [...tile.querySelectorAll("span")].map(s => s.style.background);
        for (const shape of ["terminator", "process", "decision"] as const) {
            expect(colours).toContain(kindColours(shape, "light").fill);
        }
    });
});
