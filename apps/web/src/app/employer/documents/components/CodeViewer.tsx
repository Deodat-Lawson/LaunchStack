"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import "highlight.js/styles/github-dark-dimmed.min.css";
import {
  Loader2,
  AlertTriangle,
  RotateCw,
  Copy,
  Check,
  WrapText,
  Hash,
} from "lucide-react";
import { Button } from "./ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

interface CodeViewerProps {
  url: string;
  title: string;
  mimeType?: string;
}

const EXTENSION_TO_HLJS: Record<string, string> = {
  py: "python",
  js: "javascript",
  ts: "typescript",
  jsx: "javascript",
  tsx: "typescript",
  css: "css",
  scss: "scss",
  less: "less",
  json: "json",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  cfg: "ini",
  env: "bash",
  log: "plaintext",
  rst: "plaintext",
  java: "java",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  go: "go",
  rs: "rust",
  rb: "ruby",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  sh: "bash",
  bash: "bash",
  sql: "sql",
  r: "r",
  lua: "lua",
  pl: "perl",
  scala: "scala",
  md: "markdown",
  html: "xml",
  htm: "xml",
  geojson: "json",
};

function detectLanguage(title: string, url: string): string {
  const combined = `${title} ${url}`;
  const match = combined.match(/\.([a-z0-9]+)(?:\?|#|$)/i);
  if (match?.[1]) {
    return EXTENSION_TO_HLJS[match[1].toLowerCase()] ?? "plaintext";
  }
  return "plaintext";
}

function detectExtension(title: string, url: string): string {
  const combined = `${title} ${url}`;
  const match = combined.match(/\.([a-z0-9]+)(?:\?|#|$)/i);
  return match?.[1]?.toLowerCase() ?? "";
}

export function CodeViewer({ url, title, mimeType: _mimeType }: CodeViewerProps) {
  const [code, setCode] = useState<string>("");
  const [highlightedHtml, setHighlightedHtml] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [wordWrap, setWordWrap] = useState(false);
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const codeRef = useRef<HTMLPreElement>(null);

  const language = detectLanguage(title, url);
  const extension = detectExtension(title, url);

  const fetchCode = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const text = await res.text();
      setCode(text);

      const hljs = (await import("highlight.js/lib/common")).default;
      let result: { value: string };
      try {
        result = hljs.highlight(text, { language });
      } catch {
        result = hljs.highlightAuto(text);
      }
      setHighlightedHtml(result.value);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load file");
    } finally {
      setLoading(false);
    }
  }, [url, language]);

  useEffect(() => {
    void fetchCode();
  }, [fetchCode]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  }, [code]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 bg-muted/30">
        <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
        <p className="text-sm text-muted-foreground font-medium">Loading source code...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center bg-muted/30">
        <div className="w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
          <AlertTriangle className="w-7 h-7 text-red-500" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground mb-1">Failed to load source code</p>
          <p className="text-xs text-muted-foreground mb-4">{error}</p>
          <button
            onClick={() => void fetchCode()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium transition-colors"
          >
            <RotateCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  const lineCount = code.split("\n").length;

  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-[#c9d1d9] overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#161b22] border-b border-[#30363d] flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono font-semibold text-[#58a6ff]">
            {extension ? `.${extension}` : language}
          </span>
          <span className="text-[10px] text-[#8b949e] font-mono">
            {lineCount} lines &middot; {(new Blob([code]).size / 1024).toFixed(1)} KB
          </span>
        </div>

        <div className="flex items-center gap-1">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-7 w-7 rounded-md ${showLineNumbers ? "text-[#58a6ff] bg-[#58a6ff]/10" : "text-[#8b949e]"} hover:text-[#58a6ff] hover:bg-[#58a6ff]/10`}
                  onClick={() => setShowLineNumbers(!showLineNumbers)}
                >
                  <Hash className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p className="text-xs">Toggle line numbers</p></TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-7 w-7 rounded-md ${wordWrap ? "text-[#58a6ff] bg-[#58a6ff]/10" : "text-[#8b949e]"} hover:text-[#58a6ff] hover:bg-[#58a6ff]/10`}
                  onClick={() => setWordWrap(!wordWrap)}
                >
                  <WrapText className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p className="text-xs">Toggle word wrap</p></TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-md text-[#8b949e] hover:text-[#58a6ff] hover:bg-[#58a6ff]/10"
                  onClick={() => void handleCopy()}
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p className="text-xs">{copied ? "Copied!" : "Copy code"}</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Code content */}
      <div className="flex-1 overflow-auto custom-code-scrollbar">
        <pre
          ref={codeRef}
          className={`text-[13px] leading-[1.6] font-mono p-0 m-0 ${wordWrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`}
        >
          <code className={`hljs language-${language}`}>
            {code.split("\n").map((line, i) => (
              <div
                key={i}
                className="flex hover:bg-[#1c2128] transition-colors duration-75"
              >
                {showLineNumbers && (
                  <span className="inline-block text-right text-[#484f58] select-none flex-shrink-0 pr-4 pl-4 min-w-[3.5rem] border-r border-[#21262d]">
                    {i + 1}
                  </span>
                )}
                <span
                  className="pl-4 pr-4 flex-1"
                  dangerouslySetInnerHTML={{
                    __html: highlightedHtml
                      ? highlightedHtml.split("\n")[i] ?? ""
                      : line
                          .replace(/&/g, "&amp;")
                          .replace(/</g, "&lt;")
                          .replace(/>/g, "&gt;"),
                  }}
                />
              </div>
            ))}
          </code>
        </pre>
      </div>

      <style jsx global>{`
        .custom-code-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
        .custom-code-scrollbar::-webkit-scrollbar-track { background: #0d1117; }
        .custom-code-scrollbar::-webkit-scrollbar-thumb { background: #30363d; border-radius: 4px; }
        .custom-code-scrollbar::-webkit-scrollbar-thumb:hover { background: #484f58; }
        .custom-code-scrollbar::-webkit-scrollbar-corner { background: #0d1117; }
      `}</style>
    </div>
  );
}
