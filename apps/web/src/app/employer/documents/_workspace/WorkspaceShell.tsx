"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth, useUser } from "@clerk/nextjs";
import LoadingPage from "~/app/_components/loading";
import { useAIChat } from "../hooks/useAIChat";
import { AddSourceModal } from "./AddSourceModal";
import { AskPanel } from "./AskPanel";
import { CommandPalette } from "./CommandPalette";
import { DocumentViewer } from "./DocumentViewer";
import { IconChevronLeft } from "./icons";
import { NewFolderDialog } from "./NewFolderDialog";
import { RenameFolderDialog } from "./RenameFolderDialog";
import { SourceRail } from "./SourceRail";
import { StudioDrawer } from "./StudioDrawer";
import { StudioFAB, StudioMenu } from "./StudioMenu";
import { renderStudioPane } from "./StudioPanes";
import {
  DEFAULT_COMPOSER_MODEL,
  STUDIO_FEATURES_BY_ID,
  findComposerModel,
} from "./types";
import { useWorkspaceData } from "./useWorkspaceData";
import type {
  ComposerModelOption,
  ComposerSend,
  ThreadMessage,
  WorkspaceFolder,
  WorkspaceSource,
} from "./types";

/**
 * Legacy `?view=X` URL params that used to drive the deleted DocumentViewerShell.
 * Studio features now open inline in the workspace drawer via `?feature=X`;
 * upload opens inline in the AddSourceModal via `?add=1`. Admin views redirect
 * to their standalone `/employer/<name>` routes. Values folded into the default
 * workspace map to the workspace root — any `docId` in the URL is preserved so
 * the DocumentViewer modal can pick it up.
 */
const LEGACY_VIEW_REDIRECTS: Record<string, string> = {
  "document-only": "/employer/documents/viewer",
  "with-ai-qa": "/employer/documents",
  "with-ai-qa-history": "/employer/documents",
  "predictive-analysis": "/employer/documents?feature=audit",
  generator: "/employer/documents?feature=draft",
  rewrite: "/employer/documents?feature=rewrite",
  upload: "/employer/documents?add=1",
  dashboard: "/employer/home",
  analytics: "/employer/statistics",
  employees: "/employer/employees",
  settings: "/employer/settings",
  metadata: "/employer/metadata",
  "marketing-pipeline": "/employer/tools/marketing-pipeline",
  "repo-explainer": "/employer/tools/repo-explainer",
  notes: "/employer/documents?feature=notes",
  workflows: "/employer/documents?feature=workflows",
};

/**
 * Features accessible via `?feature=X`. All open the Studio drawer on the
 * corresponding pane; draft/rewrite/workflows/notes remain independently
 * reachable via the AskPanel QuickPen view.
 */
const FEATURE_IDS = new Set([
  "draft",
  "rewrite",
  "notes",
  "workflows",
  "video-gen",
  "image-gen",
  "audio-gen",
  "marketing",
  "metadata",
  "settings",
  "analytics",
]);

function initialsOf(first?: string | null, last?: string | null, email?: string | null) {
  const parts = [first, last].filter(Boolean) as string[];
  if (parts.length > 0) {
    return parts.map((p) => p[0]?.toUpperCase()).join("").slice(0, 2);
  }
  if (email) return email[0]?.toUpperCase() ?? "U";
  return "U";
}

export function WorkspaceShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoaded, isSignedIn, userId, signOut } = useAuth();
  const { user } = useUser();

  // Legacy `?view=X` URLs redirect to their new destinations. Any other params
  // (docId, versionId, prompt, etc.) are carried across so deep links survive.
  const legacyView = searchParams.get("view");
  const legacyRedirect = legacyView ? LEGACY_VIEW_REDIRECTS[legacyView] : null;

  useEffect(() => {
    if (!legacyRedirect) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("view");
    // Some redirects already include a query (e.g. `?feature=X`). Merge, not
    // clobber, so carry-over params land alongside.
    const [basePath, baseQuery] = legacyRedirect.split("?");
    if (baseQuery) {
      for (const [k, v] of new URLSearchParams(baseQuery)) params.set(k, v);
    }
    const query = params.toString();
    router.replace(query ? `${basePath}?${query}` : basePath!);
  }, [legacyRedirect, searchParams, router]);

  // Redirect unauthenticated users back to the landing page.
  useEffect(() => {
    if (isLoaded && !isSignedIn) router.push("/");
  }, [isLoaded, isSignedIn, router]);

  const { sources, folders, companyId, role, refresh } = useWorkspaceData(userId ?? null);

  const [selected, setSelected] = useState<string[]>([]);
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [palOpen, setPalOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [renameFolder, setRenameFolder] = useState<WorkspaceFolder | null>(null);
  const [viewerSource, setViewerSource] = useState<WorkspaceSource | null>(null);
  const [studioOpen, setStudioOpen] = useState(false);
  const [studioFeatureId, setStudioFeatureId] = useState<string | null>(null);
  /**
   * Which feature is "expanded" into the main workspace area. Defaults to
   * `chat`, which renders the AskPanel; any other id renders the corresponding
   * pane inline. Set via the drawer's Expand button or `?feature=X` deep links.
   */
  const [activeFeatureId, setActiveFeatureId] = useState<string>("chat");

  // Composer preferences persisted across reloads so picking a model or
  // toggling Web/Think doesn't reset on every refresh. Ephemeral attachments
  // are NOT persisted — those are turn-scoped, owned by the Composer.
  const [composerModel, setComposerModel] =
    useState<ComposerModelOption>(DEFAULT_COMPOSER_MODEL);
  const [composerWebSearch, setComposerWebSearch] = useState(false);
  const [composerThinking, setComposerThinking] = useState(false);
  const composerPrefsReady = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("askPanel.composer.v1");
      if (raw) {
        const parsed = JSON.parse(raw) as {
          model?: string;
          webSearch?: boolean;
          thinking?: boolean;
        };
        if (parsed.model) setComposerModel(findComposerModel(parsed.model));
        if (typeof parsed.webSearch === "boolean")
          setComposerWebSearch(parsed.webSearch);
        if (typeof parsed.thinking === "boolean")
          setComposerThinking(parsed.thinking);
      }
    } catch {
      // Corrupt storage — fall back to defaults.
    }
    composerPrefsReady.current = true;
  }, []);

  useEffect(() => {
    if (!composerPrefsReady.current) return;
    try {
      localStorage.setItem(
        "askPanel.composer.v1",
        JSON.stringify({
          model: composerModel.id,
          webSearch: composerWebSearch,
          thinking: composerThinking,
        }),
      );
    } catch {
      // Quota / private mode — drop silently.
    }
  }, [composerModel, composerWebSearch, composerThinking]);

  const { sendQuery, loading: isSending } = useAIChat();

  const sendMessage = useCallback(
    async (send: ComposerSend) => {
      setThread((prev) => [
        ...prev,
        {
          role: "user",
          text: send.text,
          refs: send.refs,
          attachments: send.attachments.length > 0 ? send.attachments : undefined,
        },
      ]);

      const numericIds = send.refs
        .map((r) => sources.find((s) => s.id === r)?.documentId)
        .filter((n): n is number => typeof n === "number");

      const scope =
        numericIds.length >= 2
          ? "selected"
          : numericIds.length === 1
          ? "document"
          : companyId
          ? "company"
          : "document";

      const data = await sendQuery({
        question: send.text,
        searchScope: scope as "document" | "company" | "selected",
        documentId: scope === "document" ? numericIds[0] : undefined,
        selectedDocumentIds: scope === "selected" ? numericIds : undefined,
        companyId: scope === "company" ? companyId ?? undefined : undefined,
        aiModel: send.model as never,
        provider: send.provider as never,
        enableWebSearch: send.webSearch,
        thinkingMode: send.thinking,
        attachments: send.attachments.map((a) => ({
          url: a.url,
          name: a.name,
          mimeType: a.mimeType,
          kind: a.kind,
        })),
      });

      if (data) {
        const citations = (data.references ?? [])
          .map((r) => {
            const src = sources.find((s) => s.documentId === Number(r.documentId));
            return src
              ? {
                  sourceId: src.id,
                  snippet: r.snippet ?? "",
                }
              : null;
          })
          .filter((c): c is { sourceId: string; snippet: string } => Boolean(c))
          .slice(0, 4);

        setThread((prev) => [
          ...prev,
          {
            role: "assistant",
            text: data.summarizedAnswer ?? "No answer.",
            citations,
            model: data.aiModel,
            tokens: data.chunksAnalyzed,
          },
        ]);
      } else {
        setThread((prev) => [
          ...prev,
          {
            role: "assistant",
            text: "Couldn't reach the model. Try again in a moment.",
          },
        ]);
      }
    },
    [sources, sendQuery, companyId],
  );

  const handleOpenSource = useCallback((source: WorkspaceSource) => {
    setViewerSource(source);
  }, []);

  const handleRenameDoc = useCallback(
    async (docId: number, nextTitle: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/documents/${docId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: nextTitle }),
        });
        if (!res.ok) return false;
        await refresh();
        // Keep the viewer in sync with the new title.
        setViewerSource((v) =>
          v && v.documentId === docId ? { ...v, title: nextTitle } : v,
        );
        return true;
      } catch {
        return false;
      }
    },
    [refresh],
  );

  const handleDeleteDoc = useCallback(
    async (docId: number) => {
      try {
        const res = await fetch("/api/deleteDocument", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docId: String(docId) }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          alert(body.error ?? "Failed to delete document");
          return;
        }
        setViewerSource(null);
        setSelected((prev) => prev.filter((id) => !id.endsWith(String(docId))));
        await refresh();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to delete document");
      }
    },
    [refresh],
  );

  const handleAskAbout = useCallback((source: WorkspaceSource) => {
    setSelected((prev) => (prev.includes(source.id) ? prev : [source.id, ...prev]));
    setViewerSource(null);
  }, []);

  const handleMoveToFolder = useCallback(
    async (sourceId: string, folderName: string) => {
      const src = sources.find((s) => s.id === sourceId);
      if (!src?.documentId) return;
      if ((src.folder ?? "Unfiled") === folderName) return;
      try {
        const res = await fetch(`/api/documents/${src.documentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: folderName }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          alert(body.error ?? "Failed to move document");
          return;
        }
        await refresh();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to move document");
      }
    },
    [sources, refresh],
  );

  const openFeature = useCallback(
    (featureId?: string) => {
      // When no id is supplied, land on the feature currently expanded in the
      // main area (defaults to "chat" — the Workspace group's Chat entry).
      setStudioFeatureId(featureId ?? activeFeatureId);
      setStudioOpen(true);
    },
    [activeFeatureId],
  );

  const expandFeature = useCallback((featureId: string) => {
    setActiveFeatureId(featureId);
    setStudioOpen(false);
  }, []);

  // `?feature=X` switches the AskPanel to QuickPen (draft/rewrite/workflows/notes)
  // or opens the Studio drawer overlay (audit/marketing/...); `?add=1` opens the
  // AddSourceModal. Both are stripped from the URL after firing so refreshes
  // don't re-open the overlay.
  const featureParam = searchParams.get("feature");
  const addParam = searchParams.get("add");
  useEffect(() => {
    if (!featureParam && !addParam) return;
    if (legacyRedirect) return;
    if (featureParam && FEATURE_IDS.has(featureParam)) {
      openFeature(featureParam);
    }
    if (addParam) {
      setAddOpen(true);
    }
    const params = new URLSearchParams(searchParams.toString());
    params.delete("feature");
    params.delete("add");
    const query = params.toString();
    router.replace(query ? `/employer/documents?${query}` : "/employer/documents");
  }, [featureParam, addParam, legacyRedirect, openFeature, router, searchParams]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA";
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalOpen((v) => !v);
      } else if (mod && e.key.toLowerCase() === "u") {
        e.preventDefault();
        setAddOpen(true);
      } else if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setStudioOpen((v) => !v);
      } else if (e.key === "/" && !inInput) {
        e.preventDefault();
        const el = document.querySelector<HTMLInputElement>(
          'input[placeholder="Search your sources"]',
        );
        el?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!isLoaded) return <LoadingPage />;
  if (!isSignedIn) return <LoadingPage />;

  // While a legacy `?view=X` redirect is in flight, avoid flashing the workspace.
  if (legacyRedirect) return <LoadingPage />;

  const userName =
    user?.fullName ??
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ??
    undefined;
  const userEmail = user?.primaryEmailAddress?.emailAddress;
  const initials = initialsOf(user?.firstName, user?.lastName, userEmail);

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden" }}>
      <SourceRail
        sources={sources}
        folders={folders}
        selected={selected}
        setSelected={setSelected}
        onOpenAdd={() => setAddOpen(true)}
        onOpenSource={handleOpenSource}
        onNewFolder={() => setNewFolderOpen(true)}
        onRenameFolder={(folder) => setRenameFolder(folder)}
        onMoveToFolder={(id, name) => void handleMoveToFolder(id, name)}
        activeFolder={activeFolder}
        setActiveFolder={setActiveFolder}
        activeTag={activeTag}
        setActiveTag={setActiveTag}
      />

      {activeFeatureId === "chat" ? (
        <AskPanel
          sources={sources}
          selected={selected}
          setSelected={setSelected}
          thread={thread}
          sendMessage={sendMessage}
          isSending={isSending}
          onOpenAdd={() => setAddOpen(true)}
          onNewChat={() => setThread([])}
          openPalette={() => setPalOpen(true)}
          onStudioNavigate={(href) => router.push(href)}
          userInitials={initials}
          userName={userName}
          userEmail={userEmail}
          onSignOut={() => signOut({ redirectUrl: "/" })}
          model={composerModel}
          onPickModel={setComposerModel}
          webSearch={composerWebSearch}
          onToggleWebSearch={() => setComposerWebSearch((v) => !v)}
          thinking={composerThinking}
          onToggleThinking={() => setComposerThinking((v) => !v)}
          studioSlot={
            <StudioMenu
              role={role}
              onOpenStudio={() => openFeature()}
              onPickFeature={(id) => openFeature(id)}
            />
          }
        />
      ) : (
        <ExpandedFeatureView
          featureId={activeFeatureId}
          role={role}
          onBackToChat={() => setActiveFeatureId("chat")}
          onOpenStudio={() => openFeature()}
          onPickFeature={(id) => openFeature(id)}
        />
      )}

      {studioOpen && (
        <StudioDrawer
          open
          role={role}
          initialFeatureId={studioFeatureId}
          activeFeatureId={activeFeatureId}
          onClose={() => setStudioOpen(false)}
          onExpand={expandFeature}
        />
      )}

      <AddSourceModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        userId={userId ?? null}
        defaultCategory={activeFolder ?? folders[0]?.name ?? "Unfiled"}
        folders={folders.map((f) => f.name)}
        onUploaded={() => {
          void refresh();
        }}
      />

      <CommandPalette
        open={palOpen}
        onClose={() => setPalOpen(false)}
        sources={sources}
        onOpenAdd={() => {
          setPalOpen(false);
          setTimeout(() => setAddOpen(true), 100);
        }}
        onPickSource={(id) => {
          setSelected((prev) => (prev.includes(id) ? prev : [id, ...prev]));
        }}
        onPickFeature={(id) => {
          setPalOpen(false);
          setTimeout(() => openFeature(id), 100);
        }}
      />

      <NewFolderDialog
        open={newFolderOpen}
        onClose={() => setNewFolderOpen(false)}
        existingFolders={folders.map((f) => f.name)}
        onCreated={() => {
          void refresh();
        }}
      />

      <RenameFolderDialog
        open={!!renameFolder}
        folder={renameFolder}
        onClose={() => setRenameFolder(null)}
        existingFolders={folders.map((f) => f.name)}
        onRenamed={(newName) => {
          if (activeFolder === renameFolder?.name) setActiveFolder(newName);
          void refresh();
        }}
        onDeleted={() => {
          if (activeFolder === renameFolder?.name) setActiveFolder(null);
          void refresh();
        }}
      />

      {viewerSource && (
        <DocumentViewer
          source={viewerSource}
          onClose={() => setViewerSource(null)}
          onRename={handleRenameDoc}
          onDelete={(id) => void handleDeleteDoc(id)}
          onAskAbout={handleAskAbout}
          onVersionChanged={() => void refresh()}
        />
      )}

      <StudioFAB
        hidden={
          addOpen ||
          palOpen ||
          newFolderOpen ||
          !!renameFolder ||
          !!viewerSource ||
          studioOpen
        }
        onPickFeature={(id) => openFeature(id)}
      />
    </div>
  );
}

interface ExpandedFeatureViewProps {
  featureId: string;
  role: string | null;
  onBackToChat: () => void;
  onOpenStudio: () => void;
  onPickFeature: (featureId: string) => void;
}

/**
 * Main-area container for a Studio feature that's been expanded out of the
 * drawer. Mirrors AskPanel's topbar (Studio menu + back-to-chat) so the
 * navigation stays consistent across feature swaps.
 */
function ExpandedFeatureView({
  featureId,
  role,
  onBackToChat,
  onOpenStudio,
  onPickFeature,
}: ExpandedFeatureViewProps) {
  const feature = STUDIO_FEATURES_BY_ID[featureId];

  return (
    <main
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      <div
        style={{
          padding: "10px 20px",
          borderBottom: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: "var(--panel)",
          flexShrink: 0,
        }}
      >
        <button
          onClick={onBackToChat}
          title="Back to Chat"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 10px",
            borderRadius: 7,
            border: "1px solid var(--line)",
            background: "var(--panel)",
            color: "var(--ink-2)",
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--accent)";
            e.currentTarget.style.color = "var(--accent)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--line)";
            e.currentTarget.style.color = "var(--ink-2)";
          }}
        >
          <IconChevronLeft size={12} />
          Back to Chat
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {feature?.label ?? "Studio"}
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
            {feature?.desc ?? ""}
          </div>
        </div>
        <StudioMenu
          role={role}
          onOpenStudio={onOpenStudio}
          onPickFeature={onPickFeature}
        />
      </div>
      <div style={{ flex: 1, overflow: "hidden" }}>
        {feature ? (
          renderStudioPane(feature, onBackToChat)
        ) : (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--ink-3)",
              fontSize: 13,
            }}
          >
            Unknown feature — returning to Chat…
          </div>
        )}
      </div>
    </main>
  );
}
