"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { parseIsoDate, weekStartOf } from "@launchstack/pipelines/vantage/week";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
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
    const link = (label: string) =>
        nav ? (
            <ToolLink href={href} className="text-brand underline">
                {label}
            </ToolLink>
        ) : (
            <a href={toolTabHref("vantage", href)} className="text-brand underline">
                {label}
            </a>
        );
    const context = data.context;
    const role = data.roleContext;
    const loaded = data.ready && !data.contextLoading && context !== null && role !== null;
    const roleDone = loaded && Boolean(role.role?.confirmed);
    const companyDone =
        loaded &&
        Boolean(context.policy?.architecture_document_id) &&
        !context.policy?.hasHiddenSources;
    const starsDone =
        loaded &&
        Boolean(context.preferences?.star_document_ids.length) &&
        !context.preferences?.hasHiddenSources;
    return (
        <div className="mx-auto max-w-4xl space-y-5 p-6">
            <h1 className="text-xl font-semibold">{t("contextTitle")}</h1>
            <p className="text-ink-2 text-sm">{t("contextDescription")}</p>
            <Card>
                <CardHeader>
                    <CardTitle>{t("setupChecklist")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <ul className="space-y-2">
                        {(
                            [
                                ["yourRole", roleDone],
                                ["companyDocuments", companyDone],
                                ["yourStarredDocuments", starsDone],
                            ] as const
                        ).map(([key, done]) => (
                            <li key={key} className="flex justify-between gap-4">
                                <span>{t(key)}</span>
                                <span>{t(done ? "done" : "notSet")}</span>
                            </li>
                        ))}
                    </ul>
                    {companyDone && (!role?.enabled || roleDone)
                        ? link(t("goToThisWeek"))
                        : link(t("openThisWeek"))}
                </CardContent>
            </Card>
            {data.loadError || data.contextError ? (
                <p role="alert">{errorText(data.contextError ?? data.loadError)}</p>
            ) : null}
            {data.loading || data.contextLoading ? (
                <p role="status">{t("loadingEvidence")}</p>
            ) : null}
            {data.enabled === false ? <p>{t("contextDisabled")}</p> : null}
            {data.enabled && loaded && context && role ? (
                <ContextForms
                    key={`${context.policy?.version ?? 0}:${context.preferences?.version ?? 0}:${role.version}`}
                    context={context}
                    roleContext={role}
                    reload={data.reloadContext}
                />
            ) : null}
        </div>
    );
}

function ContextForms({
    context,
    roleContext,
    reload,
}: {
    context: WeeklyReviewContextDto;
    roleContext: WeeklyReviewRoleDto;
    reload: () => Promise<unknown>;
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
            {roleContext.enabled ? (
                <Card>
                    <CardHeader>
                        <CardTitle>{t("yourRole")}</CardTitle>
                    </CardHeader>
                    <CardContent>
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
                    </CardContent>
                </Card>
            ) : null}
            <Card>
                <CardHeader>
                    <CardTitle>{t("companyDocuments")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <p className="text-ink-2 text-sm">{t("contextHelp")}</p>
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
                        <SelectContent>
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
                                <Label key={document.id} className="flex items-center gap-2">
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
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>{t("yourStarredDocuments")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <p className="text-ink-2 text-sm">{t("starHelp")}</p>
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
                            <Label key={document.id} className="flex items-center gap-2">
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
                </CardContent>
            </Card>
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
