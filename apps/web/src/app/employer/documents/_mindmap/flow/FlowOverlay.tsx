"use client";

import React, { useEffect } from "react";
import { useTranslations } from "next-intl";

import { setBranchWords } from "../model/commands";
import { useStore } from "../ui/EditorContext";
import { setFlowStage } from "./keys/env";
import { KeyLegend } from "./keys/KeyLegend";
import { PickMenuOverlay } from "./pick/PickMenuOverlay";

/**
 * What a flowchart lays over the canvas stage: the key legend (bottom left)
 * and the "What goes here?" menu. Mounted whenever a flowchart is open and
 * not being presented, it is also how the key handlers and the commands
 * learn what only React knows — the stage's size and the words a decision's
 * branches are labelled with, in the reader's language.
 */
export function FlowOverlay({ canvasSize }: { canvasSize: { w: number; h: number } }) {
    const t = useTranslations("mindmap.flow.branch");
    const store = useStore();
    const yes = t("yes");
    const no = t("no");

    useEffect(() => {
        setFlowStage(store, { w: canvasSize.w, h: canvasSize.h });
    }, [store, canvasSize.w, canvasSize.h]);

    useEffect(() => {
        setBranchWords(store, { yes, no });
    }, [store, yes, no]);

    return (
        <>
            <KeyLegend />
            <PickMenuOverlay canvasSize={canvasSize} />
        </>
    );
}
