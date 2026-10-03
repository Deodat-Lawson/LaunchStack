"use client";

/**
 * Templated Drafts: the drafts list and what each screen shows.
 *
 * Legal document flow:
 * 1. New document ("/") — pick a template from the library, or describe the
 *    situation to the assistant.
 * 2. Assistant ("/assistant", optional) — recommends a template and pre-fills
 *    field values.
 * 3. Editor ("/documents/<id>") — LegalDocumentEditor opens directly with the
 *    templated draft. Field values are filled inline via the right-pane
 *    Fields tab.
 * My documents ("/documents") lists every draft.
 *
 * The tab (`DraftsTool`) owns the frame, the rail and the path; it calls
 * `useDraftDocuments` once so the rail can count the drafts, and hands the
 * same value to `DocumentGenerator` along with the screen the path names.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { useToolNav, useToolRouter } from "~/components/tool-app/nav";
import { ToolNotFound } from "~/components/tool-app/ToolFrame";
import { Button } from "~/components/ui/button";
import { DocumentGeneratorHome, type DocumentTemplate } from "./DocumentGeneratorHome";
import { LegalDocumentEditor } from "./LegalDocumentEditor";
import { DocumentGeneratorEditor } from "./DocumentGeneratorEditor";
import { LegalChatbot } from "./LegalChatbot";
import { LegalGeneratorTheme, legalTheme } from "./LegalGeneratorTheme";
import type { Citation } from "./generator";
import { draftsDocumentPath, type DraftsScreen } from "./generator/drafts-screens";
import { TEMPLATE_REGISTRY } from "@launchstack/pipelines/legal-templates";
import type { EditorSection } from "@launchstack/pipelines/legal-templates";
import { parseLegalDocumentHtmlToSections } from "@launchstack/pipelines/legal-templates";
import {
    buildEditorSections,
    buildTemplateFieldDataForDocx,
    extractFieldValuesFromSections,
} from "@launchstack/pipelines/legal-templates";

export interface GeneratedDocument {
    id: string;
    title: string;
    template: string;
    lastEdited: string;
    content: string;
    citations?: Citation[];
    docxBase64?: string;
    sections?: EditorSection[];
    metadata?: {
        tone?: string;
        audience?: string;
        length?: string;
        description?: string;
        templateType?: "general" | "legal";
        legalData?: Record<string, string>;
        /** Persisted from editor so reopen keeps section labels and field layout */
        legalSections?: EditorSection[];
    };
}

interface APIDocument {
    id: number;
    title: string;
    content: string;
    templateId?: string;
    metadata?: GeneratedDocument["metadata"];
    citations?: Citation[];
    createdAt: string;
    updatedAt?: string;
}

function shouldOpenAsLegalEditor(doc: GeneratedDocument): boolean {
    const id = doc.template;
    if (!id || !TEMPLATE_REGISTRY[id]) return false;
    if (doc.metadata?.templateType === "legal") return true;
    return /<mark[^>]*\bdata-field-key=/i.test(doc.content);
}

function getLegalSectionsForDocument(doc: GeneratedDocument): EditorSection[] {
    if (doc.sections && doc.sections.length > 0) {
        return doc.sections;
    }
    const fromMeta = doc.metadata?.legalSections;
    if (fromMeta && Array.isArray(fromMeta) && fromMeta.length > 0) {
        return fromMeta;
    }
    return parseLegalDocumentHtmlToSections(doc.content);
}

async function regenerateLegalDocxBase64(
    templateId: string,
    contentHtml: string,
    legalData?: Record<string, string>
): Promise<string | undefined> {
    if (!templateId || !TEMPLATE_REGISTRY[templateId]) return undefined;
    const data = buildTemplateFieldDataForDocx(templateId, contentHtml, legalData);
    try {
        const res = await fetch("/api/document-generator/legal-generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                templateId,
                data,
                format: "json",
            }),
        });
        const json = (await res.json()) as {
            success?: boolean;
            docxBase64?: string;
        };
        if (!json.success || !json.docxBase64) return undefined;
        return json.docxBase64;
    } catch {
        return undefined;
    }
}

function formatRelativeTime(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? "s" : ""} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
    return date.toLocaleDateString();
}

/**
 * What the editor needs that the list does not carry: a legal draft's
 * sections, and a fresh DOCX built from its current content.
 */
async function prepareForEditor(document: GeneratedDocument): Promise<GeneratedDocument> {
    if (!shouldOpenAsLegalEditor(document)) return document;
    const sections = getLegalSectionsForDocument(document);
    let next: GeneratedDocument = {
        ...document,
        sections,
        metadata: {
            ...(document.metadata ?? {}),
            templateType: "legal",
            legalSections: sections,
        },
    };
    const docx = await regenerateLegalDocxBase64(
        next.template,
        next.content,
        next.metadata?.legalData
    );
    if (docx) {
        next = { ...next, docxBase64: docx };
    }
    return next;
}

export interface DraftDocuments {
    /** Every draft but Rewrite's, newest first as the server returns them. */
    documents: GeneratedDocument[];
    isLoading: boolean;
    /** The list has loaded at least once, so `documents` is the real list and not the empty start. */
    loaded: boolean;
    /** The list failed to load, or a draft could not be created. */
    error: string | null;
    reload: () => Promise<void>;
    /** Persist an empty draft from a template; null (and `error` set) when that fails. */
    createDraft: (
        template: DocumentTemplate,
        prefilled?: Record<string, string>
    ) => Promise<GeneratedDocument | null>;
    /** Save an open draft; resolves to the saved document, or null when the save failed. */
    saveDraft: (
        document: GeneratedDocument,
        title: string,
        content: string,
        citations?: Citation[],
        editorSections?: EditorSection[]
    ) => Promise<GeneratedDocument | null>;
}

/** The drafts list and the calls that change it. One per Templated Drafts tab. */
export function useDraftDocuments(): DraftDocuments {
    const [documents, setDocuments] = useState<GeneratedDocument[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const reload = useCallback(async () => {
        try {
            setIsLoading(true);
            setError(null);

            const response = await fetch("/api/document-generator/documents");
            const data = (await response.json()) as {
                success: boolean;
                message?: string;
                documents?: APIDocument[];
            };

            if (data.success && data.documents) {
                const docs: GeneratedDocument[] = data.documents
                    .filter((doc: APIDocument) => doc.templateId !== "rewrite")
                    .map((doc: APIDocument) => ({
                        id: doc.id.toString(),
                        title: doc.title,
                        template: doc.templateId ?? "Custom",
                        lastEdited: formatRelativeTime(doc.updatedAt ?? doc.createdAt),
                        content: doc.content,
                        citations: doc.citations,
                        metadata: doc.metadata,
                    }));
                setDocuments(docs);
                setLoaded(true);
            } else {
                setError(data.message ?? "Failed to fetch documents");
            }
        } catch (err) {
            console.error("Error fetching documents:", err);
            setError("Failed to load documents");
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    /**
     * A chosen legal template opens straight in the editor — no Configure
     * step. Builds skeleton sections client-side and persists an empty draft
     * so the editor's save/DOCX flows have a document id to work with.
     */
    const createDraft = useCallback(
        async (
            template: DocumentTemplate,
            prefilled?: Record<string, string>
        ): Promise<GeneratedDocument | null> => {
            const registryTemplate = TEMPLATE_REGISTRY[template.id];
            if (!registryTemplate) {
                setError(`Unknown template: ${template.id}`);
                return null;
            }

            setError(null);
            const data = prefilled ?? {};
            const sections = buildEditorSections(registryTemplate, data);
            const htmlContent = sections
                .map(s => {
                    if (s.type === "title") return `<h1>${s.content}</h1>`;
                    if (s.type === "heading") return `<h2>${s.content}</h2>`;
                    return `<p>${s.content}</p>`;
                })
                .join("\n");

            try {
                const response = await fetch("/api/document-generator/documents", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        title: template.name,
                        content: htmlContent,
                        templateId: template.id,
                        metadata: {
                            templateType: "legal",
                            legalData: data,
                            legalSections: sections,
                        },
                    }),
                });

                const json = (await response.json()) as {
                    success: boolean;
                    message?: string;
                    document?: { id: number };
                };

                if (!json.success || !json.document) {
                    setError(json.message ?? "Failed to create draft");
                    return null;
                }

                const newDoc: GeneratedDocument = {
                    id: json.document.id.toString(),
                    title: template.name,
                    template: template.id,
                    lastEdited: "Just now",
                    content: htmlContent,
                    sections,
                    metadata: {
                        templateType: "legal",
                        legalData: data,
                        legalSections: sections,
                    },
                };

                setDocuments(prev => [newDoc, ...prev]);
                return newDoc;
            } catch (err) {
                console.error("Error opening legal draft:", err);
                setError("Failed to open templated draft");
                return null;
            }
        },
        []
    );

    const saveDraft = useCallback(
        async (
            currentDocument: GeneratedDocument,
            title: string,
            content: string,
            citations?: Citation[],
            editorSections?: EditorSection[]
        ): Promise<GeneratedDocument | null> => {
            const isLegalDoc =
                shouldOpenAsLegalEditor(currentDocument) ||
                currentDocument.metadata?.templateType === "legal";
            const legalSectionsSnapshot = isLegalDoc
                ? (() => {
                      if (editorSections && editorSections.length > 0) {
                          return editorSections;
                      }
                      const parsed = parseLegalDocumentHtmlToSections(content);
                      if (parsed.length > 0) {
                          return parsed;
                      }
                      return currentDocument.metadata?.legalSections ?? [];
                  })()
                : undefined;
            const legalMetadata = isLegalDoc
                ? {
                      ...(currentDocument.metadata ?? {}),
                      templateType: "legal" as const,
                      legalData: extractFieldValuesFromSections([content]),
                      legalSections: legalSectionsSnapshot ?? [],
                  }
                : undefined;

            try {
                const response = await fetch("/api/document-generator/documents", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        id: parseInt(currentDocument.id),
                        title,
                        content,
                        citations,
                        ...(legalMetadata !== undefined ? { metadata: legalMetadata } : {}),
                    }),
                });

                const data = (await response.json()) as { success: boolean };
                if (!data.success) return null;

                let docxBase64: string | undefined = currentDocument.docxBase64;
                if (
                    isLegalDoc &&
                    currentDocument.template &&
                    TEMPLATE_REGISTRY[currentDocument.template]
                ) {
                    const refreshed = await regenerateLegalDocxBase64(
                        currentDocument.template,
                        content,
                        legalMetadata?.legalData
                    );
                    if (refreshed) {
                        docxBase64 = refreshed;
                    }
                }

                const updatedDoc: GeneratedDocument = {
                    ...currentDocument,
                    title,
                    content,
                    citations,
                    docxBase64,
                    ...(legalSectionsSnapshot !== undefined
                        ? { sections: legalSectionsSnapshot }
                        : {}),
                    ...(legalMetadata !== undefined ? { metadata: legalMetadata } : {}),
                    lastEdited: "Just now",
                };

                setDocuments(prev =>
                    prev.map(doc => (doc.id === currentDocument.id ? updatedDoc : doc))
                );
                return updatedDoc;
            } catch (err) {
                console.error("Error saving document:", err);
                return null;
            }
        },
        []
    );

    return { documents, isLoading, loaded, error, reload, createDraft, saveDraft };
}

/** One conversation with the assistant. A new key is a new conversation. */
interface ChatSession {
    key: number;
    initialMessage?: string;
}

export interface DocumentGeneratorProps {
    /** The screen the tab's path names (see `draftsScreenFor`). */
    screen: DraftsScreen;
    /** `useDraftDocuments()`, called by the tab so its rail can count the drafts. */
    drafts: DraftDocuments;
}

/**
 * The screen for the tab's current path. Renders inside the tool frame's
 * `fill` box: every screen brings its own padding and fills the tab.
 */
export function DocumentGenerator({ screen, drafts }: DocumentGeneratorProps) {
    const router = useToolRouter();
    const { createDraft, saveDraft } = drafts;

    // The draft open in the editor, prepared (sections, DOCX) from the list
    // entry the path names. Kept after leaving so Back and Forward reopen it
    // without preparing it again; saves keep it current.
    const [opened, setOpened] = useState<GeneratedDocument | null>(null);

    // The assistant stays mounted once visited, hidden on the other screens,
    // so a trip to My documents and back through the rail finds the
    // conversation where it was. "Ask AI" on New document starts a new one.
    const onAssistant = screen.screen === "assistant";
    const [chat, setChat] = useState<ChatSession | null>(null);
    if (onAssistant && chat === null) setChat({ key: 0 });

    const openId = screen.screen === "document" ? screen.id : null;
    const listed = openId === null ? undefined : drafts.documents.find(doc => doc.id === openId);

    useEffect(() => {
        if (!listed || opened?.id === listed.id) return;
        let cancelled = false;
        // A failed DOCX rebuild still opens the draft, just without the file.
        void prepareForEditor(listed)
            .catch(() => listed)
            .then(next => {
                if (!cancelled) setOpened(next);
            });
        return () => {
            cancelled = true;
        };
    }, [listed, opened?.id]);

    const createAndOpen = useCallback(
        async (template: DocumentTemplate, prefilled?: Record<string, string>) => {
            const doc = await createDraft(template, prefilled);
            if (!doc) return;
            setOpened(doc);
            router.push(draftsDocumentPath(doc.id));
        },
        [createDraft, router]
    );

    const startChat = (initialMessage?: string) => {
        setChat(prev => ({ key: (prev?.key ?? 0) + 1, initialMessage }));
        router.push("/assistant");
    };

    const continueFromChat = (templateId: string, prefilled: Record<string, string>) => {
        const registryTemplate = TEMPLATE_REGISTRY[templateId];
        if (!registryTemplate) return;

        const template: DocumentTemplate = {
            id: registryTemplate.id,
            name: registryTemplate.name,
            category: "Legal",
            description: registryTemplate.description,
            preview: "",
            isLegal: true,
            fields: registryTemplate.fields,
        };
        void createAndOpen(template, prefilled);
    };

    const showDocuments = () => router.push("/documents");

    const save = async (
        current: GeneratedDocument,
        title: string,
        content: string,
        citations?: Citation[],
        editorSections?: EditorSection[]
    ) => {
        const updated = await saveDraft(current, title, content, citations, editorSections);
        // Only if that draft is still the open one: a save that lands after
        // the person opened another must not swap it out.
        if (updated) setOpened(prev => (prev?.id === updated.id ? updated : prev));
    };

    let main: ReactNode = null;
    switch (screen.screen) {
        case "new":
        case "documents":
            main = drafts.isLoading ? (
                <LoadingState label="Loading documents…" />
            ) : drafts.error ? (
                <ErrorState message={drafts.error} onRetry={() => void drafts.reload()} />
            ) : (
                // The library grows with its content so the frame scrolls it and
                // puts the scroll back on Back. Both screens are this one element,
                // so a search typed on one is still there on the other.
                <LegalGeneratorTheme className={legalTheme.rootFlow}>
                    <DocumentGeneratorHome
                        mode={screen.screen === "new" ? "new" : "existing"}
                        onNewDocument={template => void createAndOpen(template)}
                        onOpenDocument={doc => router.push(draftsDocumentPath(doc.id))}
                        onStartChat={startChat}
                        onShowNew={() => router.push("/")}
                        generatedDocuments={drafts.documents}
                    />
                </LegalGeneratorTheme>
            );
            break;
        case "document":
            if (opened && opened.id === screen.id) {
                main = (
                    <DraftEditor
                        key={opened.id}
                        document={opened}
                        onBack={showDocuments}
                        onSave={save}
                    />
                );
            } else if (drafts.isLoading) {
                main = <LoadingState label="Loading documents…" />;
            } else if (!listed) {
                main = drafts.error ? (
                    <ErrorState message={drafts.error} onRetry={() => void drafts.reload()} />
                ) : (
                    <DraftNotFound onShowDocuments={showDocuments} />
                );
            } else {
                main = <LoadingState label="Opening document…" />;
            }
            break;
        case "assistant":
            break;
        case "not-found":
            main = (
                <Padded>
                    <ToolNotFound home="/" homeLabel="New document" />
                </Padded>
            );
            break;
    }

    return (
        <>
            {main}
            {chat && (
                <div hidden={!onAssistant} className="h-full">
                    <LegalGeneratorTheme>
                        <LegalChatbot
                            key={chat.key}
                            onContinueToTemplateForm={continueFromChat}
                            initialMessage={chat.initialMessage}
                        />
                    </LegalGeneratorTheme>
                </div>
            )}
        </>
    );
}

function DraftEditor({
    document,
    onBack,
    onSave,
}: {
    document: GeneratedDocument;
    onBack: () => void;
    onSave: (
        current: GeneratedDocument,
        title: string,
        content: string,
        citations?: Citation[],
        editorSections?: EditorSection[]
    ) => Promise<void>;
}) {
    const templateId = document.template;
    const resolvedFields = templateId ? (TEMPLATE_REGISTRY[templateId]?.fields ?? []) : [];
    const legalSections = getLegalSectionsForDocument(document);
    const useLegalEditor =
        shouldOpenAsLegalEditor(document) && resolvedFields.length > 0 && legalSections.length > 0;

    if (useLegalEditor) {
        return (
            <LegalGeneratorTheme ambient={false}>
                <LegalDocumentEditor
                    initialTitle={document.title}
                    sections={legalSections}
                    templateId={document.template}
                    documentId={parseInt(document.id)}
                    templateFields={resolvedFields}
                    onBack={onBack}
                    onSave={(title, content, editorSections) =>
                        void onSave(document, title, content, undefined, editorSections)
                    }
                />
            </LegalGeneratorTheme>
        );
    }

    return (
        <LegalGeneratorTheme ambient={false}>
            <DocumentGeneratorEditor
                initialTitle={document.title}
                initialContent={document.content}
                initialCitations={document.citations}
                documentId={parseInt(document.id)}
                onBack={onBack}
                backLabel="My documents"
                onSave={(title, content, citations) =>
                    void onSave(document, title, content, citations)
                }
                docxBase64={document.docxBase64}
            />
        </LegalGeneratorTheme>
    );
}

/** The frame adds no padding around a `fill` screen; these few states want the usual. */
function Padded({ children }: { children: ReactNode }) {
    return <div className="@max-md:px-4 @max-md:pt-4 px-8 pb-12 pt-6">{children}</div>;
}

function LoadingState({ label }: { label: string }) {
    return (
        <LegalGeneratorTheme>
            <div className="flex h-full items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="text-brand size-8 animate-spin" />
                    <p className="text-ink-3">{label}</p>
                </div>
            </div>
        </LegalGeneratorTheme>
    );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <LegalGeneratorTheme>
            <div className="flex h-full items-center justify-center">
                <div className="flex max-w-md flex-col items-center gap-4 text-center">
                    <p className="text-danger">{message}</p>
                    <Button variant="outline" size="sm" onClick={onRetry}>
                        Try again
                    </Button>
                </div>
            </div>
        </LegalGeneratorTheme>
    );
}

/**
 * A draft id the list does not have: deleted, a teammate's (the list is the
 * member's own drafts in this workspace), or a remembered location from
 * another workspace. Not a place to come back to, so the tab forgets it —
 * when it can: on a cold open the tab has already remembered the path
 * before the list arrives, and the next screen the person picks replaces it.
 */
function DraftNotFound({ onShowDocuments }: { onShowDocuments: () => void }) {
    const { forgetCurrent } = useToolNav();
    useEffect(() => forgetCurrent(), [forgetCurrent]);
    return (
        <Padded>
            <div className="border-line bg-panel flex max-w-xl flex-col items-start gap-2 rounded-lg border px-5 py-5">
                <div className="text-ink text-sm font-medium">
                    This draft is not in My documents
                </div>
                <p className="text-ink-2 text-sm">
                    It may have been deleted, or it is someone else&apos;s: drafts are private to
                    whoever made them, in the workspace they made them in.
                </p>
                <Button size="sm" variant="outline" className="mt-1" onClick={onShowDocuments}>
                    Go to My documents
                </Button>
            </div>
        </Padded>
    );
}
