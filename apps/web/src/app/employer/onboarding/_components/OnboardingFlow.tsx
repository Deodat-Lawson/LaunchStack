"use client";

import { ArrowRight, FileText, FileUp, Globe, Loader2, MessageSquare, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Progress } from "~/components/ui/progress";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { companyProfileApi } from "~/lib/company-profile/api";
import type { CompanyProfileDto, ProfileSourceDto } from "~/lib/company-profile/dto";
import { normalizeWebsite } from "~/lib/company-profile/website";
import { cn } from "~/lib/utils";
import {
    registerDocument,
    uploadFileToStorage,
} from "~/app/employer/documents/_workspace/sourceUpload";

/** Where onboarding puts what it imports; the source sorter reads the folder name as a hint. */
const FOLDER = "Company";

/** `value` is what the profile stores (English, whatever language it was picked in); `key` names it on screen. */
const INDUSTRIES = [
    { value: "Technology", key: "technology" },
    { value: "Healthcare", key: "healthcare" },
    { value: "Finance", key: "finance" },
    { value: "Legal", key: "legal" },
    { value: "Education", key: "education" },
    { value: "Manufacturing", key: "manufacturing" },
    { value: "Retail", key: "retail" },
    { value: "Government", key: "government" },
    { value: "Non-profit", key: "nonProfit" },
    { value: "Other", key: "other" },
] as const;

const STEPS = ["company", "documents", "understood"] as const;
type Step = 0 | 1 | 2;

type FlowT = ReturnType<typeof useTranslations<"onboarding.flow">>;

interface Answers {
    website: string;
    description: string;
    idea: string;
    industry: string;
}

/** What GET /api/company/onboarding says is already known. */
interface Known {
    saved: { website: boolean; description: boolean; idea: boolean };
    fromSources: { website: string | null; description: string | null };
    websiteImported: boolean;
    canEdit: boolean;
    answers: Answers;
}

type ImportState =
    | { state: "idle" }
    | { state: "importing"; url: string }
    | { state: "done"; url: string }
    /** `retry`: worth trying again (the site or the network failed), not an address that can never be fetched. */
    | { state: "failed"; url: string; message: string; retry: boolean };

/** The server's limits (CompanyOnboardingSchema). */
const MAX_WEBSITE = 2048;
const MAX_TEXT = 5000;

interface UploadItem {
    key: string;
    name: string;
    size: number;
    state: "uploading" | "added" | "failed";
    message?: string;
}

function errorText(e: unknown, fallback: string): string {
    return e instanceof Error && e.message ? e.message : fallback;
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface OnboardingResponse {
    name?: string | null;
    website?: string | null;
    description?: string | null;
    idea?: string | null;
    industry?: string | null;
    saved?: Known["saved"];
    fromSources?: Known["fromSources"];
    websiteImported?: boolean;
    canEdit?: boolean;
}

/** A value the documents supply, offered as a placeholder the person can write over. */
function hint(t: FlowT, value: string | null | undefined): string | null {
    if (!value) return null;
    const short = value.length > 140 ? `${value.slice(0, 139)}…` : value;
    return t("fromSources", { value: short });
}

/**
 * Only what the person typed or changed. An answer shown as it was saved is
 * not sent again, and nothing that came from the documents is offered in the
 * first place, so Continue never turns a document's fact into the person's.
 */
function changedAnswers(
    answers: Answers,
    website: string | null,
    known: Known | null
): Partial<Answers> {
    const payload: Partial<Answers> = {};
    const fresh = (field: "website" | "description" | "idea", value: string) =>
        value !== "" && (!known?.saved[field] || value !== known.answers[field]);
    if (website && fresh("website", website)) payload.website = website;
    const description = answers.description.trim();
    if (fresh("description", description)) payload.description = description;
    const idea = answers.idea.trim();
    if (fresh("idea", idea)) payload.idea = idea;
    if (answers.industry && answers.industry !== known?.answers.industry)
        payload.industry = answers.industry;
    return payload;
}

/**
 * The first minutes of a workspace: what the company is, its website, and
 * documents about it. What a person types becomes their own facts on the
 * company profile; the website's homepage and the documents become sources
 * the profile reads and quotes. Every step can be skipped.
 */
export function OnboardingFlow() {
    const t = useTranslations("onboarding.flow");
    const tc = useTranslations("common.status");
    const router = useRouter();
    const [step, setStep] = useState<Step>(0);
    const [name, setName] = useState<string | null>(null);
    const [answers, setAnswers] = useState<Answers>({
        website: "",
        description: "",
        idea: "",
        industry: "",
    });
    const [loaded, setLoaded] = useState(false);
    const [known, setKnown] = useState<Known | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [websiteImport, setWebsiteImport] = useState<ImportState>({ state: "idle" });
    const [uploads, setUploads] = useState<UploadItem[]>([]);
    const panel = useRef<HTMLElement>(null);
    const firstStep = useRef(true);

    // A new step starts at the top, with its heading announced.
    useEffect(() => {
        if (firstStep.current) {
            firstStep.current = false;
            return;
        }
        window.scrollTo({ top: 0 });
        panel.current?.querySelector("h1")?.focus({ preventScroll: true });
    }, [step]);

    useEffect(() => {
        let alive = true;
        void fetch("/api/company/onboarding")
            .then(r => (r.ok ? r.json() : null))
            .then((data: OnboardingResponse | null) => {
                if (!alive || !data) return;
                const loadedAnswers = {
                    website: data.website ?? "",
                    description: data.description ?? "",
                    idea: data.idea ?? "",
                    industry: data.industry ?? "",
                };
                setName(data.name ?? null);
                setAnswers(loadedAnswers);
                setKnown({
                    saved: data.saved ?? { website: false, description: false, idea: false },
                    fromSources: data.fromSources ?? { website: null, description: null },
                    websiteImported: data.websiteImported ?? false,
                    canEdit: data.canEdit ?? true,
                    answers: loadedAnswers,
                });
            })
            .finally(() => alive && setLoaded(true));
        return () => {
            alive = false;
        };
    }, []);

    const leave = () => router.replace("/employer/documents");

    const importWebsite = useCallback(
        async (url: string) => {
            setWebsiteImport({ state: "importing", url });
            try {
                const res = await fetch("/api/upload/website", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ url, category: FOLDER }),
                });
                if (!res.ok) {
                    const body = (await res.json().catch(() => ({}))) as { error?: string };
                    setWebsiteImport({
                        state: "failed",
                        url,
                        message: body.error ?? t("errors.fetchFailed", { status: res.status }),
                        // A refused address (private, malformed) or folder fails the same way every time.
                        retry: res.status >= 500 || res.status === 429,
                    });
                    return;
                }
                setWebsiteImport({ state: "done", url });
            } catch (e) {
                setWebsiteImport({
                    state: "failed",
                    url,
                    message: errorText(e, t("errors.importFailed")),
                    retry: true,
                });
            }
        },
        [t]
    );

    const saveCompany = async () => {
        const website = answers.website.trim();
        const normalized = website ? normalizeWebsite(website) : null;
        if (website && !normalized) {
            setSaveError(t("errors.badWebsite"));
            return;
        }
        setSaving(true);
        setSaveError(null);
        try {
            const payload = changedAnswers(answers, normalized, known);
            if (Object.keys(payload).length > 0) {
                const res = await fetch("/api/company/onboarding", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                });
                if (!res.ok) {
                    const body = (await res.json().catch(() => ({}))) as { error?: string };
                    throw new Error(body.error ?? t("errors.saveFailed"));
                }
                // What was just saved is now saved: Back and Continue again sends nothing.
                setKnown(k =>
                    k
                        ? {
                              ...k,
                              saved: {
                                  website: k.saved.website || payload.website !== undefined,
                                  description:
                                      k.saved.description || payload.description !== undefined,
                                  idea: k.saved.idea || payload.idea !== undefined,
                              },
                              answers: { ...k.answers, ...payload },
                          }
                        : k
                );
            }
            // Import the homepage when the address is new or not a source yet, once per
            // address; it keeps going while the person moves on.
            const isSource =
                known !== null &&
                known.saved.website &&
                known.websiteImported &&
                known.answers.website === normalized;
            const underway =
                websiteImport.state !== "idle" &&
                websiteImport.state !== "failed" &&
                websiteImport.url === normalized;
            const already = isSource || underway;
            if (normalized && !already) void importWebsite(normalized);
            setStep(1);
        } catch (e) {
            setSaveError(errorText(e, t("errors.saveFailed")));
        } finally {
            setSaving(false);
        }
    };

    const addFiles = (files: File[]) => {
        for (const file of files) {
            const key = `${file.name}-${file.size}-${file.lastModified}`;
            if (uploads.some(u => u.key === key)) continue;
            setUploads(list => [
                ...list,
                { key, name: file.name, size: file.size, state: "uploading" },
            ]);
            void (async () => {
                try {
                    const stored = await uploadFileToStorage(file);
                    await registerDocument({ file, ...stored, category: FOLDER });
                    setUploads(list =>
                        list.map(u => (u.key === key ? { ...u, state: "added" } : u))
                    );
                } catch (e) {
                    setUploads(list =>
                        list.map(u =>
                            u.key === key
                                ? {
                                      ...u,
                                      state: "failed",
                                      message: errorText(e, t("errors.uploadFailed")),
                                  }
                                : u
                        )
                    );
                }
            })();
        }
    };

    const companyName = name ?? t("yourCompany");

    // Nothing until it is known who is asking: a member must not see the admin's form flash by.
    if (!loaded)
        return (
            <div className="text-ink-3 mx-auto w-full max-w-[680px] py-10 text-sm" aria-busy="true">
                {tc("loading")}
            </div>
        );
    if (known && !known.canEdit) return <ReadOnly companyName={companyName} onLeave={leave} />;

    return (
        <div className="mx-auto flex w-full max-w-[680px] flex-col gap-5">
            <div className="flex flex-col gap-2">
                <div className="text-ink-3 flex items-center justify-between gap-3 text-xs">
                    <span>
                        {t("stepOf", {
                            step: step + 1,
                            total: STEPS.length,
                            name: t(`steps.${STEPS[step]}`),
                        })}
                    </span>
                    <Button variant="ghost" size="sm" onClick={leave}>
                        {t("skipSetup")}
                    </Button>
                </div>
                <Progress
                    value={((step + 1) / STEPS.length) * 100}
                    aria-label={t("progressLabel")}
                />
            </div>

            <section ref={panel} className="border-line bg-panel rounded-lg border">
                {step === 0 && (
                    <CompanyStep
                        companyName={companyName}
                        fromSources={known?.fromSources ?? null}
                        homepageIsSource={Boolean(
                            known?.websiteImported &&
                                normalizeWebsite(answers.website) === known.answers.website
                        )}
                        answers={answers}
                        loaded={loaded}
                        onChange={patch => setAnswers(a => ({ ...a, ...patch }))}
                        error={saveError}
                        saving={saving}
                        onContinue={() => void saveCompany()}
                        onSkip={() => setStep(1)}
                    />
                )}
                {step === 1 && (
                    <DocumentsStep
                        companyName={companyName}
                        uploads={uploads}
                        onFiles={addFiles}
                        onBack={() => setStep(0)}
                        onContinue={() => setStep(2)}
                    />
                )}
                {step === 2 && (
                    <UnderstoodStep
                        companyName={companyName}
                        websiteImport={websiteImport}
                        onRetryWebsite={url => void importWebsite(url)}
                        uploads={uploads}
                        onBack={() => setStep(1)}
                        onFinish={leave}
                    />
                )}
            </section>
        </div>
    );
}

// ─── Step 1 ──────────────────────────────────────────────────────────────────

function StepHeader({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-2 px-6 pt-6 max-sm:px-4">
            <h1
                tabIndex={-1}
                className="display text-ink text-balance text-2xl font-semibold outline-none"
            >
                {title}
            </h1>
            <p className="text-ink-2 max-w-[60ch] text-sm leading-relaxed">{children}</p>
        </div>
    );
}

/** Back on the left, the way forward on the right; on a phone, full width with the way forward on top. */
function StepFooter({ children }: { children: React.ReactNode }) {
    return (
        <div className="border-line-2 flex items-center gap-2 border-t px-6 py-4 max-sm:flex-col-reverse max-sm:items-stretch max-sm:px-4">
            {children}
        </div>
    );
}

function CompanyStep({
    companyName,
    fromSources,
    homepageIsSource,
    answers,
    loaded,
    onChange,
    error,
    saving,
    onContinue,
    onSkip,
}: {
    companyName: string;
    answers: Answers;
    fromSources: Known["fromSources"] | null;
    homepageIsSource: boolean;
    loaded: boolean;
    onChange: (patch: Partial<Answers>) => void;
    error: string | null;
    saving: boolean;
    onContinue: () => void;
    onSkip: () => void;
}) {
    const t = useTranslations("onboarding.flow");
    const tc = useTranslations("common.actions");
    return (
        <form
            onSubmit={e => {
                e.preventDefault();
                onContinue();
            }}
        >
            <StepHeader title={t("company.title", { company: companyName })}>
                {t("company.intro")}
            </StepHeader>
            <div className="flex flex-col gap-5 px-6 py-6 max-sm:px-4">
                <div className="grid gap-1.5">
                    <Label htmlFor="onboarding-website">{t("company.website")}</Label>
                    <Input
                        id="onboarding-website"
                        inputMode="url"
                        autoComplete="url"
                        placeholder={hint(t, fromSources?.website) ?? "acme.com"}
                        value={answers.website}
                        onChange={e => onChange({ website: e.target.value })}
                        maxLength={MAX_WEBSITE}
                        disabled={!loaded}
                    />
                    <p className="text-ink-3 text-xs">
                        {homepageIsSource
                            ? t("company.homepageIsSource")
                            : t("company.homepageImport")}
                    </p>
                </div>
                <div className="grid gap-1.5">
                    <Label htmlFor="onboarding-description">{t("company.description")}</Label>
                    <Textarea
                        id="onboarding-description"
                        rows={3}
                        placeholder={
                            hint(t, fromSources?.description) ?? t("company.descriptionPlaceholder")
                        }
                        value={answers.description}
                        onChange={e => onChange({ description: e.target.value })}
                        maxLength={MAX_TEXT}
                        disabled={!loaded}
                    />
                </div>
                <div className="grid gap-1.5">
                    <Label htmlFor="onboarding-idea">{t("company.idea")}</Label>
                    <Textarea
                        id="onboarding-idea"
                        rows={3}
                        placeholder={t("company.ideaPlaceholder")}
                        value={answers.idea}
                        onChange={e => onChange({ idea: e.target.value })}
                        maxLength={MAX_TEXT}
                        disabled={!loaded}
                    />
                </div>
                <div className="grid gap-1.5">
                    <Label htmlFor="onboarding-industry">{t("company.industry")}</Label>
                    <Select
                        value={answers.industry}
                        onValueChange={value => onChange({ industry: value })}
                        disabled={!loaded}
                    >
                        <SelectTrigger id="onboarding-industry" className="w-full max-w-xs">
                            <SelectValue placeholder={t("company.industryPlaceholder")} />
                        </SelectTrigger>
                        <SelectContent>
                            {INDUSTRIES.map(industry => (
                                <SelectItem key={industry.value} value={industry.value}>
                                    {t(`industries.${industry.key}`)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                {error && (
                    <p role="alert" className="text-danger text-sm">
                        {error}
                    </p>
                )}
            </div>
            <StepFooter>
                <Button type="button" variant="ghost" onClick={onSkip}>
                    {t("skipStep")}
                </Button>
                <div className="flex-1 max-sm:hidden" />
                <Button type="submit" disabled={saving || !loaded}>
                    {saving && (
                        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                    )}
                    {tc("continue")}
                </Button>
            </StepFooter>
        </form>
    );
}

// ─── Step 2 ──────────────────────────────────────────────────────────────────

function DocumentsStep({
    companyName,
    uploads,
    onFiles,
    onBack,
    onContinue,
}: {
    companyName: string;
    uploads: UploadItem[];
    onFiles: (files: File[]) => void;
    onBack: () => void;
    onContinue: () => void;
}) {
    const t = useTranslations("onboarding.flow");
    const tc = useTranslations("common.actions");
    const input = useRef<HTMLInputElement>(null);
    const [over, setOver] = useState(false);
    const busy = uploads.some(u => u.state === "uploading");

    return (
        <>
            <StepHeader title={t("documents.title")}>
                {t("documents.intro", { company: companyName })}
            </StepHeader>
            <div className="flex flex-col gap-3 px-6 py-6 max-sm:px-4">
                <div
                    onDragOver={e => {
                        e.preventDefault();
                        setOver(true);
                    }}
                    onDragLeave={() => setOver(false)}
                    onDrop={e => {
                        e.preventDefault();
                        setOver(false);
                        onFiles(Array.from(e.dataTransfer.files));
                    }}
                    className={cn(
                        "border-line flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-8 text-center",
                        over && "border-brand bg-brand/5"
                    )}
                >
                    <FileUp className="text-ink-3 size-6" aria-hidden />
                    <p className="text-ink-2 text-sm">{t("documents.drop")}</p>
                    <Button type="button" variant="outline" onClick={() => input.current?.click()}>
                        {t("documents.choose")}
                    </Button>
                    <input
                        ref={input}
                        id="onboarding-files"
                        type="file"
                        multiple
                        className="sr-only"
                        aria-label={t("documents.chooseLabel")}
                        accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.md,.markdown,.txt,.html,.htm,.csv"
                        onChange={e => {
                            onFiles(Array.from(e.target.files ?? []));
                            e.target.value = "";
                        }}
                    />
                    <p className="text-ink-3 text-xs">{t("documents.formats")}</p>
                </div>
                {uploads.length > 0 && (
                    <ul
                        className="border-line divide-line-2 divide-y rounded-lg border"
                        aria-label={t("documents.added")}
                        aria-live="polite"
                    >
                        {uploads.map(u => (
                            <li key={u.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                                <FileText className="text-ink-3 size-4 shrink-0" aria-hidden />
                                <span className="text-ink min-w-0 flex-1 truncate">{u.name}</span>
                                <span className="text-ink-3 text-xs tabular-nums">
                                    {formatSize(u.size)}
                                </span>
                                <UploadState item={u} />
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            <StepFooter>
                <Button type="button" variant="ghost" onClick={onBack}>
                    {tc("back")}
                </Button>
                <div className="flex-1 max-sm:hidden" />
                <Button type="button" onClick={onContinue} disabled={busy}>
                    {uploads.length ? tc("continue") : t("skipStep")}
                    <ArrowRight className="size-4" />
                </Button>
            </StepFooter>
        </>
    );
}

function UploadState({ item }: { item: UploadItem }) {
    const t = useTranslations("onboarding.flow.upload");
    if (item.state === "uploading")
        return (
            <span className="text-ink-3 inline-flex items-center gap-1 text-xs">
                <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />{" "}
                {t("uploading")}
            </span>
        );
    if (item.state === "failed")
        return (
            <span className="text-danger text-xs" title={item.message}>
                {item.message ? t("failedWith", { message: item.message }) : t("failed")}
            </span>
        );
    return <span className="text-ink-2 text-xs">{t("added")}</span>;
}

// ─── Step 3 ──────────────────────────────────────────────────────────────────

const POLL_MS = 3000;
const SHOWN_FACTS = 8;
const POLL_FOR_MS = 5 * 60 * 1000;

/** Why the profile failed, and that nothing was lost. */
function failureLine(t: FlowT, error: string | null): string {
    const reason = error?.trim();
    if (!reason) return t("understood.profileFailed");
    // The server's reason may end its own sentence; otherwise this one does.
    return /[.!?]$/.test(reason)
        ? t("understood.profileFailedReason", { reason })
        : t("understood.profileFailedReasonStop", { reason });
}

/** For screen readers, as the page updates: how far reading has got. */
function progressLine(t: FlowT, profile: CompanyProfileDto): string {
    const read = profile.sources.filter(s => s.status !== "pending").length;
    const total = profile.sources.length;
    const facts = profile.facts.length;
    return total
        ? t("understood.progress", { read, total, facts })
        : t("understood.progressNoSources", { facts });
}

function sourceState(
    t: FlowT,
    source: ProfileSourceDto
): {
    text: string;
    tone: "wait" | "ok" | "aside" | "bad";
} {
    if (source.status === "failed") return { text: t("sourceState.failed"), tone: "bad" };
    if (source.status === "pending" || source.role === null)
        return { text: t("sourceState.reading"), tone: "wait" };
    if (source.counted)
        return {
            text: source.facts
                ? t("sourceState.aboutYouFacts", { count: source.facts })
                : t("sourceState.aboutYou"),
            tone: "ok",
        };
    return {
        text: source.role === "no_content" ? t("sourceState.nothing") : t("sourceState.setAside"),
        tone: "aside",
    };
}

function UnderstoodStep({
    companyName,
    websiteImport,
    onRetryWebsite,
    uploads,
    onBack,
    onFinish,
}: {
    companyName: string;
    websiteImport: ImportState;
    onRetryWebsite: (url: string) => void;
    uploads: UploadItem[];
    onBack: () => void;
    onFinish: () => void;
}) {
    const t = useTranslations("onboarding.flow");
    const tc = useTranslations("common");
    const [profile, setProfile] = useState<CompanyProfileDto | null>(null);
    const started = useRef(Date.now());

    useEffect(() => {
        let alive = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const tick = async () => {
            try {
                const { profile: next } = await companyProfileApi.get();
                if (!alive) return;
                setProfile(next);
                const waiting =
                    next.status === "building" ||
                    next.sources.some(s => s.status === "pending") ||
                    websiteImport.state === "importing" ||
                    uploads.some(u => u.state === "uploading");
                if (waiting && Date.now() - started.current < POLL_FOR_MS)
                    timer = setTimeout(() => void tick(), POLL_MS);
            } catch {
                if (alive) timer = setTimeout(() => void tick(), POLL_MS * 2);
            }
        };
        void tick();
        return () => {
            alive = false;
            if (timer) clearTimeout(timer);
        };
    }, [websiteImport.state, uploads]);

    const reading = profile?.sources.some(s => s.status === "pending") ?? true;
    // What the person told us first, then the first of what the sources say.
    const all = profile
        ? [
              ...profile.facts.filter(f => f.source === "manual"),
              ...profile.facts.filter(f => f.source !== "manual"),
          ]
        : [];
    const facts = all.slice(
        0,
        Math.max(SHOWN_FACTS, all.filter(f => f.source === "manual").length)
    );
    const more = all.length - facts.length;

    return (
        <>
            <StepHeader title={t("understood.title")}>
                {reading
                    ? t("understood.reading")
                    : t("understood.ready", { company: companyName })}
            </StepHeader>
            <div className="flex flex-col gap-6 px-6 py-6 max-sm:px-4">
                {websiteImport.state !== "idle" && (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Globe className="text-ink-3 size-4" aria-hidden />
                        <span className="text-ink min-w-0 break-all">{websiteImport.url}</span>
                        {websiteImport.state === "importing" && (
                            <span className="text-ink-3 inline-flex items-center gap-1 text-xs">
                                <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
                                {t("understood.importing")}
                            </span>
                        )}
                        {websiteImport.state === "done" && (
                            <span className="text-ink-2 text-xs">{t("understood.imported")}</span>
                        )}
                        {websiteImport.state === "failed" && (
                            <>
                                <span className="text-danger text-xs">
                                    {websiteImport.retry
                                        ? websiteImport.message
                                        : t("understood.importFailedKept", {
                                              message: websiteImport.message,
                                          })}
                                </span>
                                {websiteImport.retry && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => onRetryWebsite(websiteImport.url)}
                                    >
                                        {tc("actions.tryAgain")}
                                    </Button>
                                )}
                            </>
                        )}
                    </div>
                )}

                {profile?.status === "failed" && (
                    <p role="alert" className="text-danger text-sm">
                        {failureLine(t, profile.error)}
                    </p>
                )}

                {profile?.summary ? (
                    <p className="text-ink max-w-[65ch] text-[15px] leading-relaxed">
                        {profile.summary}
                    </p>
                ) : (
                    <p className="text-ink-3 text-sm">
                        {!profile
                            ? tc("status.loading")
                            : profile.status === "building"
                              ? t("understood.writingSummary")
                              : t("understood.noSummary")}
                    </p>
                )}

                <p className="sr-only" aria-live="polite">
                    {profile ? progressLine(t, profile) : ""}
                </p>

                {facts.length > 0 && (
                    <div className="flex flex-col gap-2">
                        <dl
                            className="border-line divide-line-2 divide-y rounded-lg border"
                            aria-label={t("understood.factsLabel")}
                        >
                            {facts.map(f => (
                                <div
                                    key={f.path}
                                    className="grid grid-cols-[150px_minmax(0,1fr)] gap-3 px-3 py-2 max-sm:grid-cols-1 max-sm:gap-0.5"
                                >
                                    <dt className="text-ink-3 text-xs">
                                        {f.label}
                                        {f.source === "manual" && (
                                            <span> {t("understood.fromYou")}</span>
                                        )}
                                    </dt>
                                    <dd className="text-ink break-words text-sm">{f.value}</dd>
                                </div>
                            ))}
                        </dl>
                        {more > 0 && (
                            <Link
                                href="/employer/settings#company"
                                className="text-brand-ink self-start text-xs hover:underline"
                            >
                                {t("understood.moreInProfile", { count: more })}
                            </Link>
                        )}
                    </div>
                )}

                {profile && profile.sources.length > 0 && (
                    <div className="flex flex-col gap-2">
                        <h2 className="text-ink text-sm font-medium">{t("understood.sources")}</h2>
                        <ul
                            className="border-line divide-line-2 divide-y rounded-lg border"
                            aria-label={t("understood.sourcesLabel")}
                        >
                            {profile.sources.map(s => {
                                const st = sourceState(t, s);
                                return (
                                    <li
                                        key={s.documentId}
                                        className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-sm"
                                    >
                                        <span className="text-ink min-w-0 flex-1 truncate">
                                            {s.title}
                                        </span>
                                        <span
                                            className={cn(
                                                "inline-flex items-center gap-1 text-xs",
                                                st.tone === "wait" && "text-ink-3",
                                                st.tone === "ok" && "text-brand-ink",
                                                st.tone === "aside" && "text-ink-3",
                                                st.tone === "bad" && "text-danger"
                                            )}
                                        >
                                            {st.tone === "wait" && (
                                                <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
                                            )}
                                            {st.text}
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                )}

                <div className="flex flex-col gap-2">
                    <h2 className="text-ink text-sm font-medium">{t("understood.then")}</h2>
                    <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
                        <NextTile
                            href="/employer/documents?feature=chat"
                            Icon={MessageSquare}
                            title={t("understood.tiles.ask.title")}
                            text={t("understood.tiles.ask.text")}
                        />
                        <NextTile
                            href="/employer/documents?feature=proposals"
                            Icon={FileText}
                            title={t("understood.tiles.proposal.title")}
                            text={t("understood.tiles.proposal.text")}
                        />
                        <NextTile
                            href="/employer/documents?feature=growth&at=%2Fprospects"
                            Icon={Search}
                            title={t("understood.tiles.buyers.title")}
                            text={t("understood.tiles.buyers.text")}
                        />
                    </div>
                </div>
            </div>
            <StepFooter>
                <Button type="button" variant="ghost" onClick={onBack}>
                    {tc("actions.back")}
                </Button>
                <div className="flex-1 max-sm:hidden" />
                <Button asChild variant="outline">
                    <Link href="/employer/settings#company">{t("understood.review")}</Link>
                </Button>
                <Button type="button" onClick={onFinish}>
                    {t("understood.open")}
                    <ArrowRight className="size-4" />
                </Button>
            </StepFooter>
        </>
    );
}

function NextTile({
    href,
    Icon,
    title,
    text,
}: {
    href: string;
    Icon: React.ComponentType<{ className?: string }>;
    title: string;
    text: string;
}) {
    return (
        <Link
            href={href}
            className="border-line hover:border-brand focus-visible:ring-brand/50 flex flex-col gap-1.5 rounded-lg border p-3 outline-none focus-visible:ring-2"
        >
            <Icon className="text-brand-ink size-4" />
            <span className="text-ink text-sm font-medium">{title}</span>
            <span className="text-ink-3 text-xs leading-relaxed">{text}</span>
        </Link>
    );
}

/** Someone without settings.manage: the profile is the admins' to set up. */
function ReadOnly({ companyName, onLeave }: { companyName: string; onLeave: () => void }) {
    const t = useTranslations("onboarding.flow");
    return (
        <div className="mx-auto flex w-full max-w-[680px] flex-col gap-5">
            <section className="border-line bg-panel rounded-lg border">
                <StepHeader title={t("readOnly.title", { company: companyName })}>
                    {t("readOnly.body")}
                </StepHeader>
                <div className="h-6" />
                <StepFooter>
                    <Button asChild variant="outline">
                        <Link href="/employer/settings#company">{t("readOnly.see")}</Link>
                    </Button>
                    <div className="flex-1 max-sm:hidden" />
                    <Button type="button" onClick={onLeave}>
                        {t("understood.open")}
                        <ArrowRight className="size-4" />
                    </Button>
                </StepFooter>
            </section>
        </div>
    );
}
