import { toast } from "sonner";
import type { ActionMenuItem } from "~/components/ui/action-menu";
import {
    APP_TARGET_KIND,
    LINK_TARGET_KIND,
    SELECTION_TARGET_KIND,
    copyText,
    type ActionDefinition,
    type LinkInfo,
    type TextSelectionInfo,
} from "~/lib/context-menu";

/**
 * Actions that hold everywhere: the selection and link overlays, and the
 * app-root fallback. Screens add their own on top (`useRegisterActions`).
 */
export function buildAppActions(theme: {
    current: string | undefined;
    set: (theme: string) => void;
}): ActionDefinition[] {
    const themes: { id: string; label: string }[] = [
        { id: "light", label: "Light" },
        { id: "dark", label: "Dark" },
        { id: "system", label: "System" },
    ];
    return [
        {
            id: "selection.copy",
            label: "Copy",
            icon: "copy",
            shortcut: "⌘C",
            // After the verbs a screen adds for a selection (ask, explain…).
            order: 50,
            appliesTo: target => target.kind === SELECTION_TARGET_KIND,
            run: async target => {
                const sel = target.data as TextSelectionInfo;
                if (await copyText(sel.text)) toast.success("Copied");
            },
        },
        {
            id: "link.open-new-tab",
            label: "Open link in new tab",
            icon: "external",
            appliesTo: target => target.kind === LINK_TARGET_KIND,
            run: target => {
                const link = target.data as LinkInfo;
                window.open(link.href, "_blank", "noopener,noreferrer");
            },
        },
        {
            id: "link.copy",
            label: "Copy link address",
            icon: "link",
            appliesTo: target => target.kind === LINK_TARGET_KIND,
            run: async target => {
                const link = target.data as LinkInfo;
                if (await copyText(link.href)) toast.success("Link copied");
            },
        },
        {
            id: "app.copy-page-link",
            label: "Copy link to this page",
            icon: "link",
            order: 90,
            appliesTo: target => target.kind === APP_TARGET_KIND,
            run: async () => {
                if (await copyText(window.location.href)) toast.success("Link copied");
            },
        },
        {
            id: "app.theme",
            label: "Theme",
            icon: "theme",
            order: 100,
            appliesTo: target => target.kind === APP_TARGET_KIND,
            children: (): ActionMenuItem[] =>
                themes.map(t => ({
                    type: "item",
                    id: `app.theme.${t.id}`,
                    label: t.label,
                    icon: theme.current === t.id ? "check" : undefined,
                    checked: theme.current === t.id,
                    onSelect: () => theme.set(t.id),
                })),
            run: () => undefined,
        },
    ];
}
