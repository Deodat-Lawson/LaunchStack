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
 * What the app-wide actions say, in the reader's language. The provider
 * fills it from the catalogue (`common.actions`, `workspace.contextMenu`).
 */
export interface AppActionLabels {
    copy: string;
    copied: string;
    openLinkInNewTab: string;
    copyLinkAddress: string;
    linkCopied: string;
    copyPageLink: string;
    theme: string;
    themes: { light: string; dark: string; system: string };
}

/**
 * Actions that hold everywhere: the selection and link overlays, and the
 * app-root fallback. Screens add their own on top (`useRegisterActions`).
 */
export function buildAppActions(
    theme: {
        current: string | undefined;
        set: (theme: string) => void;
    },
    labels: AppActionLabels
): ActionDefinition[] {
    const themes: { id: string; label: string }[] = [
        { id: "light", label: labels.themes.light },
        { id: "dark", label: labels.themes.dark },
        { id: "system", label: labels.themes.system },
    ];
    return [
        {
            id: "selection.copy",
            label: labels.copy,
            icon: "copy",
            shortcut: "⌘C",
            // After the verbs a screen adds for a selection (ask, explain…).
            order: 50,
            appliesTo: target => target.kind === SELECTION_TARGET_KIND,
            run: async target => {
                const sel = target.data as TextSelectionInfo;
                if (await copyText(sel.text)) toast.success(labels.copied);
            },
        },
        {
            id: "link.open-new-tab",
            label: labels.openLinkInNewTab,
            icon: "external",
            appliesTo: target => target.kind === LINK_TARGET_KIND,
            run: target => {
                const link = target.data as LinkInfo;
                window.open(link.href, "_blank", "noopener,noreferrer");
            },
        },
        {
            id: "link.copy",
            label: labels.copyLinkAddress,
            icon: "link",
            appliesTo: target => target.kind === LINK_TARGET_KIND,
            run: async target => {
                const link = target.data as LinkInfo;
                if (await copyText(link.href)) toast.success(labels.linkCopied);
            },
        },
        {
            id: "app.copy-page-link",
            label: labels.copyPageLink,
            icon: "link",
            order: 90,
            appliesTo: target => target.kind === APP_TARGET_KIND,
            run: async () => {
                if (await copyText(window.location.href)) toast.success(labels.linkCopied);
            },
        },
        {
            id: "app.theme",
            label: labels.theme,
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
