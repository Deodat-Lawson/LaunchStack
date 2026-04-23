"use client";

import {
  type ComponentType,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  IconAudio,
  IconBolt,
  IconCheck,
  IconFile,
  IconFolder,
  IconLink,
  IconPaste,
  IconVideo,
  IconX,
  IconYoutube,
  type IconProps,
} from "./icons";
import { ADD_TABS, SOURCE_META, type AddSourceTab } from "./types";

interface ModalBackdropProps {
  onClose: () => void;
  children: ReactNode;
}

function ModalBackdrop({ onClose, children }: ModalBackdropProps) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);
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
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

interface TabPanelFilesProps {
  onOpenFullUploader: () => void;
  kind?: "files" | "folder" | "audio" | "video";
}

function TabPanelUpload({ onOpenFullUploader, kind = "files" }: TabPanelFilesProps) {
  const [dragging, setDragging] = useState(false);
  const Icon = (
    {
      files: IconFile,
      folder: IconFolder,
      audio: IconAudio,
      video: IconVideo,
    } as const
  )[kind];
  const title = {
    files: "Drop files here",
    folder: "Drop a folder",
    audio: "Drop audio files",
    video: "Drop video files",
  }[kind];
  const subtitle = {
    files: "PDF, DOCX, XLSX, PPTX, images, code files — up to 500 MB each",
    folder: "Each file becomes its own source; folder stays as a library folder",
    audio: "MP3, WAV, M4A, FLAC — transcribed automatically",
    video: "MP4, MOV, WEBM — transcribed automatically",
  }[kind];

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
          onOpenFullUploader();
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
          <Icon size={20} />
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 16 }}>
          {subtitle}
        </div>
        <button
          onClick={onOpenFullUploader}
          style={{
            background: "var(--accent)",
            color: "white",
            padding: "8px 16px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Open full uploader
        </button>
      </div>
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
        <span>
          Full uploader handles OCR, category assignment, and large-file chunking.
        </span>
      </div>
    </div>
  );
}

interface ComingSoonProps {
  tabId: string;
  tabLabel: string;
  Icon: ComponentType<IconProps>;
  color?: string;
}

function TabPanelComingSoon({ tabId, tabLabel, Icon, color }: ComingSoonProps) {
  const perks = (
    {
      paste: ["Plain text notes", "Markdown preserved", "Link to citation preview"],
      url: ["Main content extracted", "Strips chrome and ads", "Re-indexed weekly"],
      youtube: ["Transcript pulled", "Chapter markers preserved", "Citations jump to timestamp"],
      gmail: ["Select labels or search queries", "Re-syncs every hour", "Attachments included"],
      notion: ["Pick workspaces, pages, or databases", "Updates stream in real-time", "Block structure preserved"],
      drive: ["Pick folders — kept in sync", "Docs, Sheets, Slides handled", "Shared drives supported"],
      slack: ["Pick channels + DMs", "Threads stay together", "Files included"],
      github: ["Code, issues, PRs, READMEs", "Private repos supported", "Updates on each push"],
      dropbox: ["Pick folders — kept in sync", "All file types indexed", "Shared folders supported"],
    } as Record<string, string[]>
  )[tabId] ?? ["Bring your own source here"];

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
            color: color ?? "var(--accent)",
          }}
        >
          <Icon size={22} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Connect {tabLabel}</div>
          <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
            Coming soon. Use the full uploader for now.
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
          padding: "12px",
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
      >
        Coming soon
      </button>
    </div>
  );
}

interface UrlTabProps {
  kind: "url" | "youtube";
  userId: string | null;
  defaultCategory: string;
  onSubmitted: () => void;
}

function TabPanelUrl({ kind, userId, defaultCategory, onSubmitted }: UrlTabProps) {
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const Icon = kind === "youtube" ? IconYoutube : IconLink;
  const placeholder =
    kind === "youtube"
      ? "https://youtube.com/watch?v=…"
      : "https://example.com/article";
  const description =
    kind === "youtube"
      ? "Paste a YouTube URL. We'll pull the transcript and index it."
      : "Paste any URL. We'll crawl the main content and strip the chrome.";

  const submit = async () => {
    if (!url.trim() || !userId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const endpoint =
        kind === "youtube" ? "/api/upload/video-url" : "/api/upload/website";
      const body =
        kind === "youtube"
          ? {
              userId,
              videoUrl: url.trim(),
              category: defaultCategory,
            }
          : {
              userId,
              url: url.trim(),
              category: defaultCategory,
            };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Failed (${res.status})`);
      }
      setSuccess(true);
      setUrl("");
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch");
    } finally {
      setSubmitting(false);
    }
  };

  const disabled = !url.trim() || submitting || !userId;

  return (
    <div>
      <div style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
        <Icon size={14} /> {description}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={placeholder}
          disabled={submitting}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
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
        />
        <button
          disabled={disabled}
          onClick={() => void submit()}
          style={{
            background: disabled ? "var(--line)" : "var(--accent)",
            color: disabled ? "var(--ink-3)" : "white",
            padding: "10px 18px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          {submitting ? "Fetching…" : "Fetch"}
        </button>
      </div>
      <div style={{ marginTop: 10, fontSize: 12, color: "var(--ink-3)" }}>
        Saves to folder: <span style={{ color: "var(--ink-2)", fontWeight: 500 }}>{defaultCategory}</span>
      </div>
      {error && (
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--danger)" }}>
          {error}
        </div>
      )}
      {success && (
        <div
          style={{
            marginTop: 14,
            padding: "10px 14px",
            borderRadius: 10,
            background: "var(--accent-soft)",
            color: "var(--accent-ink)",
            fontSize: 13,
          }}
        >
          Queued for processing — it&apos;ll appear in your library shortly.
        </div>
      )}
    </div>
  );
}

function TabPanelPaste({ onOpenFullUploader }: { onOpenFullUploader: () => void }) {
  return (
    <div>
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
          <IconPaste size={20} />
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Paste text</div>
        <div style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 16, maxWidth: 340, margin: "0 auto 16px" }}>
          Drop in notes, an email, a transcript, anything. Full editor lives in the uploader.
        </div>
        <button
          onClick={onOpenFullUploader}
          style={{
            background: "var(--accent)",
            color: "white",
            padding: "8px 16px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Open full uploader
        </button>
      </div>
    </div>
  );
}

export interface AddSourceModalProps {
  open: boolean;
  onClose: () => void;
  onOpenFullUploader: () => void;
  userId: string | null;
  defaultCategory: string;
}

export function AddSourceModal({
  open,
  onClose,
  onOpenFullUploader,
  userId,
  defaultCategory,
}: AddSourceModalProps) {
  const router = useRouter();
  const [tab, setTab] = useState<string>("files");
  if (!open) return null;

  const allTabs: AddSourceTab[] = ADD_TABS.flatMap((g) => g.items);
  const active = allTabs.find((t) => t.id === tab) ?? allTabs[0]!;

  const openFull = () => {
    onOpenFullUploader();
    onClose();
    router.push("/employer/documents?view=upload");
  };

  const handleUrlSubmitted = () => {
    onOpenFullUploader();
  };

  const isUpload = ["files", "folder", "audio", "video"].includes(tab);
  const isUrl = tab === "url" || tab === "youtube";
  let panel: ReactNode;
  if (isUpload) {
    panel = (
      <TabPanelUpload
        kind={tab as "files" | "folder" | "audio" | "video"}
        onOpenFullUploader={openFull}
      />
    );
  } else if (isUrl) {
    panel = (
      <TabPanelUrl
        kind={tab as "url" | "youtube"}
        userId={userId}
        defaultCategory={defaultCategory}
        onSubmitted={handleUrlSubmitted}
      />
    );
  } else if (tab === "paste") {
    panel = <TabPanelPaste onOpenFullUploader={openFull} />;
  } else {
    const meta = SOURCE_META[tab as keyof typeof SOURCE_META];
    panel = (
      <TabPanelComingSoon
        tabId={tab}
        tabLabel={active.label}
        Icon={active.Icon}
        color={meta?.color}
      />
    );
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <div
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
                  const Icon = item.Icon;
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
            >
              <IconX size={16} />
            </button>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>{panel}</div>
        </div>
      </div>
    </ModalBackdrop>
  );
}
