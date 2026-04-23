"use client";

import React, { useState } from "react";
import { Globe, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface WebsiteSourceTabProps {
  categories: { id: string; name: string }[];
  defaultCategory?: string;
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--ink-2)",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 9,
  border: "1px solid var(--line)",
  background: "var(--panel)",
  fontSize: 14,
  color: "var(--ink)",
  outline: "none",
  fontFamily: "inherit",
};

export function WebsiteSourceTab({
  categories: _categories,
  defaultCategory,
}: WebsiteSourceTabProps) {
  const { userId } = useAuth();
  const router = useRouter();

  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [category] = useState(defaultCategory ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const [crawlEnabled, setCrawlEnabled] = useState(false);
  const [maxDepth, setMaxDepth] = useState(2);
  const [maxPages, setMaxPages] = useState(20);
  const [jsRender, setJsRender] = useState(false);

  const isValidHttpUrl = (value: string) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  };

  const handleSubmit = async () => {
    if (!userId || !url.trim()) return;
    if (!isValidHttpUrl(url)) {
      toast.error("Please enter a valid http(s) URL");
      return;
    }

    setIsSubmitting(true);
    setStatus("idle");
    setErrorMessage("");

    try {
      const response = await fetch("/api/upload/website", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          url: url.trim(),
          title: title.trim() || undefined,
          category: category || undefined,
          ...(crawlEnabled && { crawl: true, maxDepth, maxPages }),
          ...(jsRender && { jsRender: true }),
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        message?: string;
        jobId?: string;
        pages?: { url: string; title: string }[];
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to index website");
      }

      setStatus("success");
      toast.success(data.message ?? "Website indexing started!");
      setTimeout(() => router.push("/employer/documents"), 2000);
    } catch (err) {
      setStatus("error");
      const msg = err instanceof Error ? err.message : "Unknown error";
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const disabled = isSubmitting || !url.trim() || !isValidHttpUrl(url);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <label htmlFor="website-url" style={labelStyle}>
          Page URL
        </label>
        <input
          id="website-url"
          type="url"
          placeholder="https://example.com/article"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={isSubmitting}
          style={inputStyle}
        />
        {url && !isValidHttpUrl(url) && (
          <div style={{ fontSize: 11.5, color: "var(--danger)", marginTop: 4 }}>
            Enter a valid http(s) URL
          </div>
        )}
      </div>

      <div>
        <label htmlFor="website-title" style={labelStyle}>
          Document title (optional)
        </label>
        <input
          id="website-title"
          type="text"
          placeholder="Derived from <title> if left blank"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={isSubmitting}
          style={inputStyle}
        />
      </div>

      <div
        style={{
          border: "1px solid var(--line)",
          borderRadius: 11,
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={crawlEnabled}
            onChange={(e) => setCrawlEnabled(e.target.checked)}
            disabled={isSubmitting}
            style={{ accentColor: "var(--accent)" }}
          />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
            Crawl linked pages
          </span>
          <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
            Follow same-domain links
          </span>
        </label>

        {crawlEnabled && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              paddingLeft: 24,
            }}
          >
            <div>
              <label htmlFor="max-depth" style={{ ...labelStyle, fontSize: 11.5 }}>
                Max depth: {maxDepth}
              </label>
              <input
                id="max-depth"
                type="range"
                min={1}
                max={3}
                value={maxDepth}
                onChange={(e) => setMaxDepth(Number(e.target.value))}
                disabled={isSubmitting}
                style={{ width: "100%", accentColor: "var(--accent)" }}
              />
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 10.5,
                  color: "var(--ink-3)",
                }}
              >
                <span>1 (shallow)</span>
                <span>3 (deep)</span>
              </div>
            </div>

            <div>
              <label htmlFor="max-pages" style={{ ...labelStyle, fontSize: 11.5 }}>
                Max pages
              </label>
              <input
                id="max-pages"
                type="number"
                min={1}
                max={50}
                value={maxPages}
                onChange={(e) => setMaxPages(Number(e.target.value))}
                disabled={isSubmitting}
                style={inputStyle}
              />
              <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>
                Up to 50 pages per crawl
              </div>
            </div>
          </div>
        )}
      </div>

      <label
        style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
      >
        <input
          type="checkbox"
          checked={jsRender}
          onChange={(e) => setJsRender(e.target.checked)}
          disabled={isSubmitting}
          style={{ accentColor: "var(--accent)" }}
        />
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
          Enable JS rendering
        </span>
        <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
          For SPAs that require JavaScript
        </span>
      </label>

      {status === "success" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 14px",
            borderRadius: 10,
            background: "oklch(0.95 0.05 155)",
            color: "oklch(0.4 0.14 155)",
            fontSize: 13,
          }}
        >
          <CheckCircle size={14} />
          {crawlEnabled
            ? "Crawl submitted! Pages are being indexed. Redirecting…"
            : "Website submitted for indexing! Redirecting…"}
        </div>
      )}

      {status === "error" && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            padding: "10px 14px",
            borderRadius: 10,
            background: "oklch(0.96 0.04 25)",
            color: "var(--danger)",
            fontSize: 13,
          }}
        >
          <AlertCircle size={14} style={{ marginTop: 2 }} />
          <span>{errorMessage}</span>
        </div>
      )}

      <button
        onClick={() => void handleSubmit()}
        disabled={disabled}
        style={{
          width: "100%",
          padding: "12px",
          borderRadius: 10,
          background: disabled ? "var(--line)" : "var(--accent)",
          color: disabled ? "var(--ink-3)" : "white",
          fontSize: 13.5,
          fontWeight: 600,
          border: "none",
          cursor: disabled ? "not-allowed" : "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          boxShadow: disabled ? "none" : "0 1px 4px var(--accent-glow)",
        }}
      >
        {isSubmitting ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            {crawlEnabled ? "Crawling & processing…" : "Fetching & processing…"}
          </>
        ) : (
          <>
            <Globe size={14} />
            {crawlEnabled ? "Crawl & index site" : "Index page"}
          </>
        )}
      </button>

      <div
        style={{
          padding: 14,
          borderRadius: 10,
          background: "var(--line-2)",
          fontSize: 12,
          color: "var(--ink-3)",
          lineHeight: 1.55,
        }}
      >
        <div style={{ fontWeight: 600, color: "var(--ink-2)", marginBottom: 6 }}>
          How this works
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 3 }}>
          <li>
            Pages are fetched server-side and cleaned with Readability (boilerplate, ads,
            and nav are stripped)
          </li>
          <li>Content is converted to Markdown preserving headings, lists, and tables</li>
          <li>Chunks are split along heading boundaries for better retrieval</li>
          {crawlEnabled ? (
            <>
              <li>
                Same-domain links are followed up to depth {maxDepth} (max {maxPages}{" "}
                pages)
              </li>
              <li>Each crawled page becomes a separate document</li>
            </>
          ) : (
            <li>Enable &quot;Crawl linked pages&quot; to index multiple pages</li>
          )}
        </ul>
      </div>
    </div>
  );
}
