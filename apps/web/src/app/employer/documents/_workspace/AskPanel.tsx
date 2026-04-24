"use client";

import React, {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTheme } from "next-themes";
import {
  IconArrowUp,
  IconBolt,
  IconBrain,
  IconCheck,
  IconChevronDown,
  IconGlobe,
  IconGraph,
  IconImage,
  IconLogout,
  IconMoon,
  IconPaperclip,
  IconPlus,
  IconSearch,
  IconSettings,
  IconShield,
  IconSparkle,
  IconSun,
  IconUser,
  IconX,
} from "./icons";
import { GraphView } from "./GraphView";
import {
  COMPOSER_MODELS,
  DEFAULT_COMPOSER_MODEL,
  DEMOTED_FEATURES,
  SOURCE_META,
  findComposerModel,
  type ComposerModelOption,
  type ComposerSend,
  type DemotedFeature,
  type EphemeralAttachment,
  type ThreadMessage,
  type WorkspaceSource,
} from "./types";

interface SourceChipProps {
  source: WorkspaceSource;
  onRemove?: () => void;
  size?: "sm" | "md";
}

export function SourceChip({ source, onRemove, size = "md" }: SourceChipProps) {
  const meta = SOURCE_META[source.type] ?? SOURCE_META.doc;
  const Icon = meta.Icon;
  const small = size === "sm";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: small ? "2px 8px" : "4px 10px",
        background: "var(--accent-soft)",
        border: "1px solid transparent",
        borderRadius: 999,
        fontSize: small ? 11 : 12,
        fontWeight: 500,
        color: "var(--accent-ink)",
        maxWidth: 260,
      }}
    >
      <span style={{ color: meta.color, flexShrink: 0 }}>
        <Icon size={small ? 11 : 12} />
      </span>
      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {source.title}
      </span>
      {onRemove && (
        <button
          onClick={onRemove}
          style={{ color: "var(--ink-3)", display: "flex", alignItems: "center" }}
        >
          <IconX size={10} />
        </button>
      )}
    </span>
  );
}

function renderInline(line: string) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <strong key={i} style={{ fontWeight: 700, color: "var(--ink)" }}>
        {p.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

function renderText(txt: string) {
  const lines = txt.split("\n");
  return lines.map((line, i) => {
    if (line.startsWith("> ")) {
      return (
        <div
          key={i}
          style={{
            borderLeft: "3px solid var(--accent)",
            paddingLeft: 12,
            margin: "8px 0",
            fontStyle: "italic",
            color: "var(--ink)",
            fontSize: 16,
          }}
        >
          {renderInline(line.slice(2))}
        </div>
      );
    }
    if (!line.trim()) return <div key={i} style={{ height: 8 }} />;
    return (
      <div key={i} style={{ marginBottom: 4 }}>
        {renderInline(line)}
      </div>
    );
  });
}

interface MessageProps {
  msg: ThreadMessage;
  sources: WorkspaceSource[];
}

function Message({ msg, sources }: MessageProps) {
  const isUser = msg.role === "user";
  const refs = (msg.refs ?? [])
    .map((id) => sources.find((s) => s.id === id))
    .filter((s): s is WorkspaceSource => Boolean(s));
  const cites = msg.citations ?? [];

  if (isUser) {
    return (
      <div style={{ animation: "lsw-fadeIn 200ms ease-out", marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: "var(--ink)",
              color: "var(--panel)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <IconUser size={12} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 600 }}>You</span>
          {refs.length > 0 && (
            <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>
              · asking over {refs.length} source{refs.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div
          className="serif"
          style={{ fontSize: 17, lineHeight: 1.55, color: "var(--ink)", fontWeight: 400 }}
        >
          {msg.text}
        </div>
        {refs.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
            {refs.map((s) => (
              <SourceChip key={s.id} source={s} size="sm" />
            ))}
          </div>
        )}
        {msg.attachments && msg.attachments.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            {msg.attachments.map((a) => (
              <AttachmentChip key={a.id} attachment={a} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ animation: "lsw-fadeIn 240ms ease-out", marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: "var(--accent-soft)",
            color: "var(--accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <IconBolt size={12} />
        </div>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Launchstack</span>
        {msg.model && (
          <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>
            · {msg.model}
          </span>
        )}
        {msg.gapCheck && (
          <span
            title={`Predictive gap analysis ran across ${msg.gapCheck.domain} docs`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              marginLeft: 4,
              fontSize: 10,
              fontWeight: 600,
              padding: "2px 7px",
              borderRadius: 999,
              color: "oklch(0.5 0.16 40)",
              background: "oklch(0.95 0.06 70)",
              border: "1px solid oklch(0.86 0.11 75)",
            }}
          >
            <IconShield size={9} />
            {msg.gapCheck.missing} missing · {msg.gapCheck.conflicts} conflict
          </span>
        )}
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.65, color: "var(--ink-2)" }}>
        {renderText(msg.text)}
      </div>
      {cites.length > 0 && (
        <div
          style={{
            marginTop: 14,
            padding: "12px 14px",
            borderRadius: 10,
            background: "var(--line-2)",
            border: "1px solid var(--line)",
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
              marginBottom: 8,
            }}
          >
            Grounded in {cites.length} source{cites.length !== 1 ? "s" : ""}
          </div>
          {cites.map((c, i) => {
            const s = sources.find((x) => x.id === c.sourceId);
            if (!s) return null;
            const meta = SOURCE_META[s.type];
            const Icon = meta.Icon;
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 10,
                  padding: "8px 0",
                  borderTop: i > 0 ? "1px solid var(--line)" : "none",
                }}
              >
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 5,
                    background: "var(--panel)",
                    border: "1px solid var(--line)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: meta.color,
                    flexShrink: 0,
                    marginTop: 1,
                  }}
                >
                  <Icon size={12} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>
                    {s.title}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--ink-3)",
                      marginTop: 2,
                      lineHeight: 1.5,
                    }}
                  >
                    {c.snippet}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {typeof msg.tokens === "number" && (
        <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
          <span style={{ marginLeft: "auto" }} className="mono">
            <span style={{ fontSize: 10, color: "var(--ink-3)" }}>{msg.tokens} tokens</span>
          </span>
        </div>
      )}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: "var(--accent-soft)",
          color: "var(--accent)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <IconBolt size={12} />
      </div>
      <div style={{ display: "flex", gap: 3 }}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--accent)",
              animation: `lsw-shimmer 1s ease-in-out ${i * 0.15}s infinite`,
            }}
          />
        ))}
      </div>
      <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Searching your sources…</span>
    </div>
  );
}

interface ComposerProps {
  sources: WorkspaceSource[];
  selected: string[];
  setSelected: Dispatch<SetStateAction<string[]>>;
  onSend: (send: ComposerSend) => void;
  disabled?: boolean;
  model: ComposerModelOption;
  onPickModel: (model: ComposerModelOption) => void;
  webSearch: boolean;
  onToggleWebSearch: () => void;
  thinking: boolean;
  onToggleThinking: () => void;
}

const ATTACH_IMAGE_MIME = /^image\//;
const ATTACH_MAX_COUNT = 5;
const ATTACH_MAX_BYTES = 20 * 1024 * 1024;

// Mime + extension whitelist for ephemeral attachments. Anything here the
// backend can extract text from (or send as a vision block). Media files
// (audio/video) are intentionally excluded — those belong in Sources where
// the transcription pipeline runs; ephemeral is for "look at this one thing
// for this turn" docs and images.
const ATTACH_TEXT_MIMES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/json",
  "application/xml",
  "application/x-ndjson",
  "application/yaml",
  "application/x-yaml",
  "application/rtf",
]);
const ATTACH_TEXT_EXTS = new Set([
  "pdf",
  "doc",
  "docx",
  "txt",
  "md",
  "markdown",
  "csv",
  "tsv",
  "json",
  "jsonl",
  "xml",
  "yaml",
  "yml",
  "rtf",
  "log",
  "html",
  "htm",
]);

function extOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : "";
}

function kindForFile(file: File): "image" | "text" | null {
  if (ATTACH_IMAGE_MIME.test(file.type)) return "image";
  if (file.type.startsWith("text/")) return "text";
  if (ATTACH_TEXT_MIMES.has(file.type)) return "text";
  if (ATTACH_TEXT_EXTS.has(extOf(file.name))) return "text";
  return null;
}

function Composer({
  sources,
  selected,
  setSelected,
  onSend,
  disabled,
  model,
  onPickModel,
  webSearch,
  onToggleWebSearch,
  thinking,
  onToggleThinking,
}: ComposerProps) {
  const [text, setText] = useState("");
  const [focus, setFocus] = useState(false);
  const [attachments, setAttachments] = useState<EphemeralAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);

  const selSources = selected
    .map((id) => sources.find((s) => s.id === id))
    .filter((s): s is WorkspaceSource => Boolean(s));

  const thinkingAllowed = model.supportsThinking;
  const visionAllowed = model.supportsVision;

  const hasImageAttachment = attachments.some((a) => a.kind === "image");
  const imageBlockedReason =
    hasImageAttachment && !visionAllowed
      ? `${model.label} can't read images — switch to a vision-capable model or remove the image.`
      : null;

  const handleSend = () => {
    if (!text.trim() || disabled || uploading) return;
    if (imageBlockedReason) {
      setAttachError(imageBlockedReason);
      return;
    }
    onSend({
      text: text.trim(),
      refs: selected,
      attachments,
      webSearch,
      thinking: thinking && thinkingAllowed,
      model: model.id,
      provider: model.provider,
    });
    setText("");
    setAttachments([]);
    setAttachError(null);
  };

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = Math.min(ref.current.scrollHeight, 200) + "px";
    }
  }, [text]);

  useEffect(() => {
    const onClick = (e: globalThis.MouseEvent) => {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) {
        setModelOpen(false);
      }
    };
    if (modelOpen) {
      document.addEventListener("mousedown", onClick);
      return () => document.removeEventListener("mousedown", onClick);
    }
  }, [modelOpen]);

  const handleFilesPicked = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    if (attachments.length + files.length > ATTACH_MAX_COUNT) {
      setAttachError(`You can attach up to ${ATTACH_MAX_COUNT} files per message.`);
      return;
    }

    setUploading(true);
    setAttachError(null);
    const next: EphemeralAttachment[] = [];
    try {
      for (const file of Array.from(files)) {
        if (file.size > ATTACH_MAX_BYTES) {
          setAttachError(`"${file.name}" is too large (max 20MB per file).`);
          continue;
        }
        const kind = kindForFile(file);
        if (!kind) {
          setAttachError(
            `"${file.name}" isn't a supported attachment type. Use PDFs, DOCX, images, or text files — audio/video belong in Sources.`,
          );
          continue;
        }
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/storage/upload", { method: "POST", body: form });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setAttachError(body.error ?? `Upload failed for "${file.name}"`);
          continue;
        }
        const data = (await res.json()) as { url: string; objectKey: string };
        next.push({
          id: data.objectKey || `${Date.now()}-${file.name}`,
          name: file.name,
          mimeType: file.type,
          size: file.size,
          url: data.url,
          kind,
        });
      }
      if (next.length > 0) {
        setAttachments((prev) => [...prev, ...next]);
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [attachments.length]);

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
    setAttachError(null);
  };

  return (
    <div
      style={{
        margin: "0 auto",
        maxWidth: 760,
        width: "100%",
        padding: 14,
        borderRadius: 14,
        background: "var(--panel)",
        border: `1px solid ${focus ? "var(--accent)" : "var(--line)"}`,
        boxShadow: focus
          ? "0 0 0 4px oklch(0.56 0.19 var(--accent-h) / 0.1)"
          : "0 2px 8px var(--scrim-shadow)",
        transition: "border-color 140ms, box-shadow 140ms",
      }}
    >
      {selSources.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            marginBottom: 10,
            paddingBottom: 10,
            borderBottom: "1px dashed var(--line)",
          }}
        >
          <span
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--ink-3)",
              alignSelf: "center",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 600,
            }}
          >
            Context
          </span>
          {selSources.map((s) => (
            <SourceChip
              key={s.id}
              source={s}
              size="sm"
              onRemove={() => setSelected(selected.filter((x) => x !== s.id))}
            />
          ))}
        </div>
      )}
      {attachments.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            marginBottom: 10,
            paddingBottom: 10,
            borderBottom: "1px dashed var(--line)",
          }}
        >
          <span
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--ink-3)",
              alignSelf: "center",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 600,
            }}
          >
            Attached
          </span>
          {attachments.map((a) => (
            <AttachmentChip key={a.id} attachment={a} onRemove={() => removeAttachment(a.id)} />
          ))}
        </div>
      )}
      {(imageBlockedReason ?? attachError) && (
        <div
          style={{
            fontSize: 11,
            color: "oklch(0.55 0.18 25)",
            marginBottom: 8,
          }}
        >
          {imageBlockedReason ?? attachError}
        </div>
      )}
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
        placeholder={
          selSources.length > 0
            ? `Ask anything about ${selSources.length === 1 ? "this source" : `these ${selSources.length} sources`}…`
            : "Ask anything. Pick sources on the left, or just type."
        }
        style={{
          width: "100%",
          border: "none",
          outline: "none",
          background: "transparent",
          resize: "none",
          fontSize: 15,
          lineHeight: 1.5,
          color: "var(--ink)",
          fontFamily: "inherit",
          minHeight: 44,
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/*,.pdf,.doc,.docx,.txt,.md,.markdown,.csv,.tsv,.json,.jsonl,.xml,.yaml,.yml,.rtf,.log,.html,.htm"
        style={{ display: "none" }}
        onChange={(e) => void handleFilesPicked(e.target.files)}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
        <ToolbarPill
          label="Attach"
          title={`Attach up to ${ATTACH_MAX_COUNT} files to this message only (PDFs, DOCX, images, text)`}
          icon={<IconPaperclip size={12} />}
          active={attachments.length > 0}
          disabled={uploading || disabled}
          onClick={() => fileInputRef.current?.click()}
          badge={
            uploading
              ? "…"
              : attachments.length > 0
              ? String(attachments.length)
              : undefined
          }
        />
        <ToolbarPill
          label="Web"
          title="Search the web in addition to your sources"
          icon={<IconGlobe size={12} />}
          active={webSearch}
          onClick={onToggleWebSearch}
        />
        <ToolbarPill
          label="Think"
          title={
            thinkingAllowed
              ? "Let the model reason step-by-step before answering"
              : `${model.label} doesn't support extended thinking — pick a reasoning model (Claude, GPT-5, Gemini 3).`
          }
          icon={<IconBrain size={12} />}
          active={thinking && thinkingAllowed}
          disabled={!thinkingAllowed}
          onClick={onToggleThinking}
        />
        <div ref={modelRef} style={{ position: "relative" }}>
          <button
            onClick={() => setModelOpen((v) => !v)}
            style={{
              fontSize: 12,
              padding: "6px 10px",
              borderRadius: 8,
              color: "var(--ink-2)",
              border: "1px solid var(--line)",
              background: modelOpen ? "var(--line-2)" : "transparent",
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <IconSparkle size={12} />
            {model.label}
            <IconChevronDown size={10} />
          </button>
          {modelOpen && (
            <ModelDropdown
              current={model}
              onPick={(m) => {
                onPickModel(m);
                setModelOpen(false);
              }}
            />
          )}
        </div>
        <div style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>
          <kbd
            style={{
              padding: "1.5px 5px",
              border: "1px solid var(--line)",
              borderRadius: 4,
            }}
          >
            ⏎
          </kbd>{" "}
          to send
        </span>
        <button
          onClick={handleSend}
          disabled={!text.trim() || disabled || uploading}
          style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            background:
              text.trim() && !disabled && !uploading
                ? "var(--accent)"
                : "var(--line)",
            color:
              text.trim() && !disabled && !uploading
                ? "white"
                : "var(--ink-3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor:
              text.trim() && !disabled && !uploading ? "pointer" : "not-allowed",
          }}
        >
          <IconArrowUp size={15} />
        </button>
      </div>
    </div>
  );
}

interface ToolbarPillProps {
  label: string;
  title: string;
  icon: React.ReactNode;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  badge?: string;
}

function ToolbarPill({ label, title, icon, active, disabled, onClick, badge }: ToolbarPillProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        fontSize: 12,
        padding: "6px 10px",
        borderRadius: 8,
        color: active ? "white" : "var(--ink-2)",
        background: active ? "var(--accent)" : "transparent",
        border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
        display: "flex",
        alignItems: "center",
        gap: 5,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 120ms, border-color 120ms, color 120ms",
      }}
    >
      {icon}
      {label}
      {badge && (
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: "0 5px",
            borderRadius: 999,
            background: active ? "rgba(255,255,255,0.25)" : "var(--line-2)",
            color: active ? "white" : "var(--ink-3)",
            minWidth: 14,
            textAlign: "center",
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

interface ModelDropdownProps {
  current: ComposerModelOption;
  onPick: (m: ComposerModelOption) => void;
}

function ModelDropdown({ current, onPick }: ModelDropdownProps) {
  const groups = (["openai", "anthropic", "google", "ollama"] as const).map((p) => ({
    provider: p,
    label: p === "openai" ? "OpenAI" : p === "anthropic" ? "Anthropic" : p === "google" ? "Google" : "Local (Ollama)",
    models: COMPOSER_MODELS.filter((m) => m.provider === p),
  }));

  return (
    <div
      style={{
        position: "absolute",
        bottom: "calc(100% + 8px)",
        left: 0,
        width: 280,
        maxHeight: 360,
        overflowY: "auto",
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        boxShadow: "0 16px 40px var(--scrim-shadow)",
        padding: 6,
        zIndex: 50,
        animation: "lsw-fadeIn 120ms",
      }}
    >
      {groups.map((g) => (
        <div key={g.provider} style={{ marginBottom: 6 }}>
          <div
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--ink-3)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 600,
              padding: "6px 10px 4px",
            }}
          >
            {g.label}
          </div>
          {g.models.map((m) => {
            const active = m.id === current.id;
            return (
              <button
                key={m.id}
                onClick={() => onPick(m)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 10px",
                  borderRadius: 7,
                  fontSize: 13,
                  color: active ? "var(--accent-ink)" : "var(--ink-2)",
                  background: active ? "var(--accent-soft)" : "transparent",
                  textAlign: "left",
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = "var(--line-2)";
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = "transparent";
                }}
              >
                <span style={{ flex: 1 }}>{m.label}</span>
                {m.supportsThinking && (
                  <span
                    className="mono"
                    style={{
                      fontSize: 9,
                      padding: "1px 5px",
                      borderRadius: 4,
                      background: "var(--line-2)",
                      color: "var(--ink-3)",
                      fontWeight: 600,
                    }}
                    title="Supports extended thinking"
                  >
                    THINK
                  </span>
                )}
                {m.supportsVision && (
                  <span
                    className="mono"
                    style={{
                      fontSize: 9,
                      padding: "1px 5px",
                      borderRadius: 4,
                      background: "var(--line-2)",
                      color: "var(--ink-3)",
                      fontWeight: 600,
                    }}
                    title="Can read images"
                  >
                    IMG
                  </span>
                )}
                {active && <IconCheck size={12} />}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

interface AttachmentChipProps {
  attachment: EphemeralAttachment;
  onRemove?: () => void;
}

function AttachmentChip({ attachment, onRemove }: AttachmentChipProps) {
  const isImage = attachment.kind === "image";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 8px 2px 4px",
        background: "var(--line-2)",
        border: "1px dashed var(--line)",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 500,
        color: "var(--ink-2)",
        maxWidth: 260,
      }}
    >
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={attachment.url}
          alt={attachment.name}
          style={{ width: 18, height: 18, borderRadius: 4, objectFit: "cover" }}
        />
      ) : (
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: 4,
            background: "var(--panel)",
            border: "1px solid var(--line)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--ink-3)",
          }}
        >
          <IconImage size={10} />
        </span>
      )}
      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {attachment.name}
      </span>
      {onRemove && (
        <button
          onClick={onRemove}
          style={{ color: "var(--ink-3)", display: "flex", alignItems: "center" }}
          title="Remove attachment"
        >
          <IconX size={10} />
        </button>
      )}
    </span>
  );
}

interface EmptyStateProps {
  onOpenAdd: () => void;
  sourceCount: number;
}

function EmptyState({ onOpenAdd, sourceCount }: EmptyStateProps) {
  const starters = [
    { q: "Summarize my customer interviews", hint: "across all recordings" },
    { q: "What did I promise investors?", hint: "from Gmail + pitch deck" },
    { q: "Find every mention of pricing", hint: "in my notes and docs" },
    { q: "Where's the auth code in my repo?", hint: "from GitHub" },
  ];
  return (
    <div style={{ paddingTop: 40, animation: "lsw-fadeIn 300ms" }}>
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div
          className="serif"
          style={{
            fontSize: 42,
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
            marginBottom: 10,
          }}
        >
          What do you want to <em style={{ color: "var(--accent)" }}>ask</em> yourself?
        </div>
        <div style={{ fontSize: 14, color: "var(--ink-3)" }}>
          {sourceCount} source{sourceCount !== 1 ? "s" : ""} indexed · ready to query
        </div>
      </div>
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 24 }}
      >
        {starters.map((s, i) => (
          <button
            key={i}
            style={{
              textAlign: "left",
              padding: "12px 14px",
              borderRadius: 10,
              background: "var(--panel)",
              border: "1px solid var(--line)",
              transition: "border-color 120ms",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--accent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--line)";
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{s.q}</div>
            <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 3 }}>{s.hint}</div>
          </button>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          padding: "14px 18px",
          borderRadius: 12,
          background: "var(--line-2)",
          border: "1px dashed var(--line)",
          fontSize: 13,
          color: "var(--ink-3)",
        }}
      >
        <span>Need something new?</span>
        <button
          onClick={onOpenAdd}
          style={{
            color: "var(--accent)",
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <IconPlus size={12} /> Add a source
        </button>
      </div>
    </div>
  );
}

interface AvatarMenuProps {
  features: readonly DemotedFeature[];
  userInitials: string;
  userName?: string;
  userEmail?: string;
  onPick: (href: string) => void;
  onSignOut?: () => void;
}

function AvatarMenu({
  features,
  userInitials,
  userName,
  userEmail,
  onPick,
  onSignOut,
}: AvatarMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  useEffect(() => {
    const onClick = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          background:
            "linear-gradient(135deg, oklch(0.7 0.12 282), oklch(0.55 0.18 260))",
          color: "white",
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        {userInitials}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: 240,
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 12,
            boxShadow: "0 16px 40px var(--scrim-shadow)",
            padding: 6,
            zIndex: 50,
            animation: "lsw-fadeIn 120ms",
          }}
        >
          <div
            style={{
              padding: "10px 10px 10px",
              borderBottom: "1px solid var(--line)",
              marginBottom: 6,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>{userName ?? "Your account"}</div>
            {userEmail && (
              <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{userEmail}</div>
            )}
          </div>
          {features.map((f) => {
            const Icon = f.Icon;
            return (
              <button
                key={f.id}
                onClick={() => {
                  setOpen(false);
                  onPick(f.href);
                }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "7px 10px",
                  borderRadius: 7,
                  fontSize: 13,
                  color: "var(--ink-2)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--line-2)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <Icon size={14} />
                <span style={{ flex: 1, textAlign: "left" }}>{f.label}</span>
                {f.kbd && (
                  <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>
                    {f.kbd}
                  </span>
                )}
              </button>
            );
          })}
          <div style={{ borderTop: "1px solid var(--line)", marginTop: 6, paddingTop: 6 }}>
            <button
              onClick={() => setTheme(isDark ? "light" : "dark")}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "7px 10px",
                borderRadius: 7,
                fontSize: 13,
                color: "var(--ink-2)",
              }}
            >
              {isDark ? <IconSun size={14} /> : <IconMoon size={14} />}
              <span style={{ flex: 1, textAlign: "left" }}>
                {isDark ? "Light" : "Dark"} theme
              </span>
            </button>
            <button
              onClick={() => {
                setOpen(false);
                onPick("/employer/settings");
              }}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "7px 10px",
                borderRadius: 7,
                fontSize: 13,
                color: "var(--ink-2)",
              }}
            >
              <IconSettings size={14} />
              <span style={{ flex: 1, textAlign: "left" }}>Settings</span>
            </button>
            {onSignOut && (
              <button
                onClick={() => {
                  setOpen(false);
                  onSignOut();
                }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "7px 10px",
                  borderRadius: 7,
                  fontSize: 13,
                  color: "var(--ink-2)",
                }}
              >
                <IconLogout size={14} />
                <span style={{ flex: 1, textAlign: "left" }}>Sign out</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export interface AskPanelProps {
  sources: WorkspaceSource[];
  selected: string[];
  setSelected: Dispatch<SetStateAction<string[]>>;
  thread: ThreadMessage[];
  sendMessage: (send: ComposerSend) => void;
  isSending: boolean;
  onOpenAdd: () => void;
  onNewChat: () => void;
  openPalette: () => void;
  onStudioNavigate: (href: string) => void;
  userInitials: string;
  userName?: string;
  userEmail?: string;
  onSignOut?: () => void;
  /** Composer options persisted across turns — owned by WorkspaceShell. */
  model: ComposerModelOption;
  onPickModel: (model: ComposerModelOption) => void;
  webSearch: boolean;
  onToggleWebSearch: () => void;
  thinking: boolean;
  onToggleThinking: () => void;
  /** Right-side custom slot, e.g. the Studio hover-menu button. */
  studioSlot?: React.ReactNode;
}

type WorkspaceView = "chat" | "graph";

export function AskPanel({
  sources,
  selected,
  setSelected,
  thread,
  sendMessage,
  isSending,
  onOpenAdd,
  onNewChat,
  openPalette,
  onStudioNavigate,
  userInitials,
  userName,
  userEmail,
  onSignOut,
  model,
  onPickModel,
  webSearch,
  onToggleWebSearch,
  thinking,
  onToggleThinking,
  studioSlot,
}: AskPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<WorkspaceView>("chat");

  useEffect(() => {
    if (view === "chat" && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thread, isSending, view]);

  const isEmpty = thread.length === 0;
  const latestRole = thread.at(-1)?.role;
  const showTyping = isSending && latestRole === "user";

  const titleText =
    view === "graph"
      ? "Knowledge graph"
      : isEmpty
      ? "New conversation"
      : "Ask over your sources";
  const subText =
    view === "graph"
      ? `${sources.length} sources · ${selected.length} pinned`
      : isEmpty
      ? "Pick sources on the left, then ask."
      : `${thread.length} message${thread.length !== 1 ? "s" : ""} · updated just now`;

  const handleSend = useCallback(
    (send: ComposerSend) => sendMessage(send),
    [sendMessage],
  );

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
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{titleText}</div>
          <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{subText}</div>
        </div>

        <div
          style={{
            display: "flex",
            background: "var(--line-2)",
            borderRadius: 7,
            padding: 2,
          }}
        >
          <button
            onClick={() => setView("chat")}
            title="Chat"
            style={{
              padding: "4px 10px",
              borderRadius: 5,
              fontSize: 12,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 5,
              background: view === "chat" ? "var(--panel)" : "transparent",
              color: view === "chat" ? "var(--ink)" : "var(--ink-3)",
              boxShadow:
                view === "chat" ? "0 1px 2px var(--scrim-shadow)" : "none",
            }}
          >
            <IconBolt size={11} />
            Chat
          </button>
          <button
            onClick={() => setView("graph")}
            title="Knowledge graph"
            style={{
              padding: "4px 10px",
              borderRadius: 5,
              fontSize: 12,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 5,
              background: view === "graph" ? "var(--panel)" : "transparent",
              color: view === "graph" ? "var(--ink)" : "var(--ink-3)",
              boxShadow:
                view === "graph" ? "0 1px 2px var(--scrim-shadow)" : "none",
            }}
          >
            <IconGraph size={11} />
            Graph
          </button>
        </div>

        <button
          onClick={onNewChat}
          title="New chat"
          disabled={isEmpty || view !== "chat"}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 10px",
            borderRadius: 7,
            border: "1px solid var(--line)",
            background: "var(--panel)",
            fontSize: 12,
            fontWeight: 500,
            color: isEmpty ? "var(--ink-4)" : "var(--ink-2)",
            cursor: isEmpty ? "not-allowed" : "pointer",
            opacity: isEmpty ? 0.6 : 1,
          }}
          onMouseEnter={(e) => {
            if (!isEmpty) {
              e.currentTarget.style.borderColor = "var(--accent)";
              e.currentTarget.style.color = "var(--accent)";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--line)";
            e.currentTarget.style.color = "var(--ink-2)";
          }}
        >
          <IconPlus size={12} />
          New chat
        </button>

        <button
          onClick={openPalette}
          title="Jump to anything  ⌘K"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 9px",
            borderRadius: 7,
            border: "1px solid var(--line)",
            background: "var(--line-2)",
            fontSize: 12,
            color: "var(--ink-3)",
          }}
        >
          <IconSearch size={12} />
          <span
            className="mono"
            style={{
              fontSize: 10,
              padding: "1px 5px",
              border: "1px solid var(--line)",
              borderRadius: 4,
              background: "var(--panel)",
            }}
          >
            ⌘K
          </span>
        </button>
        {studioSlot}
        <AvatarMenu
          features={DEMOTED_FEATURES}
          userInitials={userInitials}
          userName={userName}
          userEmail={userEmail}
          onPick={onStudioNavigate}
          onSignOut={onSignOut}
        />
      </div>

      {view === "graph" ? (
        <div style={{ flex: 1, overflow: "hidden", background: "var(--bg)" }}>
          <GraphView />
        </div>
      ) : (
        <>
          <div
            ref={scrollRef}
            style={{ flex: 1, overflowY: "auto", padding: "28px 24px 20px" }}
          >
            <div style={{ maxWidth: 760, margin: "0 auto" }}>
              {isEmpty ? (
                <EmptyState onOpenAdd={onOpenAdd} sourceCount={sources.length} />
              ) : (
                <>
                  {thread.map((m, i) => (
                    <Message key={i} msg={m} sources={sources} />
                  ))}
                  {showTyping && <TypingIndicator />}
                </>
              )}
            </div>
          </div>

          <div style={{ padding: "12px 24px 20px", flexShrink: 0 }}>
            <Composer
              sources={sources}
              selected={selected}
              setSelected={setSelected}
              onSend={handleSend}
              disabled={isSending}
              model={model}
              onPickModel={onPickModel}
              webSearch={webSearch}
              onToggleWebSearch={onToggleWebSearch}
              thinking={thinking}
              onToggleThinking={onToggleThinking}
            />
            <div
              style={{
                maxWidth: 760,
                margin: "8px auto 0",
                textAlign: "center",
                fontSize: 11,
                color: "var(--ink-3)",
              }}
            >
              Grounded answers only — cites every source it uses.
            </div>
          </div>
        </>
      )}
    </main>
  );
}
