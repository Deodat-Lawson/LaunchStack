"use client";

import { useState, useRef, useCallback } from "react";
import {
  ArrowLeft,
  Save,
  Download,
  FileText,
  Loader2,
  CheckCircle,
  Sparkles,
  Send,
  Bold,
  Italic,
  Underline,
  Highlighter,
  Eye,
  EyeOff,
} from "lucide-react";
import { Button } from "~/app/employer/documents/components/ui/button";
import { Input } from "~/app/employer/documents/components/ui/input";
import { Textarea } from "~/app/employer/documents/components/ui/textarea";
import { cn } from "~/lib/utils";
import type { EditorSection } from "~/lib/legal-templates/section-builders";
import type { AIAction } from "./generator";

interface LegalDocumentEditorProps {
  initialTitle: string;
  sections: EditorSection[];
  docxBase64?: string;
  documentId?: number;
  onBack: () => void;
  onSave: (title: string, content: string) => void;
}

function EditableSection({
  section,
  isActive,
  onFocus,
  onUpdate,
  showHighlights,
}: {
  section: EditorSection;
  isActive: boolean;
  onFocus: (id: string) => void;
  onUpdate: (id: string, html: string) => void;
  showHighlights: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const handleInput = useCallback(() => {
    if (ref.current) onUpdate(section.id, ref.current.innerHTML);
  }, [section.id, onUpdate]);

  if (section.type === "title") {
    return (
      <div className="text-center py-8 pb-4 border-b-2 border-[#1a1a2e] mb-6">
        <h1
          className="text-2xl font-bold tracking-wide text-[#1a1a2e] dark:text-foreground m-0"
          style={{ fontFamily: "'Playfair Display', Georgia, serif", letterSpacing: "0.06em" }}
        >
          {section.content}
        </h1>
      </div>
    );
  }

  if (section.type === "heading") {
    return (
      <h2
        className="text-base font-bold text-[#1a1a2e] dark:text-foreground mt-6 mb-1.5 pb-1 border-b border-[#e0d8cf] dark:border-border tracking-wide"
        style={{ fontFamily: "'Playfair Display', Georgia, serif", letterSpacing: "0.02em" }}
      >
        {section.content}
      </h2>
    );
  }

  return (
    <div
      className={cn(
        "relative my-1 rounded transition-all",
        isActive
          ? "border border-[#8B7355] bg-[rgba(139,115,85,0.03)] dark:bg-[rgba(139,115,85,0.08)]"
          : "border border-transparent"
      )}
    >
      {isActive && section.label && (
        <div
          className="absolute -top-2.5 left-3 bg-[#f9f6f1] dark:bg-card px-1.5 text-[10px] font-semibold text-[#8B7355] uppercase tracking-wider"
        >
          {section.label}
        </div>
      )}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onFocus={() => onFocus(section.id)}
        dangerouslySetInnerHTML={{ __html: section.content }}
        className={cn(
          "text-sm leading-7 text-[#2c2c2c] dark:text-foreground px-3 py-2 outline-none cursor-text min-h-[20px]",
          showHighlights
            ? "[&_mark]:bg-[#FFF9C4] [&_mark]:px-0.5 [&_mark]:rounded-sm [&_mark]:border-b-2 [&_mark]:border-[#FFD54F]"
            : "[&_mark]:bg-transparent [&_mark]:p-0 [&_mark]:border-b-0"
        )}
        style={{ fontFamily: "'Source Serif 4', Georgia, serif" }}
      />
    </div>
  );
}

export function LegalDocumentEditor({
  initialTitle,
  sections: initialSections,
  docxBase64,
  documentId,
  onBack,
  onSave,
}: LegalDocumentEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [sections, setSections] = useState<EditorSection[]>(initialSections);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [showHighlights, setShowHighlights] = useState(true);
  const [editCount, setEditCount] = useState(0);
  const [status, setStatus] = useState<"draft" | "editing" | "saved">("draft");
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const [aiPrompt, setAiPrompt] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);

  const handleUpdate = useCallback((id: string, html: string) => {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, content: html } : s)));
    setStatus("editing");
    setEditCount((c) => c + 1);
  }, []);

  const handleFormat = (cmd: string) => {
    if (cmd === "highlight") {
      document.execCommand("hiliteColor", false, "#FFF59D");
    } else if (cmd === "removeHighlight") {
      document.execCommand("hiliteColor", false, "transparent");
    } else {
      document.execCommand(cmd, false, undefined);
    }
  };

  const getSectionsAsHtml = useCallback(() => {
    return sections
      .map((s) => {
        if (s.type === "title") return `<h1>${s.content}</h1>`;
        if (s.type === "heading") return `<h2>${s.content}</h2>`;
        return `<p>${s.content}</p>`;
      })
      .join("\n");
  }, [sections]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const content = getSectionsAsHtml();
      await Promise.resolve(onSave(title, content));
      setLastSaved(new Date());
      setStatus("saved");
    } finally {
      setIsSaving(false);
    }
  }, [onSave, title, getSectionsAsHtml]);

  const downloadDocx = () => {
    if (!docxBase64) return;
    const byteChars = atob(docxBase64);
    const byteArray = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
    const blob = new Blob([byteArray], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title || "document"}.docx`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus("saved");
  };

  const exportPdf = () => {
    window.print();
  };

  const getSelectedSectionText = (): string => {
    if (!activeSection) return "";
    const section = sections.find((s) => s.id === activeSection);
    if (!section) return "";
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = section.content;
    return tempDiv.textContent ?? "";
  };

  const handleAIRequest = async () => {
    if (!aiPrompt.trim()) return;
    setIsProcessing(true);
    setChatMessages((prev) => [...prev, { role: "user", content: aiPrompt }]);
    const prompt = aiPrompt;
    setAiPrompt("");

    const sectionText = getSelectedSectionText();
    const action: AIAction = sectionText && activeSection ? "rewrite" : "continue";
    const fullContent = getSectionsAsHtml();

    try {
      const response = await fetch("/api/document-generator/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          content: sectionText || fullContent.slice(-500),
          prompt,
          context: { documentTitle: title, fullContent: fullContent.slice(0, 3000) },
          options: { tone: "professional", length: "medium" },
        }),
      });

      const data = (await response.json()) as { success: boolean; generatedContent?: string };

      if (data.success && data.generatedContent) {
        if (activeSection && action === "rewrite") {
          setSections((prev) =>
            prev.map((s) => (s.id === activeSection ? { ...s, content: data.generatedContent! } : s))
          );
          setChatMessages((prev) => [
            ...prev,
            { role: "assistant", content: "Section has been rewritten. You can continue editing or undo with Ctrl+Z." },
          ]);
        } else {
          setChatMessages((prev) => [
            ...prev,
            { role: "assistant", content: data.generatedContent! },
          ]);
        }
        setStatus("editing");
        setEditCount((c) => c + 1);
      }
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, there was an error. Please try again." },
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleQuickAction = async (action: AIAction) => {
    if (!activeSection) return;
    setIsProcessing(true);
    const sectionText = getSelectedSectionText();
    const fullContent = getSectionsAsHtml();

    try {
      const response = await fetch("/api/document-generator/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          content: sectionText || fullContent.slice(-500),
          prompt: "",
          context: { documentTitle: title, fullContent: fullContent.slice(0, 3000) },
          options: { tone: "professional", length: "medium" },
        }),
      });

      const data = (await response.json()) as { success: boolean; generatedContent?: string };

      if (data.success && data.generatedContent) {
        setSections((prev) =>
          prev.map((s) => (s.id === activeSection ? { ...s, content: data.generatedContent! } : s))
        );
        setChatMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Section ${action === "rewrite" ? "rewritten" : action === "expand" ? "expanded" : action === "summarize" ? "summarized" : "updated"}.` },
        ]);
        setStatus("editing");
        setEditCount((c) => c + 1);
      }
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, there was an error. Please try again." },
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  const statusConfig = {
    draft: { bg: "bg-orange-50 dark:bg-orange-900/20", text: "text-orange-700 dark:text-orange-300", border: "border-orange-300 dark:border-orange-700", dot: "bg-orange-600" },
    editing: { bg: "bg-green-50 dark:bg-green-900/20", text: "text-green-700 dark:text-green-300", border: "border-green-300 dark:border-green-700", dot: "bg-green-600" },
    saved: { bg: "bg-blue-50 dark:bg-blue-900/20", text: "text-blue-700 dark:text-blue-300", border: "border-blue-300 dark:border-blue-700", dot: "bg-blue-600" },
  };
  const sc = statusConfig[status];

  const editActions: { label: string; action: AIAction }[] = [
    { label: "Rewrite", action: "rewrite" },
    { label: "Expand", action: "expand" },
    { label: "Summarize", action: "summarize" },
    { label: "Make Professional", action: "change_tone" },
  ];

  return (
    <div className="flex flex-col h-full bg-background print:bg-white">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Source+Serif+4:ital,wght@0,300;0,400;0,600;1,400&family=DM+Sans:wght@400;500;600&display=swap');
        @media print {
          .no-print { display: none !important; }
          .legal-paper { box-shadow: none !important; border: none !important; }
        }
      `}</style>

      {/* Top Bar */}
      <div className="no-print flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-border bg-background">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div className="h-6 w-px bg-border" />
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="border-0 focus-visible:ring-0 font-medium text-lg px-2 bg-transparent text-foreground max-w-[400px]"
            placeholder="Document Title"
          />
        </div>
        <div className="flex items-center gap-2">
          {lastSaved && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <CheckCircle className="w-3 h-3 text-green-500" />
              Saved {lastSaved.toLocaleTimeString()}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={() => void handleSave()} disabled={isSaving} className="text-muted-foreground hover:text-foreground">
            {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Main Editor Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="no-print flex-shrink-0 sticky top-0 z-20 flex items-center gap-1.5 px-4 py-2 bg-[#f9f6f1] dark:bg-card backdrop-blur border-b border-[#e0d8cf] dark:border-border">
            {(["bold", "italic", "underline"] as const).map((cmd) => (
              <button
                key={cmd}
                onClick={() => handleFormat(cmd)}
                className="w-8 h-8 border border-[#d5cec4] dark:border-border rounded bg-white dark:bg-muted hover:bg-gray-50 dark:hover:bg-muted/80 cursor-pointer flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              >
                {cmd === "bold" && <Bold className="w-3.5 h-3.5" />}
                {cmd === "italic" && <Italic className="w-3.5 h-3.5" />}
                {cmd === "underline" && <Underline className="w-3.5 h-3.5" />}
              </button>
            ))}

            <div className="w-px h-5 bg-[#d5cec4] dark:bg-border mx-1" />

            <button
              onClick={() => handleFormat("highlight")}
              title="Highlight"
              className="w-8 h-8 border border-[#d5cec4] dark:border-border rounded bg-white dark:bg-muted hover:bg-gray-50 dark:hover:bg-muted/80 cursor-pointer flex items-center justify-center"
            >
              <Highlighter className="w-3.5 h-3.5 text-yellow-600" />
            </button>

            <div className="flex-1" />

            {editCount > 0 && (
              <span className="text-xs text-[#8B7355]">
                {editCount} edit{editCount !== 1 ? "s" : ""}
              </span>
            )}

            <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded border", sc.bg, sc.text, sc.border)}>
              <span className={cn("w-1.5 h-1.5 rounded-full", sc.dot, status === "editing" && "animate-pulse")} />
              {status}
            </span>

            <div className="w-px h-5 bg-[#d5cec4] dark:bg-border mx-1" />

            <button
              onClick={() => setShowHighlights(!showHighlights)}
              title={showHighlights ? "Hide filled fields" : "Show filled fields"}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground border border-[#d5cec4] dark:border-border rounded bg-white dark:bg-muted hover:bg-gray-50 dark:hover:bg-muted/80 cursor-pointer transition-colors"
            >
              {showHighlights ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              Fields
            </button>

            {docxBase64 && (
              <button
                onClick={downloadDocx}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-[#1a1a2e] text-[#f0ebe3] rounded cursor-pointer hover:bg-[#2a2a3e] transition-colors"
              >
                <Download className="w-3 h-3" />
                DOCX
              </button>
            )}
            <button
              onClick={exportPdf}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-[#8B7355] text-white rounded cursor-pointer hover:bg-[#7a6548] transition-colors"
            >
              <FileText className="w-3 h-3" />
              PDF
            </button>
          </div>

          {/* Document Body */}
          <div className="flex-1 overflow-y-auto bg-[#eee8df] dark:bg-muted/30">
            <div className="max-w-[820px] mx-auto py-6 px-6 pb-20">
              <div className="legal-paper bg-[#f9f6f1] dark:bg-card rounded-md shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)] overflow-hidden border border-border/30">
                <div className="px-12 py-5 pb-14">
                  <div className="h-[3px] bg-gradient-to-r from-[#1a1a2e] via-[#8B7355] to-[#1a1a2e] rounded mb-2" />

                  {sections.map((s) => (
                    <EditableSection
                      key={s.id}
                      section={s}
                      isActive={activeSection === s.id}
                      onFocus={setActiveSection}
                      onUpdate={handleUpdate}
                      showHighlights={showHighlights}
                    />
                  ))}

                  <div className="mt-9">
                    <div className="h-px bg-[#d5cec4] dark:bg-border mb-2.5" />
                    <div className="flex justify-between text-[10px] text-[#b0a797] dark:text-muted-foreground italic">
                      <span>Generated {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</span>
                      <span>Page 1 of 1</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Hint */}
              <div className="no-print mt-4 p-3.5 bg-[rgba(139,115,85,0.08)] dark:bg-muted/50 rounded-md border border-[rgba(139,115,85,0.15)] dark:border-border flex gap-2.5 items-start">
                <div className="w-4 h-4 rounded-full bg-[#8B7355] text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">
                  i
                </div>
                <div className="text-xs text-[#5a4e3e] dark:text-muted-foreground leading-relaxed">
                  <strong>Workflow:</strong> Yellow highlights = filled values. Click any section to edit inline. Use the AI panel to rewrite sections. Export as <strong>DOCX</strong> (editable in Word/Google Docs) or <strong>PDF</strong> (for signing).
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* AI Panel */}
        <div className="no-print w-[350px] flex-shrink-0 bg-background border-l border-border flex flex-col h-full">
          <div className="flex-shrink-0 p-4 border-b border-border bg-background/50 backdrop-blur-md">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-5 h-5 text-blue-600" />
              <h3 className="font-semibold text-foreground">AI Assistant</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              {activeSection ? "Click a section, then ask AI to edit it" : "Select a section to get started"}
            </p>
          </div>

          <div className="flex-1 p-4 overflow-y-auto">
            <div className="space-y-4">
              {chatMessages.length === 0 && (
                <div className="space-y-3">
                  <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                    <p className="text-sm font-medium mb-2 flex items-center gap-2 text-foreground">
                      <Sparkles className="w-4 h-4 text-blue-600" />
                      How to use AI
                    </p>
                    <ul className="text-xs text-muted-foreground space-y-1">
                      <li>&bull; Click a section to select it</li>
                      <li>&bull; Use quick actions to transform text</li>
                      <li>&bull; Type a custom instruction below</li>
                      <li>&bull; Yellow highlights show filled values</li>
                    </ul>
                  </div>

                  {activeSection && (
                    <div>
                      <p className="text-xs font-bold mb-2 text-muted-foreground uppercase tracking-widest">
                        EDIT SELECTED SECTION
                      </p>
                      <div className="space-y-2">
                        {editActions.map((a) => (
                          <Button
                            key={a.label}
                            variant="outline"
                            size="sm"
                            className="w-full justify-start text-sm border-border text-muted-foreground hover:text-foreground"
                            onClick={() => void handleQuickAction(a.action)}
                            disabled={isProcessing}
                          >
                            {a.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {chatMessages.map((message, index) => (
                <div
                  key={index}
                  className={cn(
                    "p-3 rounded-2xl shadow-sm border border-border/50",
                    message.role === "user"
                      ? "bg-blue-100 dark:bg-blue-900/30 ml-4 border-blue-200/50"
                      : "bg-muted/50 mr-4"
                  )}
                >
                  <p className="text-[10px] font-black mb-1 text-muted-foreground uppercase tracking-widest">
                    {message.role === "user" ? "You" : "AI Assistant"}
                  </p>
                  <p className="text-sm text-foreground leading-relaxed">{message.content}</p>
                </div>
              ))}

              {isProcessing && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground animate-pulse">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  AI is processing...
                </div>
              )}
            </div>
          </div>

          <div className="flex-shrink-0 p-4 border-t border-border bg-background">
            <div className="space-y-2">
              {activeSection && (
                <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-100/50 dark:border-blue-900/50 text-[10px]">
                  <p className="font-black mb-1 uppercase tracking-widest text-blue-600 dark:text-blue-400">
                    Active Section
                  </p>
                  <p className="text-muted-foreground italic">
                    {sections.find((s) => s.id === activeSection)?.label ?? activeSection}
                  </p>
                </div>
              )}
              <Textarea
                placeholder={activeSection ? "Ask AI to edit this section..." : "Select a section first..."}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                className="resize-none bg-muted/30 border-border rounded-xl focus-visible:ring-blue-500"
                rows={3}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleAIRequest();
                  }
                }}
              />
              <Button
                onClick={() => void handleAIRequest()}
                disabled={!aiPrompt.trim() || isProcessing}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/20 rounded-xl"
                size="sm"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    Send to AI
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
