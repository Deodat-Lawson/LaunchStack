"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, CircleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { parseIsoDate, weekStartOf } from "@launchstack/pipelines/vantage/week";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { cn } from "~/lib/utils";
import styles from "../_components/review-layout.module.css";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { ToolLink } from "~/components/tool-app/ToolLink";
import { useOptionalToolNav } from "~/components/tool-app/nav";
import { toolTabHref } from "~/lib/tool-app/locations";
import { weeklyReviewApi, type WeeklyReviewContextDto, type WeeklyReviewRoleDto } from "../api";
import { useWeeklyReviewData } from "../_lib/useWeeklyReviewData";
import { useWeeklyReviewErrorText } from "../_lib/weekly-review-errors";
import { ReviewBusinessRoleForm } from "../_components/ReviewBusinessRoleForm";
import {
    SourceScopeEditor,
    type SourceChoice,
    type SourceScope,
} from "../_components/SourceScopeEditor";

export function ContextScreen({ week: initialWeek }: { week?: string | null }) {
    const t = useTranslations("vantage.weeklyReview");
    const nav = useOptionalToolNav();
    const errorText = useWeeklyReviewErrorText();
    const week = weekStartOf(parseIsoDate(initialWeek) ?? new Date());
    const data = useWeeklyReviewData(week, { includeReport: false });
    const href = "/?week=" + encodeURIComponent(week);
    const goToWeek = (
        <Button asChild>
            {nav ? (
                <ToolLink href={href}>{t("goToThisWeek")}</ToolLink>
            ) : (
                <a href={toolTabHref("vantage", href)}>{t("goToThisWeek")}</a>
            )}
        </Button>
    );
    const context = data.context;
    const role = data.roleContext;
    const loaded = data.ready && !data.contextLoading && context !== null && role !== null;
    return (
        <div className={styles.surface} data-review-surface>
            <div className={cn(styles.column, "space-y-6")}>
                <header className="space-y-2">
                    <h1 className={styles.title}>{t("contextTitle")}</h1>
                    <p className={cn(styles.label, styles.prose)}>{t("contextDescription")}</p>
                </header>
                {data.loadError || data.contextError ? (
                    <p role="alert">{errorText(data.contextError ?? data.loadError)}</p>
                ) : null}
                {data.loading || data.contextLoading ? (
                    <p role="status" className={styles.label}>
                        {t("loadingEvidence")}
                    </p>
                ) : null}
                {data.enabled === false ? <p>{t("contextDisabled")}</p> : null}
                {data.enabled && loaded && context && role ? (
                    <ContextForms
                        key={`${context.policy?.version ?? 0}:${context.preferences?.version ?? 0}:${role.version}`}
                        context={context}
                        roleContext={role}
                        reload={data.reloadContext}
                        goToWeek={goToWeek}
                    />
                ) : null}
            </div>
        </div>
    );
}

type Section = "role" | "company" | "stars";
function ContextSection({
    id,
    title,
    summary,
    done,
    open,
    onOpenChange,
    children,
}: {
    id: Section;
    title: string;
    summary: string;
    done: boolean;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    children: ReactNode;
}) {
    const Icon = done ? Check : CircleAlert;
    return (
        <Card
            id={`context-${id}`}
            className={cn(styles.panel, "scroll-mt-5 gap-0", open && "border-brand")}
        >
            <Collapsible open={open} onOpenChange={onOpenChange}>
                <h2 aria-label={title}>
                    <CollapsibleTrigger asChild>
                        <Button
                            aria-label={title}
                            variant="ghost"
                            className="h-auto w-full justify-start gap-3 whitespace-normal p-5 text-left hover:bg-transparent"
                        >
                            <span
                                className={cn(
                                    "flex size-8 shrink-0 items-center justify-center rounded-full",
                                    done
                                        ? "bg-success-soft text-success-ink"
                                        : "bg-warn-soft text-warn-ink"
                                )}
                            >
                                <Icon className="size-4" aria-hidden="true" />
                            </span>
                            <span className="min-w-0 flex-1 space-y-1">
                                <span className={cn(styles.heading, "block")}>{title}</span>
                                <span className={cn(styles.label, "block truncate")}>
                                    {summary}
                                </span>
                            </span>
                            <ChevronDown
                                className={cn(
                                    "size-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none",
                                    open && "rotate-180"
                                )}
                                aria-hidden="true"
                            />
                        </Button>
                    </CollapsibleTrigger>
                </h2>
                <CollapsibleContent
                    forceMount
                    className={styles.accordionContent}
                    aria-hidden={!open}
                    inert={!open}
                >
                    <div className="px-5 pb-5 pt-1">{children}</div>
                </CollapsibleContent>
            </Collapsible>
        </Card>
    );
}

function ContextForms({
    context,
    roleContext,
    reload,
    goToWeek,
}: {
    context: WeeklyReviewContextDto;
    roleContext: WeeklyReviewRoleDto;
    reload: () => Promise<unknown>;
    goToWeek: ReactNode;
}) {
    const t = useTranslations("vantage.weeklyReview");
    const errorText = useWeeklyReviewErrorText();
    const [architecture, setArchitecture] = useState(
        context.policy?.architecture_document_id ?? ""
    );
    const [required, setRequired] = useState(context.policy?.required_document_ids ?? []);
    const [stars, setStars] = useState(context.preferences?.star_document_ids ?? []);
    const [companySearch, setCompanySearch] = useState("");
    const [starSearch, setStarSearch] = useState("");
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const policy = context.policy;
    const preferences = context.preferences;
    const roleDone = Boolean(roleContext.role?.confirmed);
    const companyDone = Boolean(policy?.architecture_document_id) && !policy?.hasHiddenSources;
    const starsDone =
        Boolean(preferences?.star_document_ids.length) && !preferences?.hasHiddenSources;
    const [openSection, setOpenSection] = useState<Section | "">(() =>
        roleContext.enabled && !roleDone
            ? "role"
            : !companyDone
              ? "company"
              : !starsDone
                ? "stars"
                : ""
    );
    const sectionChange = (section: Section) => (open: boolean) =>
        setOpenSection(open ? section : "");
    function openStep(section: Section) {
        setOpenSection(section);
        requestAnimationFrame(() => {
            const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
            document.getElementById(`context-${section}`)?.scrollIntoView?.({
                block: "start",
                behavior: reduceMotion ? "auto" : "smooth",
            });
        });
    }
    const companyBlocked = busy || !context.canConfigure || Boolean(policy?.hasHiddenSources);
    const starsBlocked = busy || Boolean(preferences?.hasHiddenSources);
    const sameIds = (a: string[], b: string[]) =>
        a.length === b.length && a.every(id => b.includes(id));
    const policyDirty =
        architecture !== (policy?.architecture_document_id ?? "") ||
        !sameIds(required, policy?.required_document_ids ?? []);
    const starsDirty = !sameIds(stars, preferences?.star_document_ids ?? []);
    const scopesFor = (scopes: Record<string, SourceScope> | undefined, ids: string[]) =>
        Object.fromEntries(Object.entries(scopes ?? {}).filter(([id]) => ids.includes(id)));
    async function act(action: string, success: string, work: () => Promise<unknown>) {
        if (busy) return;
        setBusy(true);
        setErrors(previous => ({ ...previous, [action]: "" }));
        try {
            await work();
            await reload();
            toast.success(success);
        } catch (error) {
            if (mounted.current)
                setErrors(previous => ({ ...previous, [action]: errorText(error) }));
        } finally {
            if (mounted.current) setBusy(false);
        }
    }
    const sourceChoices: SourceChoice[] = [];
    const title = (id: string) =>
        context.documents.find(document => document.id === id)?.title ?? id;
    if (context.canConfigure && policy) {
        for (const id of [
            ...new Set(
                [policy.architecture_document_id, ...policy.required_document_ids].filter(
                    (id): id is string => Boolean(id)
                )
            ),
        ])
            sourceChoices.push({
                id,
                title: title(id),
                purpose:
                    id === policy.architecture_document_id
                        ? "company-architecture"
                        : "workspace-required",
                configurationVersion: policy.version,
                hasHiddenSources: policy.hasHiddenSources,
            });
    }
    for (const id of preferences?.star_document_ids ?? [])
        sourceChoices.push({
            id,
            title: title(id),
            purpose: "personal-star",
            configurationVersion: preferences!.version,
            hasHiddenSources: preferences!.hasHiddenSources,
        });
    async function saveScope(source: SourceChoice, scope: SourceScope | null, version: number) {
        if (busy || source.hasHiddenSources) return;
        setBusy(true);
        try {
            const personal = source.purpose === "personal-star";
            const scopes = {
                ...(personal ? preferences?.star_source_scopes : policy?.required_source_scopes),
            };
            if (scope) scopes[source.id] = scope;
            else delete scopes[source.id];
            if (personal)
                await weeklyReviewApi.saveStars({
                    expectedVersion: version,
                    starDocumentIds: preferences?.star_document_ids ?? [],
                    starSourceScopes: scopes,
                });
            else
                await weeklyReviewApi.savePolicy({
                    expectedVersion: version,
                    architectureDocumentId: policy?.architecture_document_id ?? "",
                    requiredDocumentIds: policy?.required_document_ids ?? [],
                    requiredSourceScopes: scopes,
                });
            await reload();
            toast.success(t(personal ? "savedStars" : "savedContext"));
        } finally {
            if (mounted.current) setBusy(false);
        }
    }
    const matching = (query: string) =>
        context.documents.filter(document =>
            document.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
        );
    return (
        <div className="space-y-5">
            <Card className={cn(styles.panel, "gap-0")}>
                <CardContent className="space-y-5 p-5">
                    <h2 className={styles.label}>{t("setupChecklist")}</h2>
                    <ol className="grid gap-2 sm:grid-cols-3" aria-label={t("setupChecklist")}>
                        {(
                            [
                                ["role", "yourRole", roleDone, roleContext.enabled],
                                ["company", "companyDocuments", companyDone, true],
                                ["stars", "yourStarredDocuments", starsDone, true],
                            ] as const
                        ).map(([id, key, done, available]) => {
                            const Icon = done ? Check : CircleAlert;
                            return (
                                <li key={id}>
                                    <Button
                                        variant="ghost"
                                        disabled={!available}
                                        aria-label={t("openContextSection", { section: t(key) })}
                                        aria-controls={`context-${id}`}
                                        aria-expanded={openSection === id}
                                        onClick={() => openStep(id)}
                                        className="h-auto w-full justify-start gap-3 whitespace-normal rounded-lg px-3 py-3 text-left"
                                    >
                                        <span
                                            className={cn(
                                                "flex size-7 shrink-0 items-center justify-center rounded-full",
                                                done
                                                    ? "bg-success-soft text-success-ink"
                                                    : "bg-warn-soft text-warn-ink"
                                            )}
                                        >
                                            <Icon className="size-4" aria-hidden="true" />
                                        </span>
                                        <span className="min-w-0 space-y-1">
                                            <span className={cn(styles.body, "block")}>
                                                {t(key)}
                                            </span>
                                            <span className={cn(styles.label, "block")}>
                                                {t(done ? "done" : "notSet")}
                                            </span>
                                        </span>
                                    </Button>
                                </li>
                            );
                        })}
                    </ol>
                    {companyDone && (!roleContext.enabled || roleDone) ? goToWeek : null}
                </CardContent>
            </Card>
            {roleContext.enabled ? (
                <ContextSection
                    id="role"
                    title={t("yourRole")}
                    summary={roleContext.role?.primaryRole ?? t("notSet")}
                    done={roleDone}
                    open={openSection === "role"}
                    onOpenChange={sectionChange("role")}
                >
                    <div className="space-y-4">
                        {!roleContext.canEdit ? <p>{t("roleReadOnly")}</p> : null}
                        <ReviewBusinessRoleForm
                            role={roleContext.role}
                            disabled={busy || !roleContext.canEdit}
                            onSave={role =>
                                act("role", t("savedRole"), () =>
                                    weeklyReviewApi.saveRole(
                                        role
                                            ? { ...role, expectedVersion: roleContext.version }
                                            : { role: null, expectedVersion: roleContext.version }
                                    )
                                )
                            }
                        />
                        {errors.role ? <p role="alert">{errors.role}</p> : null}
                    </div>
                </ContextSection>
            ) : null}
            <ContextSection
                id="company"
                title={t("companyDocuments")}
                summary={
                    companyDone
                        ? t("contextCompanySummary", {
                              count: policy?.required_document_ids.length ?? 0,
                          })
                        : t("notSet")
                }
                done={companyDone}
                open={openSection === "company"}
                onOpenChange={sectionChange("company")}
            >
                <div className="space-y-4">
                    <p className={cn(styles.label, styles.prose)}>{t("contextHelp")}</p>
                    {policy?.hasHiddenSources ? (
                        <p role="alert">{t("hiddenConfiguration")}</p>
                    ) : null}
                    {!context.canConfigure ? <p>{t("companyReadOnly")}</p> : null}
                    <Label htmlFor="company-search">{t("searchDocuments")}</Label>
                    <Input
                        id="company-search"
                        value={companySearch}
                        onChange={event => setCompanySearch(event.target.value)}
                    />
                    <Label htmlFor="weekly-review-architecture">{t("architecture")}</Label>
                    <Select
                        value={architecture || undefined}
                        disabled={companyBlocked}
                        onValueChange={id => {
                            setArchitecture(id);
                            setRequired(previous => previous.filter(value => value !== id));
                        }}
                    >
                        <SelectTrigger id="weekly-review-architecture">
                            <SelectValue placeholder={t("selectDocument")} />
                        </SelectTrigger>
                        <SelectContent className={styles.typography}>
                            {matching(companySearch).map(document => (
                                <SelectItem key={document.id} value={document.id}>
                                    {document.title}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p>{t("selectedRequired", { count: required.length })}</p>
                    <div className="max-h-64 space-y-2 overflow-auto">
                        {matching(companySearch)
                            .filter(document => document.id !== architecture)
                            .map(document => (
                                <Label
                                    key={document.id}
                                    className="flex items-center gap-3 rounded-lg py-2"
                                >
                                    <Checkbox
                                        disabled={companyBlocked}
                                        checked={required.includes(document.id)}
                                        onCheckedChange={checked =>
                                            setRequired(previous =>
                                                checked === true
                                                    ? [...previous, document.id]
                                                    : previous.filter(id => id !== document.id)
                                            )
                                        }
                                    />
                                    {document.title}
                                </Label>
                            ))}
                    </div>
                    {!matching(companySearch).length ? <p>{t("noDocumentsFound")}</p> : null}
                    <Button
                        disabled={companyBlocked || !architecture || !policyDirty}
                        onClick={() =>
                            void act("company", t("savedContext"), () =>
                                weeklyReviewApi.savePolicy({
                                    expectedVersion: policy?.version ?? 0,
                                    architectureDocumentId: architecture,
                                    requiredDocumentIds: required,
                                    requiredSourceScopes: scopesFor(
                                        policy?.required_source_scopes,
                                        [architecture, ...required]
                                    ),
                                })
                            )
                        }
                    >
                        {t("saveContext")}
                    </Button>
                    {errors.company ? <p role="alert">{errors.company}</p> : null}
                </div>
            </ContextSection>
            <ContextSection
                id="stars"
                title={t("yourStarredDocuments")}
                summary={t("contextStarsSummary", {
                    count: preferences?.star_document_ids.length ?? 0,
                    total: 8,
                })}
                done={starsDone}
                open={openSection === "stars"}
                onOpenChange={sectionChange("stars")}
            >
                <div className="space-y-4">
                    <p className={cn(styles.label, styles.prose)}>{t("starHelp")}</p>
                    {preferences?.hasHiddenSources ? (
                        <p role="alert">{t("hiddenConfiguration")}</p>
                    ) : null}
                    <Label htmlFor="star-search">{t("searchDocuments")}</Label>
                    <Input
                        id="star-search"
                        value={starSearch}
                        onChange={event => setStarSearch(event.target.value)}
                    />
                    <p>{t("selectedStars", { count: stars.length })}</p>
                    <div className="max-h-64 space-y-2 overflow-auto">
                        {matching(starSearch).map(document => (
                            <Label
                                key={document.id}
                                className="flex items-center gap-3 rounded-lg py-2"
                            >
                                <Checkbox
                                    disabled={
                                        starsBlocked ||
                                        (!stars.includes(document.id) && stars.length >= 8)
                                    }
                                    checked={stars.includes(document.id)}
                                    onCheckedChange={checked =>
                                        setStars(previous =>
                                            checked === true
                                                ? [...previous, document.id]
                                                : previous.filter(id => id !== document.id)
                                        )
                                    }
                                />
                                {document.title}
                            </Label>
                        ))}
                    </div>
                    {!matching(starSearch).length ? <p>{t("noDocumentsFound")}</p> : null}
                    <Button
                        disabled={starsBlocked || !starsDirty || stars.length > 8}
                        onClick={() =>
                            void act("stars", t("savedStars"), () =>
                                weeklyReviewApi.saveStars({
                                    expectedVersion: preferences?.version ?? 0,
                                    starDocumentIds: stars,
                                    starSourceScopes: scopesFor(
                                        preferences?.star_source_scopes,
                                        stars
                                    ),
                                })
                            )
                        }
                    >
                        {t("saveStars")}
                    </Button>
                    {errors.stars ? <p role="alert">{errors.stars}</p> : null}
                </div>
            </ContextSection>
            {sourceChoices.length ? (
                <SourceScopeEditor
                    sources={sourceChoices}
                    read={weeklyReviewApi.read}
                    disabled={busy}
                    scopedEnabled={context.scopedEvidenceEnabled}
                    onSave={saveScope}
                />
            ) : null}
        </div>
    );
}
