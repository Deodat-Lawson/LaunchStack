"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
    Search,
    Plus,
    FileText,
    Sparkles,
    ArrowRight,
    Briefcase,
    Shield,
    UserCheck,
    Gavel,
} from "lucide-react";
import { TEMPLATE_REGISTRY, type TemplateField } from "@launchstack/pipelines/legal-templates";
import { legalTheme as s } from "./LegalGeneratorTheme";

export interface DocumentTemplate {
    id: string;
    name: string;
    /** A `Stage` id ("employment", …); "legal" for anything unstaged. */
    category: string;
    description: string;
    preview: string;
    isLegal?: boolean;
    fields?: TemplateField[];
}

interface GeneratedDocument {
    id: string;
    title: string;
    template: string;
    /** ISO time of the last save. */
    editedAt: string;
    content: string;
}

interface DocumentGeneratorHomeProps {
    /**
     * Which library the screen shows: the templates (New document) or the
     * person's drafts (My documents). The tool's rail switches between them,
     * so the screen has no tabs of its own.
     */
    mode: "new" | "existing";
    onNewDocument: (template: DocumentTemplate) => void;
    onOpenDocument: (document: GeneratedDocument) => void;
    onStartChat: (initialMessage?: string) => void;
    /** My documents is empty: go to New document. */
    onShowNew: () => void;
    generatedDocuments: GeneratedDocument[];
}

const STAGE_ORDER = [
    "confidentiality",
    "formation",
    "commercial",
    "fundraising",
    "employment",
    "product",
    "offboarding",
] as const;

/** A library section; "legal" holds a template no stage claims. */
type Stage = (typeof STAGE_ORDER)[number] | "legal";

const STAGE_MAP: Record<string, Stage> = {
    nda: "confidentiality",
    founders_agreement: "formation",
    ip_assignment: "formation",
    service_agreement: "commercial",
    contractor_agreement: "commercial",
    safe: "fundraising",
    advisory_agreement: "fundraising",
    employment_contract: "employment",
    employee_nda: "employment",
    invention_assignment: "employment",
    at_will_employment: "employment",
    non_compete: "employment",
    privacy_policy: "product",
    terms_of_service: "product",
    termination_letter: "offboarding",
    severance_agreement: "offboarding",
};

const STAGE_ICONS: Record<string, React.ReactNode> = {
    confidentiality: <Shield className="h-4 w-4" />,
    formation: <Briefcase className="h-4 w-4" />,
    commercial: <Briefcase className="h-4 w-4" />,
    fundraising: <Briefcase className="h-4 w-4" />,
    employment: <UserCheck className="h-4 w-4" />,
    product: <Shield className="h-4 w-4" />,
    offboarding: <Gavel className="h-4 w-4" />,
};

const STAGES = new Set<string>([...STAGE_ORDER, "legal"]);

function isStage(category: string): category is Stage {
    return STAGES.has(category);
}

type HomeT = ReturnType<typeof useTranslations<"generator.home">>;

/** The section name a category shows as. */
function stageLabel(category: string, t: HomeT): string {
    return isStage(category) ? t(`stages.${category}`) : category;
}

/** "5 mins ago", "Just now", or the date once it is a week old. */
function editedLabel(iso: string, t: HomeT, format: ReturnType<typeof useFormatter>): string {
    const date = new Date(iso);
    const diffMins = Math.floor((Date.now() - date.getTime()) / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    if (Number.isNaN(diffMins)) return iso;
    if (diffMins < 1) return t("edited.justNow");
    if (diffMins < 60) return t("edited.minutes", { count: diffMins });
    if (diffHours < 24) return t("edited.hours", { count: diffHours });
    if (diffDays < 7) return t("edited.days", { count: diffDays });
    return format.dateTime(date);
}

const templates: DocumentTemplate[] = Object.values(TEMPLATE_REGISTRY).map(t => ({
    id: t.id,
    name: t.name,
    category: STAGE_MAP[t.id] ?? "legal",
    description: t.description,
    preview: "",
    isLegal: true,
    fields: t.fields,
}));

export function DocumentGeneratorHome({
    mode: viewMode,
    onNewDocument,
    onOpenDocument,
    onStartChat,
    onShowNew,
    generatedDocuments,
}: DocumentGeneratorHomeProps) {
    const t = useTranslations("generator.home");
    const tc = useTranslations("common");
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedCategory, setSelectedCategory] = useState<string>("all");
    const [chatInput, setChatInput] = useState("");

    const categories: (Stage | "all")[] = ["all", ...STAGE_ORDER];

    const filteredTemplates = templates.filter(template => {
        const matchesSearch =
            template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            template.description.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory =
            selectedCategory === "all" || template.category === selectedCategory;
        return matchesSearch && matchesCategory;
    });

    const filteredDocuments = generatedDocuments.filter(doc =>
        doc.title.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const groupedTemplates =
        selectedCategory === "all"
            ? STAGE_ORDER.map((stage): { stage: string; items: DocumentTemplate[] } => ({
                  stage,
                  items: filteredTemplates.filter(tpl => tpl.category === stage),
              })).filter(g => g.items.length > 0)
            : [{ stage: selectedCategory, items: filteredTemplates }];

    const totalTemplates = templates.length;
    const categoryCounts: Record<string, number> = {};
    for (const tpl of templates) {
        categoryCounts[tpl.category] = (categoryCounts[tpl.category] ?? 0) + 1;
    }

    return (
        <div className={s.libContent}>
            <div className={s.libContentInner}>
                {/* Title row (matches `rd-content__h` spacing exactly). New document
                    and My documents are the tool rail's screens, not tabs here. */}
                <div className={s.libContentHead}>
                    <h1 className={s.libHeroHeading}>
                        {t.rich("title", { em: chunks => <em>{chunks}</em> })}
                    </h1>
                </div>
                <p className={s.libHeroSub}>{t("subtitle")}</p>

                {/* Search + filter strip — kept compact, sized like the design's chips */}
                <div
                    style={{ marginBottom: 24, display: "flex", flexDirection: "column", gap: 12 }}
                >
                    <div className={`${s.searchWrap} relative`}>
                        <Search
                            className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2"
                            style={{ color: "var(--ink-3)" }}
                        />
                        <input
                            type="text"
                            className={s.input}
                            placeholder={
                                viewMode === "new" ? t("searchTemplates") : t("searchDocuments")
                            }
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            style={{ paddingLeft: 40 }}
                        />
                        <kbd className={s.kbd}>⌘K</kbd>
                    </div>

                    {viewMode === "new" && (
                        <div
                            style={{ display: "flex", gap: 6, flexWrap: "wrap", overflowX: "auto" }}
                        >
                            {categories.map(category => {
                                const count =
                                    category === "all"
                                        ? totalTemplates
                                        : (categoryCounts[category] ?? 0);
                                return (
                                    <button
                                        key={category}
                                        onClick={() => setSelectedCategory(category)}
                                        className={`${s.chipBtn} ${
                                            selectedCategory === category ? s.chipBtnActive : ""
                                        }`}
                                    >
                                        {category === "all"
                                            ? tc("status.all")
                                            : t(`stages.${category}`)}
                                        <span style={{ color: "var(--ink-4)", marginLeft: 4 }}>
                                            {count}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Body */}
                {viewMode === "new" ? (
                    <>
                        {/* Assistant banner */}
                        <div className={s.libSection}>
                            <div className={s.banner}>
                                <div className="@max-md:flex-col @max-md:[align-items:stretch] flex flex-row gap-4 [align-items:center]">
                                    <div className="flex items-start gap-3">
                                        <div className={s.brandMark}>
                                            <Sparkles className="h-[18px] w-[18px]" />
                                        </div>
                                        <div className="min-w-0 space-y-1">
                                            <h3
                                                style={{
                                                    fontSize: 14,
                                                    fontWeight: 500,
                                                    letterSpacing: "-0.005em",
                                                    color: "var(--ink)",
                                                }}
                                            >
                                                {t("banner.title")}
                                            </h3>
                                            <p
                                                style={{
                                                    fontSize: 12,
                                                    color: "var(--ink-3)",
                                                    lineHeight: 1.55,
                                                    margin: 0,
                                                }}
                                            >
                                                {t("banner.body")}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="@max-md:justify-start flex flex-1 items-center justify-end gap-2">
                                        <div className="@max-md:min-w-0 relative min-w-[300px] flex-1">
                                            <input
                                                type="text"
                                                value={chatInput}
                                                onChange={e => setChatInput(e.target.value)}
                                                onKeyDown={e => {
                                                    if (e.key === "Enter" && chatInput.trim()) {
                                                        onStartChat(chatInput.trim());
                                                    }
                                                }}
                                                placeholder={t("banner.placeholder")}
                                                className={s.input}
                                            />
                                        </div>
                                        <button
                                            className={`${s.btn} ${s.btnAccent} ${s.btnSm}`}
                                            onClick={() =>
                                                onStartChat(chatInput.trim() || undefined)
                                            }
                                        >
                                            <Sparkles className="h-3.5 w-3.5" />
                                            {t("banner.askAi")}
                                            <ArrowRight className="h-3 w-3" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Recent in workspace */}
                        {generatedDocuments.length > 0 &&
                            selectedCategory === "all" &&
                            !searchQuery && (
                                <section className={s.libSection}>
                                    <div className={s.libSectionHead}>
                                        <h2 className={s.libSectionTitle}>{t("recentTitle")}</h2>
                                        <span className={s.libSectionMono}>
                                            {t("shownOfTotal", {
                                                shown: Math.min(3, generatedDocuments.length),
                                                total: generatedDocuments.length,
                                            })}
                                        </span>
                                    </div>
                                    <div className={s.libGrid}>
                                        {generatedDocuments.slice(0, 3).map(doc => (
                                            <RecentTile
                                                key={doc.id}
                                                doc={doc}
                                                onOpen={onOpenDocument}
                                            />
                                        ))}
                                    </div>
                                </section>
                            )}

                        {groupedTemplates.length === 0 && <EmptyTemplates query={searchQuery} />}

                        {/* Templates grouped by category */}
                        {groupedTemplates.map(({ stage, items }) => (
                            <section key={stage} className={s.libSection}>
                                <div className={s.libSectionHead}>
                                    <h2 className={s.libSectionTitle}>{stageLabel(stage, t)}</h2>
                                    <span className={s.libSectionMono}>
                                        {t("templateCount", { count: items.length })}
                                    </span>
                                </div>
                                <div className={s.libGrid}>
                                    {items.map(template => (
                                        <TemplateTile
                                            key={template.id}
                                            template={template}
                                            onSelect={onNewDocument}
                                        />
                                    ))}
                                </div>
                            </section>
                        ))}
                    </>
                ) : filteredDocuments.length > 0 ? (
                    <section className={s.libSection}>
                        <div className={s.libSectionHead}>
                            <h2 className={s.libSectionTitle}>{t("myDocuments")}</h2>
                            <span className={s.libSectionMono}>
                                {t("shownOfTotal", {
                                    shown: filteredDocuments.length,
                                    total: generatedDocuments.length,
                                })}
                            </span>
                        </div>
                        <div className={s.libGrid}>
                            {filteredDocuments.map(doc => (
                                <RecentTile key={doc.id} doc={doc} onOpen={onOpenDocument} />
                            ))}
                        </div>
                    </section>
                ) : (
                    <EmptyDocuments onSwitch={onShowNew} />
                )}
            </div>
        </div>
    );
}

// ─── Template tile (Drift `rd-tile` shape) ──────────────────────────────────

function TemplateTile({
    template,
    onSelect,
}: {
    template: DocumentTemplate;
    onSelect: (t: DocumentTemplate) => void;
}) {
    const t = useTranslations("generator.home");
    const fieldCount = template.fields?.length ?? 0;
    const requiredCount = template.fields?.filter(f => f.required).length ?? 0;
    const icon = STAGE_ICONS[template.category] ?? <FileText className="h-4 w-4" />;
    const fieldText = fieldCount > 0 ? t("tile.fields", { count: fieldCount }) : "";
    return (
        <button type="button" className={s.libTile} onClick={() => onSelect(template)}>
            <div className={s.libTileIcon}>{icon}</div>
            <div className={s.libTileTitle}>{template.name}</div>
            <p className={s.libTileSub}>
                {stageLabel(template.category, t)}
                {fieldText ? ` · ${fieldText}` : ""}
                {requiredCount > 0 && requiredCount < fieldCount
                    ? ` · ${t("tile.required", { count: requiredCount })}`
                    : ""}
            </p>
            <div className={s.libTileMeta}>
                <span>DOCX</span>
                <span>{t("tile.open")}</span>
            </div>
        </button>
    );
}

// ─── Recent doc tile (same `rd-tile` shape) ─────────────────────────────────

function RecentTile({
    doc,
    onOpen,
}: {
    doc: GeneratedDocument;
    onOpen: (doc: GeneratedDocument) => void;
}) {
    const t = useTranslations("generator.home");
    const format = useFormatter();
    return (
        <button type="button" className={s.libTile} onClick={() => onOpen(doc)}>
            <div className={s.libTileIcon}>
                <FileText className="h-4 w-4" />
            </div>
            <div
                className={s.libTileTitle}
                style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                }}
            >
                {doc.title}
            </div>
            <p className={s.libTileSub}>
                {t("tile.edited", {
                    template: doc.template === "Custom" ? t("tile.customTemplate") : doc.template,
                    when: editedLabel(doc.editedAt, t, format),
                })}
            </p>
            <div className={s.libTileMeta}>
                <span>{t("tile.draft")}</span>
                <span>{t("tile.open")}</span>
            </div>
        </button>
    );
}

// ─── Empty states ────────────────────────────────────────────────────────────

function EmptyTemplates({ query }: { query: string }) {
    const t = useTranslations("generator.home.emptyTemplates");
    return (
        <div
            className={`${s.panel} flex flex-col items-center gap-3 py-16 text-center`}
            style={{ borderStyle: "dashed" }}
        >
            <FileText className="h-10 w-10" style={{ color: "var(--ink-4)" }} />
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 500, color: "var(--ink)" }}>
                {t("title")}
            </h3>
            <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)", maxWidth: 360 }}>
                {query ? t("query", { query }) : t("filter")}
            </p>
        </div>
    );
}

function EmptyDocuments({ onSwitch }: { onSwitch: () => void }) {
    const t = useTranslations("generator.home.emptyDocuments");
    return (
        <div
            className={`${s.panel} mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center`}
            style={{ borderStyle: "dashed" }}
        >
            <FileText className="h-12 w-12" style={{ color: "var(--ink-4)" }} />
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500, color: "var(--ink)" }}>
                {t("title")}
            </h3>
            <p style={{ margin: 0, fontSize: 13, color: "var(--ink-3)", maxWidth: 340 }}>
                {t("body")}
            </p>
            <button
                className={`${s.btn} ${s.btnAccent} ${s.btnSm}`}
                onClick={onSwitch}
                style={{ marginTop: 8 }}
            >
                <Plus className="h-3.5 w-3.5" />
                {t("action")}
            </button>
        </div>
    );
}
