"use client";

import { useEffect, useState } from "react";

import { DriftShell } from "~/app/employer/_chrome/DriftShell";
import { ToolsStudioShell } from "~/app/employer/_chrome/ToolsStudioShell";
import { ArtifactGallery } from "~/app/employer/artifacts/_artifacts/ui/ArtifactGallery";
import { ArtifactViewer } from "~/app/employer/artifacts/_artifacts/ui/ArtifactViewer";
import { detectArtifactType } from "~/lib/artifact-content";

/**
 * Local harness for the Artifacts app. It reproduces the real chrome chain —
 * DriftShell → ToolsStudioShell → gallery/viewer — so layout work here is
 * layout work there, but skips auth so the pages can be driven without a
 * session. Gated to non-production by the server page.
 *
 * `?view=viewer&id=N` opens the viewer on a seeded artifact (1 html, 2 svg,
 * 3 markdown, 4 mermaid, 5 code); the default is the gallery. The stub keeps
 * an in-memory store so import, rename, star, folder moves, and trash all
 * round-trip for real.
 */

interface StubArtifact {
    id: number;
    title: string;
    description: string | null;
    folder: string;
    artifactType: string;
    sourceUrl: string | null;
    importMethod: string;
    content: string;
    sizeBytes: number;
    contentHash: string;
    starred: boolean;
    createdByUserId: string;
    updatedByUserId: string | null;
    deletedAt: string | null;
    openedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

const SEED_HTML = `<!DOCTYPE html>
<html><head><title>Churn Dashboard</title><style>
  body { font-family: system-ui; background: linen; color: black; padding: 32px; }
  .card { background: white; border-radius: 12px; padding: 20px; max-width: 420px; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
  button { background: slateblue; color: white; border: 0; border-radius: 8px; padding: 8px 14px; cursor: pointer; }
</style></head><body>
<div class="card"><h1>Churn Dashboard</h1><p>Interactive artifact — scripts run sandboxed.</p>
<button onclick="document.getElementById('n').textContent = Number(document.getElementById('n').textContent)+1">
Clicked <span id="n">0</span> times</button>
<p id="cookie-check"></p></div>
<script>
  try { document.getElementById('cookie-check').textContent = 'document.cookie: "' + document.cookie + '"'; }
  catch (e) { document.getElementById('cookie-check').textContent = 'cookie access threw: ' + e.name; }
</script>
</body></html>`;

const SEED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120">
  <title>Funnel</title>
  <rect x="10" y="10" width="180" height="24" rx="6" fill="slateblue"/>
  <rect x="30" y="44" width="140" height="24" rx="6" fill="mediumpurple"/>
  <rect x="55" y="78" width="90" height="24" rx="6" fill="thistle"/>
</svg>`;

const SEED_MD = `# Rollout plan

A **markdown** artifact imported from Claude.

- Phase 1: internal dogfood
- Phase 2: design partners
- Phase 3: GA

| Week | Milestone |
| ---- | --------- |
| 1    | Flag on   |
| 3    | Review    |
`;

const SEED_MERMAID = `flowchart TD
    A[Import artifact] --> B{Type?}
    B -->|html/svg| C[Sandboxed iframe]
    B -->|markdown| D[Rendered prose]
    B -->|mermaid| E[Diagram]
    B -->|react/code| F[Source view]`;

const SEED_CODE = `def churn_rate(cancelled: int, total: int) -> float:
    if total == 0:
        return 0.0
    return cancelled / total
`;

function seed(id: number, title: string, folder: string, content: string): StubArtifact {
    const now = new Date().toISOString();
    return {
        id,
        title,
        description: null,
        folder,
        artifactType: detectArtifactType(content),
        sourceUrl: id === 1 ? "https://claude.ai/public/artifacts/example" : null,
        importMethod: "paste",
        content,
        sizeBytes: new Blob([content]).size,
        contentHash: String(id).repeat(8),
        starred: id === 1,
        createdByUserId: "dev-user",
        updatedByUserId: null,
        deletedAt: null,
        openedAt: now,
        createdAt: now,
        updatedAt: now,
    };
}

/**
 * `/api/artifacts/*` is session-guarded, so every call here would 401.
 * Answering them from an in-memory store lets the whole management flow run.
 * Installed at module scope: an effect would let the first load through.
 */
let stubbed = false;
function stubArtifactsApi() {
    if (stubbed || typeof window === "undefined") return;
    stubbed = true;

    const store: StubArtifact[] = [
        seed(1, "Churn Dashboard", "Dashboards", SEED_HTML),
        seed(2, "Funnel diagram", "Dashboards", SEED_SVG),
        seed(3, "Rollout plan", "Unfiled", SEED_MD),
        seed(4, "Import flow", "Unfiled", SEED_MERMAID),
        seed(5, "churn.py", "Snippets", SEED_CODE),
    ];
    let nextId = 6;

    const real = window.fetch.bind(window);
    const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
            status,
            headers: { "Content-Type": "application/json" },
        });
    const folders = () => [...new Set(store.filter(a => !a.deletedAt).map(a => a.folder))].sort();

    window.fetch = async (input, init) => {
        const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!url.includes("/api/artifacts")) return real(input, init);

        const method = init?.method ?? "GET";
        const idMatch = /\/api\/artifacts\/(\d+)/.exec(url);

        if (!idMatch && method === "GET") {
            const scope = new URL(url, window.location.origin).searchParams.get("scope");
            const items = store
                .filter(a => (scope === "trash" ? a.deletedAt : !a.deletedAt))
                .map(({ content: _content, ...summary }) => summary);
            return json({ artifacts: items, folders: folders() });
        }
        if (!idMatch && method === "POST") {
            const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
                title?: string;
                folder?: string;
                content?: string;
                sourceUrl?: string;
                fetchFromUrl?: boolean;
            };
            if (body.fetchFromUrl) {
                return json(
                    {
                        error: "claude.ai pages can't be fetched server-side — they render the artifact in the browser behind bot protection. Copy the artifact's code (or download it) in Claude and paste or upload it here; the link is kept as the source.",
                        code: "claude_share_link",
                    },
                    422
                );
            }
            const created = seed(
                nextId++,
                body.title ?? "Untitled artifact",
                body.folder ?? "Unfiled",
                body.content ?? ""
            );
            created.starred = false;
            created.sourceUrl = body.sourceUrl ?? null;
            store.unshift(created);
            return json({ artifact: created }, 201);
        }

        const artifact = idMatch ? store.find(a => a.id === Number(idMatch[1])) : undefined;
        if (!artifact) return json({ error: "Artifact not found" }, 404);

        if (method === "PATCH") {
            const body = JSON.parse(
                typeof init?.body === "string" ? init.body : "{}"
            ) as Partial<StubArtifact> & { restore?: boolean };
            if (body.restore) artifact.deletedAt = null;
            if (body.title !== undefined) artifact.title = body.title;
            if (body.description !== undefined) artifact.description = body.description;
            if (body.folder !== undefined) artifact.folder = body.folder;
            if (body.starred !== undefined) artifact.starred = body.starred;
            if (body.artifactType !== undefined) artifact.artifactType = body.artifactType;
            if (body.content !== undefined) artifact.content = body.content;
            artifact.updatedAt = new Date().toISOString();
            return json({ artifact });
        }
        if (method === "DELETE") {
            if (url.includes("purge=1")) {
                store.splice(store.indexOf(artifact), 1);
                return json({ deleted: true, purged: true });
            }
            artifact.deletedAt = new Date().toISOString();
            return json({ deleted: true, purged: false });
        }
        return json({ artifact });
    };
}

stubArtifactsApi();

export function ArtifactsPreview() {
    // Client-only so the stub is installed before anything mounts.
    const [query, setQuery] = useState<URLSearchParams | null>(null);

    useEffect(() => {
        setQuery(new URLSearchParams(window.location.search));
    }, []);

    if (!query) return null;

    const viewerId = query.get("view") === "viewer" ? Number(query.get("id") ?? 1) : null;

    return (
        <DriftShell>
            <ToolsStudioShell>
                {viewerId !== null ? <ArtifactViewer id={viewerId} /> : <ArtifactGallery />}
            </ToolsStudioShell>
        </DriftShell>
    );
}
