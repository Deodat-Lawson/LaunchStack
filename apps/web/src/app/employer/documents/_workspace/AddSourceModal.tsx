"use client";

import React, {
  type ComponentType,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  IconBolt,
  IconCheck,
  IconChevronDown,
  IconFile,
  IconFolder,
  IconPlus,
  IconX,
  type IconProps,
} from "./icons";
import { ADD_TABS, SOURCE_META, type AddSourceTab } from "./types";

/**
 * AddSourceModal — tabbed upload/connect modal matching the Launstack
 * design handoff (`modal.jsx`). Sidebar lists Upload + Connect tabs; the
 * right panel hosts the active tab; a footer strip carries the "Save to"
 * folder picker so destination stays visible across tabs.
 *
 * Backend integration is kept unchanged:
 *   - Files / Audio / Video: `/api/storage/upload` → `/api/uploadDocument`
 *   - Folder: same as above, fanned out across the picked files
 *   - Paste: wraps the text in a `.md` File and runs the file path
 *   - URL: `/api/upload/website`
 *   - YouTube: `/api/upload/video-url`
 *   - Connectors: not yet wired (OAuth) — surfaced as coming-soon CTAs.
 */

export interface AddSourceModalProps {
  open: boolean;
  onClose: () => void;
  userId: string | null;
  /** Folder name to pre-select in the Save-to picker (e.g. the rail's active folder). */
  defaultCategory: string;
  /** Existing folder names for the Save-to picker. */
  folders: string[];
  /** Called after any successful ingest so the workspace can refresh its list. */
  onUploaded: () => void;
  /** Optional: persist a new folder name the user typed in the picker. */
  onCreateFolder?: (name: string) => void;
}

interface UploadResult {
  objectKey: string;
  bucket: string;
  url: string;
}

async function uploadFileToStorage(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/storage/upload", { method: "POST", body: form });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Upload failed (HTTP ${res.status})`);
  }
  return (await res.json()) as UploadResult;
}

async function registerDocument(params: {
  userId: string;
  file: File;
  url: string;
  objectKey: string;
  category: string;
}): Promise<void> {
  const body = {
    userId: params.userId,
    documentName: params.file.name,
    category: params.category,
    documentUrl: params.url,
    storageType: "s3" as const,
    mimeType: params.file.type || "application/octet-stream",
    originalFilename: params.file.name,
    storageProvider: "s3",
    storagePathname: params.objectKey,
  };
  const res = await fetch("/api/uploadDocument", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Document registration failed (HTTP ${res.status}) ${text}`);
  }
}

async function uploadAndRegisterAll(params: {
  userId: string;
  files: File[];
  category: string;
  onProgress?: (completed: number, total: number) => void;
}): Promise<{ successes: number; errors: string[] }> {
  let successes = 0;
  const errors: string[] = [];
  for (let i = 0; i < params.files.length; i++) {
    const file = params.files[i]!;
    try {
      const up = await uploadFileToStorage(file);
      await registerDocument({
        userId: params.userId,
        file,
        url: up.url,
        objectKey: up.objectKey,
        category: params.category,
      });
      successes++;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : `Failed to upload ${file.name}`);
    }
    params.onProgress?.(i + 1, params.files.length);
  }
  return { successes, errors };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function extOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : "";
}

function extColor(ext: string): string {
  const map: Record<string, string> = {
    pdf: "oklch(0.55 0.17 25)",
    pptx: "oklch(0.6 0.15 40)",
    ppt: "oklch(0.6 0.15 40)",
    xlsx: "oklch(0.55 0.15 150)",
    xls: "oklch(0.55 0.15 150)",
    csv: "oklch(0.55 0.15 150)",
    docx: "oklch(0.55 0.14 250)",
    doc: "oklch(0.55 0.14 250)",
    md: "oklch(0.5 0.02 280)",
    txt: "oklch(0.5 0.02 280)",
  };
  return map[ext] ?? "var(--ink-3)";
}

// ---------------------------------------------------------------------------
// Modal shell
// ---------------------------------------------------------------------------

export function AddSourceModal({
  open,
  onClose,
  userId,
  defaultCategory,
  folders,
  onUploaded,
  onCreateFolder,
}: AddSourceModalProps) {
  const [tab, setTab] = useState<string>("files");
  const [folder, setFolder] = useState<string>(defaultCategory || "Unfiled");

  useEffect(() => {
    if (!open) return;
    setFolder(defaultCategory || "Unfiled");
    setTab("files");
  }, [open, defaultCategory]);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  if (!open) return null;

  const allTabs: AddSourceTab[] = ADD_TABS.flatMap((g) => g.items);
  const active = allTabs.find((t) => t.id === tab) ?? allTabs[0]!;

  const handleUploaded = () => {
    onUploaded();
    onClose();
  };

  let panel: React.ReactNode = null;
  if (tab === "files") {
    panel = (
      <FilesPanel
        kind="files"
        userId={userId}
        category={folder}
        onUploaded={handleUploaded}
      />
    );
  } else if (tab === "folder") {
    panel = (
      <FolderPanel
        userId={userId}
        category={folder}
        onFolderRename={setFolder}
        onUploaded={handleUploaded}
      />
    );
  } else if (tab === "audio" || tab === "video") {
    panel = (
      <FilesPanel
        kind={tab}
        userId={userId}
        category={folder}
        onUploaded={handleUploaded}
      />
    );
  } else if (tab === "paste") {
    panel = <PastePanel userId={userId} category={folder} onUploaded={handleUploaded} />;
  } else if (tab === "url") {
    panel = <UrlPanel userId={userId} category={folder} onUploaded={handleUploaded} />;
  } else if (tab === "youtube") {
    panel = (
      <YouTubePanel userId={userId} category={folder} onUploaded={handleUploaded} />
    );
  } else {
    panel = <ConnectPanel tab={active} />;
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "var(--scrim)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        animation: "lsw-fadeIn 160ms ease-out",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 780,
          maxWidth: "92vw",
          maxHeight: "86vh",
          background: "var(--panel)",
          borderRadius: 16,
          boxShadow: "0 30px 80px var(--scrim-shadow), 0 0 0 1px var(--line)",
          display: "flex",
          overflow: "hidden",
          animation: "lsw-modalIn 180ms ease-out",
        }}
      >
        {/* Sidebar */}
        <div
          style={{
            width: 220,
            background: "var(--line-2)",
            borderRight: "1px solid var(--line)",
            padding: "18px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            overflowY: "auto",
          }}
        >
          <div
            style={{
              padding: "0 8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 700 }}>Add a source</div>
          </div>
          {ADD_TABS.map((g) => (
            <div key={g.group}>
              <div
                className="mono"
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                  color: "var(--ink-3)",
                  textTransform: "uppercase",
                  padding: "0 8px 6px",
                }}
              >
                {g.group}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {g.items.map((item) => {
                  const isActive = tab === item.id;
                  const Icon = item.Icon as ComponentType<IconProps>;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setTab(item.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "7px 8px",
                        borderRadius: 7,
                        textAlign: "left",
                        fontSize: 13,
                        fontWeight: isActive ? 600 : 500,
                        color: isActive ? "var(--accent-ink)" : "var(--ink-2)",
                        background: isActive ? "var(--accent-soft)" : "transparent",
                      }}
                    >
                      <Icon size={14} />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {/* Panel */}
        <div
          style={{
            flex: 1,
            padding: "22px 26px",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 18,
            }}
          >
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{active.label}</div>
              <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 2 }}>
                {active.desc}
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                color: "var(--ink-3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              title="Close"
            >
              <IconX size={16} />
            </button>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>{panel}</div>

          {/* Save-to strip. Tags picker omitted for now — tags aren't yet
              persisted on ingest, and the design is purely informational. */}
          <div
            style={{
              marginTop: 14,
              paddingTop: 14,
              borderTop: "1px solid var(--line)",
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div
              className="mono"
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.08em",
                color: "var(--ink-3)",
                textTransform: "uppercase",
              }}
            >
              Save to
            </div>
            <FolderPicker
              value={folder}
              onChange={setFolder}
              folders={folders}
              onCreate={onCreateFolder}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Folder picker
// ---------------------------------------------------------------------------

interface FolderPickerProps {
  value: string;
  onChange: (next: string) => void;
  folders: string[];
  onCreate?: (name: string) => void;
}

function FolderPicker({ value, onChange, folders, onCreate }: FolderPickerProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) {
      document.addEventListener("mousedown", onClick);
      return () => document.removeEventListener("mousedown", onClick);
    }
  }, [open]);

  const filtered = folders.filter((f) => f.toLowerCase().includes(q.toLowerCase()));
  const canCreate =
    q.trim().length > 0 &&
    !folders.some((f) => f.toLowerCase() === q.trim().toLowerCase());

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          fontSize: 12,
          padding: "5px 9px",
          borderRadius: 6,
          color: "var(--ink-2)",
          border: "1px solid var(--line)",
          background: "var(--line-2)",
          display: "flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        <IconFolder size={11} />
        {value}
        <IconChevronDown size={10} />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: 0,
            width: 220,
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            boxShadow: "0 -10px 30px var(--scrim-shadow)",
            zIndex: 10,
            overflow: "hidden",
          }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
            placeholder="Find or create folder…"
            style={{
              width: "100%",
              padding: "9px 12px",
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: 12,
              borderBottom: "1px solid var(--line)",
              color: "var(--ink)",
            }}
          />
          <div style={{ maxHeight: 200, overflowY: "auto", padding: "4px 0" }}>
            {filtered.map((f) => (
              <button
                key={f}
                onClick={() => {
                  onChange(f);
                  setOpen(false);
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "6px 12px",
                  fontSize: 12,
                  color: "var(--ink)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--line-2)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <IconFolder size={12} /> {f}
                {value === f && (
                  <span style={{ marginLeft: "auto", color: "var(--accent)" }}>
                    <IconCheck size={12} />
                  </span>
                )}
              </button>
            ))}
            {canCreate && (
              <button
                onClick={() => {
                  onCreate?.(q.trim());
                  onChange(q.trim());
                  setOpen(false);
                  setQ("");
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "6px 12px",
                  fontSize: 12,
                  color: "var(--accent)",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  borderTop: filtered.length > 0 ? "1px solid var(--line)" : "none",
                }}
              >
                <IconPlus size={12} /> Create folder &quot;{q.trim()}&quot;
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Files / Audio / Video panel
// ---------------------------------------------------------------------------

interface FilesPanelProps {
  kind: "files" | "audio" | "video";
  userId: string | null;
  category: string;
  onUploaded: () => void;
}

const FILE_ACCEPT: Record<FilesPanelProps["kind"], string> = {
  files: "",
  audio: "audio/*",
  video: "video/*",
};

const KIND_COPY: Record<
  FilesPanelProps["kind"],
  { title: string; hint: string; browse: string; IconEl: ComponentType<IconProps> }
> = {
  files: {
    title: "Drop files here",
    hint: "PDF, DOCX, XLSX, PPTX, images, code files — up to 500 MB each",
    browse: "Browse files",
    IconEl: SOURCE_META.doc.Icon,
  },
  audio: {
    title: "Drop audio files",
    hint: "MP3, WAV, M4A, FLAC — transcribed automatically",
    browse: "Browse audio",
    IconEl: SOURCE_META.audio.Icon,
  },
  video: {
    title: "Drop video files",
    hint: "MP4, MOV, WEBM — transcribed automatically",
    browse: "Browse video",
    IconEl: SOURCE_META.video.Icon,
  },
};

function FilesPanel({ kind, userId, category, onUploaded }: FilesPanelProps) {
  const [dragging, setDragging] = useState(false);
  const [staged, setStaged] = useState<File[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const copy = KIND_COPY[kind];
  const IconEl = copy.IconEl;

  const addFiles = (incoming: FileList | File[] | null) => {
    if (!incoming) return;
    const arr = Array.from(incoming);
    if (arr.length === 0) return;
    setStaged((prev) => [...prev, ...arr]);
  };

  const removeStaged = (i: number) =>
    setStaged((prev) => prev.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (!userId) {
      toast.error("Sign in to upload files");
      return;
    }
    if (staged.length === 0) return;
    setProgress({ done: 0, total: staged.length });
    try {
      const result = await uploadAndRegisterAll({
        userId,
        files: staged,
        category,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      if (result.successes > 0) {
        toast.success(
          `Uploaded ${result.successes} file${result.successes !== 1 ? "s" : ""} to "${category}"`,
        );
      }
      if (result.errors.length > 0) {
        toast.error(`${result.errors.length} file${result.errors.length !== 1 ? "s" : ""} failed`, {
          description: result.errors.slice(0, 2).join(" · "),
        });
      }
      setStaged([]);
      onUploaded();
    } finally {
      setProgress(null);
    }
  };

  const busy = progress !== null;

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        style={{
          border: `1.5px dashed ${dragging ? "var(--accent)" : "var(--line)"}`,
          background: dragging ? "var(--accent-soft)" : "var(--line-2)",
          borderRadius: 12,
          padding: "40px 24px",
          textAlign: "center",
          transition: "all 140ms",
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: "var(--panel)",
            border: "1px solid var(--line)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--accent)",
            marginBottom: 12,
          }}
        >
          <IconEl size={20} />
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{copy.title}</div>
        <div style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 16 }}>{copy.hint}</div>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          style={{
            background: "var(--accent)",
            color: "white",
            padding: "8px 16px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            opacity: busy ? 0.6 : 1,
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          {copy.browse}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={FILE_ACCEPT[kind] || undefined}
          style={{ display: "none" }}
          onChange={(e) => addFiles(e.target.files)}
        />
      </div>
      {kind === "files" && (
        <div
          style={{
            marginTop: 16,
            padding: "12px 14px",
            background: "var(--line-2)",
            borderRadius: 8,
            fontSize: 12,
            color: "var(--ink-3)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <IconBolt size={14} />
          <span>OCR runs automatically on scanned PDFs and images.</span>
        </div>
      )}

      {staged.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--panel)",
              overflow: "hidden",
            }}
          >
            {staged.map((f, i) => {
              const ext = extOf(f.name);
              return (
                <div
                  key={`${f.name}-${i}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "7px 12px",
                    borderBottom:
                      i < staged.length - 1 ? "1px solid var(--line)" : "none",
                  }}
                >
                  <div
                    className="mono"
                    style={{
                      width: 40,
                      padding: "1px 5px",
                      borderRadius: 3,
                      fontSize: 9,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      color: extColor(ext),
                      background: `color-mix(in oklch, ${extColor(ext)} 12%, transparent)`,
                      textAlign: "center",
                      flexShrink: 0,
                    }}
                  >
                    {ext || "FILE"}
                  </div>
                  <div
                    style={{
                      flex: 1,
                      fontSize: 13,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {f.name}
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                    {formatSize(f.size)}
                  </div>
                  <button
                    onClick={() => removeStaged(i)}
                    disabled={busy}
                    title="Remove"
                    style={{
                      color: "var(--ink-3)",
                      padding: 4,
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    <IconX size={12} />
                  </button>
                </div>
              );
            })}
          </div>
          <div
            style={{
              marginTop: 12,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
              {busy && progress
                ? `Uploading ${progress.done} / ${progress.total}…`
                : `${staged.length} file${staged.length !== 1 ? "s" : ""} ready to upload`}
            </div>
            <button
              onClick={() => {
                void submit();
              }}
              disabled={busy || staged.length === 0}
              style={{
                background: busy ? "var(--line)" : "var(--accent)",
                color: busy ? "var(--ink-3)" : "white",
                padding: "8px 16px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              Upload to &quot;{category}&quot;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Folder panel
// ---------------------------------------------------------------------------

interface FolderPanelProps {
  userId: string | null;
  category: string;
  /** Rename the destination folder in the footer strip so the UX matches the
   *  design's inline folder-name edit. Parent owns the value. */
  onFolderRename: (next: string) => void;
  onUploaded: () => void;
}

interface PickedFolder {
  /** Best-effort root name extracted from webkitRelativePath. */
  rootName: string;
  files: File[];
}

function FolderPanel({ userId, category, onFolderRename, onUploaded }: FolderPanelProps) {
  const [picked, setPicked] = useState<PickedFolder | null>(null);
  const [destName, setDestName] = useState<string>(category);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDestName(category);
  }, [category]);

  const onFolderPicked = (fl: FileList | null) => {
    if (!fl || fl.length === 0) return;
    const files = Array.from(fl).filter((f) => {
      // Skip hidden / system files and anything under a .git/node_modules
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? f.name;
      if (rel.split("/").some((seg) => seg.startsWith(".") || seg === "node_modules")) {
        return false;
      }
      return true;
    });
    const first = files[0];
    const root = first
      ? ((first as File & { webkitRelativePath?: string }).webkitRelativePath ?? first.name)
          .split("/")[0] ?? "Folder"
      : "Folder";
    setPicked({ rootName: root, files });
    setDestName(root);
    onFolderRename(root);
    setExcluded(new Set());
  };

  const toggle = (key: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const included = picked
    ? picked.files.filter((f, i) => !excluded.has(`${i}-${f.name}`))
    : [];

  const submit = async () => {
    if (!userId) {
      toast.error("Sign in to upload files");
      return;
    }
    if (included.length === 0 || !destName.trim()) return;
    setBusy(true);
    setProgress({ done: 0, total: included.length });
    try {
      const result = await uploadAndRegisterAll({
        userId,
        files: included,
        category: destName.trim(),
        onProgress: (done, total) => setProgress({ done, total }),
      });
      if (result.successes > 0) {
        toast.success(
          `Uploaded ${result.successes} file${result.successes !== 1 ? "s" : ""} to "${destName.trim()}"`,
        );
      }
      if (result.errors.length > 0) {
        toast.error(
          `${result.errors.length} file${result.errors.length !== 1 ? "s" : ""} failed`,
          { description: result.errors.slice(0, 2).join(" · ") },
        );
      }
      setPicked(null);
      onUploaded();
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  if (!picked) {
    return (
      <div
        style={{
          border: "1.5px dashed var(--line)",
          background: "var(--line-2)",
          borderRadius: 12,
          padding: "40px 24px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: "var(--panel)",
            border: "1px solid var(--line)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--accent)",
            marginBottom: 12,
          }}
        >
          <IconFolder size={20} />
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Pick a folder</div>
        <div
          style={{
            fontSize: 13,
            color: "var(--ink-3)",
            marginBottom: 16,
            maxWidth: 340,
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          Each file becomes its own source. The folder itself becomes a library folder so they stay grouped.
        </div>
        <button
          onClick={() => inputRef.current?.click()}
          style={{
            background: "var(--accent)",
            color: "white",
            padding: "8px 16px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Choose folder
        </button>
        <input
          ref={inputRef}
          type="file"
          // @ts-expect-error — `webkitdirectory` is a non-standard HTMLInputElement attribute
          webkitdirectory=""
          directory=""
          multiple
          style={{ display: "none" }}
          onChange={(e) => onFolderPicked(e.target.files)}
        />
      </div>
    );
  }

  return (
    <div>
      {/* Breadcrumb header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          background: "var(--line-2)",
          borderRadius: 8,
          marginBottom: 12,
        }}
      >
        <IconFolder size={15} style={{ color: "var(--accent)" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
            {picked.rootName}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>
            {included.length} file{included.length !== 1 ? "s" : ""} will be added
          </div>
        </div>
        <button
          onClick={() => setPicked(null)}
          disabled={busy}
          style={{
            fontSize: 12,
            color: "var(--ink-3)",
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid var(--line)",
          }}
        >
          Change
        </button>
      </div>

      {/* Destination folder name — editable */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div
          className="mono"
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.08em",
            color: "var(--ink-3)",
            textTransform: "uppercase",
          }}
        >
          Create folder
        </div>
        <input
          value={destName}
          onChange={(e) => {
            setDestName(e.target.value);
            onFolderRename(e.target.value);
          }}
          disabled={busy}
          style={{
            flex: 1,
            padding: "7px 10px",
            borderRadius: 6,
            border: "1px solid var(--line)",
            background: "var(--panel)",
            fontSize: 13,
            outline: "none",
          }}
          onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
          onBlur={(e) => (e.target.style.borderColor = "var(--line)")}
        />
      </div>

      {/* File list */}
      <div
        style={{
          border: "1px solid var(--line)",
          borderRadius: 8,
          background: "var(--panel)",
          overflow: "hidden",
          maxHeight: 280,
          overflowY: "auto",
        }}
      >
        {picked.files.map((f, i) => {
          const ext = extOf(f.name);
          const key = `${i}-${f.name}`;
          const included_ = !excluded.has(key);
          return (
            <label
              key={key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "7px 12px",
                borderBottom: i < picked.files.length - 1 ? "1px solid var(--line)" : "none",
                cursor: "pointer",
                opacity: included_ ? 1 : 0.5,
                background: included_ ? "transparent" : "var(--line-2)",
              }}
            >
              <input
                type="checkbox"
                checked={included_}
                onChange={() => toggle(key)}
                disabled={busy}
                style={{ accentColor: "var(--accent)" }}
              />
              <div
                className="mono"
                style={{
                  width: 40,
                  padding: "1px 5px",
                  borderRadius: 3,
                  fontSize: 9,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  color: extColor(ext),
                  background: `color-mix(in oklch, ${extColor(ext)} 12%, transparent)`,
                  textAlign: "center",
                  flexShrink: 0,
                }}
              >
                {ext || "FILE"}
              </div>
              <div
                style={{
                  flex: 1,
                  fontSize: 13,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {(f as File & { webkitRelativePath?: string }).webkitRelativePath ?? f.name}
              </div>
              <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                {formatSize(f.size)}
              </div>
            </label>
          );
        })}
      </div>

      <div
        style={{
          marginTop: 12,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
          {busy && progress
            ? `Uploading ${progress.done} / ${progress.total}…`
            : `Hidden & system files excluded`}
        </div>
        <button
          disabled={busy || included.length === 0 || !destName.trim()}
          onClick={() => {
            void submit();
          }}
          style={{
            background: busy || included.length === 0 ? "var(--line)" : "var(--accent)",
            color: busy || included.length === 0 ? "var(--ink-3)" : "white",
            padding: "8px 16px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: busy || included.length === 0 ? "not-allowed" : "pointer",
          }}
        >
          Add {included.length} file{included.length !== 1 ? "s" : ""} to{" "}
          {destName.trim() || "folder"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paste panel — creates a `.md` File and runs the normal upload flow
// ---------------------------------------------------------------------------

interface TextPanelProps {
  userId: string | null;
  category: string;
  onUploaded: () => void;
}

function PastePanel({ userId, category, onUploaded }: TextPanelProps) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!userId) {
      toast.error("Sign in to save notes");
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) return;
    const safeTitle = title.trim() || "Pasted note";
    const sanitized = safeTitle
      .replace(/[^a-zA-Z0-9\s\-_]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 100);
    const filename = `${sanitized || "note"}.md`;
    const file = new File([trimmed], filename, { type: "text/markdown" });
    setBusy(true);
    try {
      const up = await uploadFileToStorage(file);
      await registerDocument({
        userId,
        file,
        url: up.url,
        objectKey: up.objectKey,
        category,
      });
      toast.success(`"${safeTitle}" added to "${category}"`);
      setTitle("");
      setText("");
      onUploaded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save note");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (optional)"
        disabled={busy}
        style={{
          width: "100%",
          padding: "10px 14px",
          borderRadius: 8,
          border: "1px solid var(--line)",
          background: "var(--panel)",
          fontSize: 14,
          color: "var(--ink)",
          outline: "none",
          marginBottom: 10,
        }}
        onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
        onBlur={(e) => (e.target.style.borderColor = "var(--line)")}
      />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
        placeholder="Paste notes, an email, a transcript, anything…"
        style={{
          width: "100%",
          minHeight: 200,
          padding: 14,
          borderRadius: 10,
          border: "1px solid var(--line)",
          background: "var(--panel)",
          fontSize: 14,
          lineHeight: 1.55,
          resize: "vertical",
          color: "var(--ink)",
          outline: "none",
        }}
        onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
        onBlur={(e) => (e.target.style.borderColor = "var(--line)")}
      />
      <div
        style={{
          marginTop: 12,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
          {text.length.toLocaleString()} chars
        </div>
        <button
          disabled={busy || !text.trim()}
          onClick={() => {
            void submit();
          }}
          style={{
            background: busy || !text.trim() ? "var(--line)" : "var(--accent)",
            color: busy || !text.trim() ? "var(--ink-3)" : "white",
            padding: "8px 16px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: busy || !text.trim() ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "Saving…" : "Add as note"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// URL panel → /api/upload/website
// ---------------------------------------------------------------------------

function UrlPanel({ userId, category, onUploaded }: TextPanelProps) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!userId) {
      toast.error("Sign in to fetch pages");
      return;
    }
    const trimmed = url.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const res = await fetch("/api/upload/website", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, url: trimmed, category }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to index website");
      }
      toast.success(data.message ?? "Website queued for indexing");
      setUrl("");
      onUploaded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to fetch URL");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 10 }}>
        Paste any URL. We&apos;ll crawl the main content and strip the chrome.
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/article"
          disabled={busy}
          style={{
            flex: 1,
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid var(--line)",
            background: "var(--panel)",
            fontSize: 14,
            color: "var(--ink)",
            outline: "none",
          }}
          onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
          onBlur={(e) => (e.target.style.borderColor = "var(--line)")}
        />
        <button
          disabled={busy || !url.trim()}
          onClick={() => {
            void submit();
          }}
          style={{
            background: busy || !url.trim() ? "var(--line)" : "var(--accent)",
            color: busy || !url.trim() ? "var(--ink-3)" : "white",
            padding: "10px 18px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: busy || !url.trim() ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "Fetching…" : "Fetch"}
        </button>
      </div>
      <div
        style={{
          marginTop: 12,
          padding: "10px 14px",
          background: "var(--line-2)",
          borderRadius: 8,
          fontSize: 12,
          color: "var(--ink-3)",
        }}
      >
        Tip: add{" "}
        <span className="mono" style={{ color: "var(--ink-2)" }}>
          /**
        </span>{" "}
        to a URL to recursively crawl a subtree.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// YouTube panel → /api/upload/video-url
// ---------------------------------------------------------------------------

function YouTubePanel({ userId, category, onUploaded }: TextPanelProps) {
  const [videoUrl, setVideoUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!userId) {
      toast.error("Sign in to transcribe videos");
      return;
    }
    const trimmed = videoUrl.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const res = await fetch("/api/upload/video-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          videoUrl: trimmed,
          category,
          title: title.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        details?: string;
        document?: { title?: string };
      };
      if (!res.ok) {
        throw new Error(data.details ?? "Failed to process video");
      }
      toast.success(`Video transcribed: "${data.document?.title ?? "Video"}"`);
      setVideoUrl("");
      setTitle("");
      onUploaded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to process video");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 10 }}>
        Paste a YouTube URL. We&apos;ll pull the transcript and timestamps.
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          placeholder="https://youtube.com/watch?v=…"
          disabled={busy}
          style={{
            flex: 1,
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid var(--line)",
            background: "var(--panel)",
            fontSize: 14,
            color: "var(--ink)",
            outline: "none",
          }}
          onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
          onBlur={(e) => (e.target.style.borderColor = "var(--line)")}
        />
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Custom title (optional)"
        disabled={busy}
        style={{
          width: "100%",
          padding: "10px 14px",
          borderRadius: 8,
          border: "1px solid var(--line)",
          background: "var(--panel)",
          fontSize: 14,
          color: "var(--ink)",
          outline: "none",
          marginBottom: 12,
        }}
        onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
        onBlur={(e) => (e.target.style.borderColor = "var(--line)")}
      />
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          disabled={busy || !videoUrl.trim()}
          onClick={() => {
            void submit();
          }}
          style={{
            background: busy || !videoUrl.trim() ? "var(--line)" : "var(--accent)",
            color: busy || !videoUrl.trim() ? "var(--ink-3)" : "white",
            padding: "10px 18px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: busy || !videoUrl.trim() ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "Transcribing…" : "Transcribe"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connect panel (Gmail/Notion/Drive/Slack/GitHub/Dropbox) — not yet wired
// ---------------------------------------------------------------------------

interface ConnectPanelProps {
  tab: AddSourceTab;
}

const PROVIDER_PERKS: Record<string, string[]> = {
  gmail: ["Select labels or search queries", "Re-syncs every hour", "Attachments included"],
  notion: [
    "Pick workspaces, pages or databases",
    "Updates stream in real-time",
    "Preserves block structure",
  ],
  drive: [
    "Pick folders — kept in sync",
    "Handles Google Docs, Sheets, Slides",
    "Shared drives supported",
  ],
  slack: ["Pick channels + DMs", "Threads stay together", "Files included"],
  github: ["Code, issues, PRs, and READMEs", "Private repos supported", "Updates on each push"],
  dropbox: ["Pick folders — kept in sync", "All file types indexed", "Shared folders supported"],
};

function ConnectPanel({ tab }: ConnectPanelProps) {
  const meta = SOURCE_META[tab.id as keyof typeof SOURCE_META];
  const Icon = (meta?.Icon ?? tab.Icon) as ComponentType<IconProps>;
  const color = meta?.color ?? "var(--accent)";
  const perks = PROVIDER_PERKS[tab.id] ?? [];
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "16px 18px",
          background: "var(--line-2)",
          borderRadius: 12,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: "var(--panel)",
            border: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color,
          }}
        >
          <Icon size={22} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Connect {tab.label}</div>
          <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
            One-click OAuth, revoke anytime.
          </div>
        </div>
      </div>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          marginBottom: 18,
        }}
      >
        {perks.map((p) => (
          <li
            key={p}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 13,
              color: "var(--ink-2)",
            }}
          >
            <span style={{ color: "var(--accent)" }}>
              <IconCheck size={14} />
            </span>
            {p}
          </li>
        ))}
      </ul>
      <button
        disabled
        style={{
          width: "100%",
          padding: 12,
          borderRadius: 10,
          background: "var(--line)",
          color: "var(--ink-3)",
          fontSize: 14,
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          cursor: "not-allowed",
        }}
        title="Coming soon"
      >
        <Icon size={16} /> Connect {tab.label} — coming soon
      </button>
    </div>
  );
}
