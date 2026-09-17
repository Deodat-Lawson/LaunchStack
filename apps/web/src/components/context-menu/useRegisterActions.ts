"use client";

import { useEffect, useRef } from "react";
import { registerActions, type ActionDefinition } from "~/lib/context-menu";

/**
 * Registers actions for as long as the component is mounted. The list is
 * read through a ref on every call, so `run`/`appliesTo`/`label` closures
 * always see the latest render — callers need not memoise anything. Only a
 * change in the *set of ids* re-registers.
 */
export function useRegisterActions(defs: readonly ActionDefinition[] | null | undefined): void {
    const latest = useRef<readonly ActionDefinition[]>(defs ?? []);
    latest.current = defs ?? [];
    const key = latest.current.map(def => def.id).join("|");

    useEffect(() => {
        const ids = key ? key.split("|") : [];
        const proxies = ids.map((id, i) => proxyAction(id, () => latest.current[i]));
        return registerActions(proxies);
    }, [key]);
}

function proxyAction(id: string, get: () => ActionDefinition | undefined): ActionDefinition {
    const current = () => get() ?? MISSING;
    return {
        id,
        get icon() {
            return current().icon;
        },
        get shortcut() {
            return current().shortcut;
        },
        get danger() {
            return current().danger;
        },
        get order() {
            return current().order;
        },
        get palette() {
            return current().palette;
        },
        get children() {
            return current().children;
        },
        get disabled() {
            return current().disabled;
        },
        get checked() {
            return current().checked;
        },
        label: (target, ctx) => {
            const label = current().label;
            return typeof label === "function" ? label(target, ctx) : label;
        },
        appliesTo: (target, ctx) => current().appliesTo(target, ctx),
        run: (target, ctx) => current().run(target, ctx),
    };
}

const MISSING: ActionDefinition = {
    id: "missing",
    label: "",
    appliesTo: () => false,
    run: () => undefined,
};
