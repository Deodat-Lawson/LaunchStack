"use client";

import { useEffect, useMemo, useState } from "react";

import { DriftShell } from "~/app/employer/_chrome/DriftShell";
import { ToolsStudioShell } from "~/app/employer/_chrome/ToolsStudioShell";
import { buildTemplate } from "~/app/employer/mindmap/_mindmap/model/templates";
import { MindmapEditor } from "~/app/employer/mindmap/_mindmap/ui/MindmapEditor";
import { MindmapGallery } from "~/app/employer/mindmap/_mindmap/ui/MindmapGallery";

/**
 * Local harness for the mindmap editor. It reproduces the real chrome chain —
 * employer layout → DriftShell → ToolsStudioShell → editor — so layout work
 * here is layout work there, but skips Clerk so the canvas can be driven
 * without a session. Gated to non-production by the server page.
 *
 * `?template=flowchart` picks a starter document; the default is the mindmap.
 * The full list is in `_mindmap/model/template-meta.ts`. `?view=gallery` shows
 * the index page instead of the editor — it shares the same shell, so it shares
 * the same layout bugs.
 */

/**
 * `/api/mindmaps/*` is session-guarded, so autosave and the presence heartbeat
 * would 401 on a loop here. Answering them locally keeps the console readable
 * and lets both code paths run. Installed at module scope: an effect would let
 * the first heartbeat through before it took hold.
 */
let stubbed = false;
function stubMindmapApi() {
    if (stubbed || typeof window === "undefined") return;
    stubbed = true;

    const real = window.fetch.bind(window);
    let revision = 1;

    window.fetch = async (input, init) => {
        const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!url.includes("/api/mindmaps")) return real(input, init);

        const json = (body: unknown) =>
            new Response(JSON.stringify(body), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });

        if (url.includes("/presence")) return json({ peers: [], revision });
        if (url.includes("/versions")) return json({ versions: [] });
        if (/\/api\/mindmaps(\?|$)/.test(url)) return json({ mindmaps: [], folders: [] });
        if (init?.method && init.method !== "GET") {
            revision += 1;
            return json({ mindmap: { revision }, revision });
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

    useEffect(() => {
        setQuery(new URLSearchParams(window.location.search));
    }, []);

    const gallery = query?.get("view") === "gallery";
    const template = query && !gallery ? (query.get("template") ?? "mindmap") : null;

    const doc = useMemo(
        () => (template ? buildTemplate(template, "Preview mindmap") : null),
        [template]
    );

    return (
        <div style={{ minHeight: "100vh", width: "100%" }}>
            <DriftShell>
                <ToolsStudioShell>
                    {gallery && <MindmapGallery />}
                    {doc && (
                        <MindmapEditor
                            key={template}
                            mindmapId={1}
                            initialDoc={doc}
                            initialTitle={doc.title}
                            initialRevision={1}
                            folder="Preview"
                            publishedDocumentId={null}
                            author="Preview user"
                        />
                    )}
                </ToolsStudioShell>
            </DriftShell>
        </div>
    );
}
