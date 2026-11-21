"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { DriftShell } from "~/app/employer/_chrome/DriftShell";
import { ToolsStudioShell } from "~/app/employer/_chrome/ToolsStudioShell";
import { buildTemplate } from "~/app/employer/documents/_mindmap/model/templates";
import { applyThemeToDoc } from "~/app/employer/documents/_mindmap/model/theme";
import { MindmapEditor } from "~/app/employer/documents/_mindmap/ui/MindmapEditor";
import { MindmapPreview as ReadOnlyMindmap } from "~/app/employer/documents/_mindmap/ui/MindmapPreview";
import {
    FLOW_VARIANT_IDS,
    isFlowVariantId,
    type FlowVariantId,
} from "~/app/employer/documents/_mindmap/variants/types";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";

/**
 * Local harness for the mindmap editor. It reproduces the real chrome chain —
 * employer layout → DriftShell → ToolsStudioShell → editor — so layout work
 * here is layout work there, but skips auth so the canvas can be driven
 * without a session. Gated to non-production by the server page.
 *
 * `?template=flowchart` picks a starter document; the default is the mindmap.
 * The full list is in `_mindmap/model/template-meta.ts`. `?view=preview` mounts
 * the read-only preview the workspace viewer uses instead of the editor — same
 * canvas, no chrome, so a layout bug in one shows up in the other.
 * `?chrome=focus|everything` overrides the chrome depth the document's kind
 * would pick (see the mindmap README, "Chrome depths"). `?board=dark` and
 * `?theme=<id>` pick the board's lighting and theme.
 *
 * `?variant=a|b|c|d` tries a flowchart direction (`_mindmap/variants/`) on a
 * blank flowchart, with a switcher pinned to the canvas's bottom-right corner.
 * The switcher shows on any flowchart, so "Today" is one click away.
 */

/**
 * `/api/mindmaps/*` is session-guarded, so autosave and the presence heartbeat
 * would 401 on a loop here. Answering them locally keeps the console readable
 * and lets both code paths run. Installed at module scope: an effect would let
 * the first heartbeat through before it took hold.
 */
let stubbed = false;
/**
 * The stub server's revision, one per board id. Every switch mounts a fresh
 * editor under a new id (`boardId` below), so a save the previous board sends
 * on its way out lands on its own id. With one shared id and one counter, that
 * late save looked like a newer version of the new board, which then fetched
 * it: an empty, untitled, non-flowchart document over its fresh board.
 */
const stubRevisions = new Map<number, number>();
function boardIdOf(url: string): number {
    const match = /\/api\/mindmaps\/(\d+)/.exec(url);
    return match ? Number(match[1]) : 0;
}
function stubMindmapApi() {
    if (stubbed || typeof window === "undefined") return;
    stubbed = true;

    const real = window.fetch.bind(window);

    window.fetch = async (input, init) => {
        const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!url.includes("/api/mindmaps")) return real(input, init);

        const json = (body: unknown) =>
            new Response(JSON.stringify(body), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });

        const id = boardIdOf(url);
        const revision = stubRevisions.get(id) ?? 1;
        if (url.includes("/presence")) return json({ peers: [], revision });
        if (url.includes("/versions")) return json({ versions: [] });
        if (/\/api\/mindmaps(\?|$)/.test(url)) return json({ mindmaps: [], folders: [] });
        if (init?.method && init.method !== "GET") {
            stubRevisions.set(id, revision + 1);
            return json({ mindmap: { revision: revision + 1 }, revision: revision + 1 });
        }
        return json({ mindmap: { revision } });
    };
}

stubMindmapApi();

export function MindmapPreview() {
    // Client-only. Node and edge ids are generated per build, so a server pass
    // and a client pass produce different documents and every shape hydrates
    // mismatched — noise that would bury any real warning.
    const [query, setQuery] = useState<URLSearchParams | null>(null);
    /** A fresh document id per board, so the boards' saves never meet. */
    const [boardId, setBoardId] = useState(1);

    useEffect(() => {
        setQuery(new URLSearchParams(window.location.search));
    }, []);

    const preview = query?.get("view") === "preview";
    const variantParam = query?.get("variant");
    const variant = isFlowVariantId(variantParam) ? variantParam : null;
    // A direction is tried on a blank flowchart unless a template is named.
    const template = query ? (query.get("template") ?? (variant ? "blank" : "mindmap")) : null;
    // The document's kind picks the chrome depth (a mindmap opens in focus,
    // a flowchart in everything); `?chrome=focus|everything` overrides it.
    const chromeParam = query?.get("chrome");
    const chrome =
        chromeParam === "focus" || chromeParam === "everything" ? chromeParam : undefined;

    // `?board=dark` seeds the document the way a dark-mode creator gets it;
    // `?theme=<id>` repaints it in any named theme (ids in `model/palette.ts`).
    const board = query?.get("board") === "dark" ? "dark" : "light";
    const themeId = query?.get("theme");

    const doc = useMemo(() => {
        if (!template) return null;
        const built = buildTemplate(template, "Preview mindmap", board);
        return themeId ? applyThemeToDoc(built, themeId) : built;
        // `variant` is a dependency on purpose: switching starts a fresh board.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [template, board, themeId, variant]);

    const pickVariant = useCallback((next: FlowVariantId | null) => {
        const params = new URLSearchParams(window.location.search);
        if (next) params.set("variant", next);
        else params.delete("variant");
        // Every choice, Today included, is a blank flowchart: without this,
        // Today fell back to the harness's default template, the mindmap.
        if (!params.get("template")) params.set("template", "blank");
        window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
        setBoardId(n => n + 1);
        setQuery(params);
        // Hand the keyboard back to the board. Left on the switcher, a
        // keyboard-first direction's keys moved between its buttons (and
        // Enter picked one) instead of drawing.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    }, []);
    const showSwitcher = !preview && doc !== null && doc.settings.kind !== "mindmap";

    return (
        <div style={{ minHeight: "100vh", width: "100%" }}>
            <DriftShell>
                <ToolsStudioShell>
                    {doc && preview && <ReadOnlyMindmap key={template} doc={doc} />}
                    {doc && !preview && (
                        <MindmapEditor
                            key={`${template}:${variant ?? "today"}:${boardId}`}
                            mindmapId={boardId}
                            initialDoc={doc}
                            initialTitle={doc.title}
                            initialRevision={1}
                            folder="Preview"
                            publishedDocumentId={null}
                            author="Preview user"
                            initialChrome={chrome}
                            flowVariant={variant ?? undefined}
                        />
                    )}
                </ToolsStudioShell>
            </DriftShell>
            {showSwitcher && <VariantSwitcher value={variant} onChange={pickVariant} />}
        </div>
    );
}

/**
 * Pick the flowchart direction to try. Pinned to the canvas's bottom-right
 * corner, the one place no direction uses: A's key legend and D's syntax
 * footer sit bottom-left, D's Steps panel runs down the left, and charts grow
 * from the centre. Outside the editor, so switching remounts it on a fresh
 * board. Names show on wide screens; letters (with the name as a tooltip)
 * keep it small elsewhere.
 */
function VariantSwitcher({
    value,
    onChange,
}: {
    value: FlowVariantId | null;
    onChange: (next: FlowVariantId | null) => void;
}) {
    const t = useTranslations("mindmap.variants");
    return (
        <div
            data-variant-switcher=""
            className="border-line bg-panel fixed bottom-12 right-4 z-50 flex items-center gap-3 rounded-xl border px-3 py-1.5 shadow-md"
        >
            <span
                className="text-ink-3 hidden whitespace-nowrap text-[12px] 2xl:inline"
                title={t("switcher.hint")}
            >
                {t("switcher.label")}
            </span>
            <ToggleGroup
                type="single"
                size="sm"
                value={value ?? "today"}
                onValueChange={next => {
                    if (!next) return;
                    onChange(isFlowVariantId(next) ? next : null);
                }}
                aria-label={t("switcher.label")}
            >
                <ToggleGroupItem value="today" className="px-2.5 text-[12.5px]">
                    {t("switcher.today")}
                </ToggleGroupItem>
                {FLOW_VARIANT_IDS.map(id => (
                    <ToggleGroupItem
                        key={id}
                        value={id}
                        title={t(`${id}.blurb`)}
                        className="gap-1.5 px-2.5 text-[12.5px]"
                    >
                        <span className="font-semibold">{id.toUpperCase()}</span>
                        <span className="hidden xl:inline">{t(`${id}.name`)}</span>
                    </ToggleGroupItem>
                ))}
            </ToggleGroup>
        </div>
    );
}
