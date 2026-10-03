"use client";

import { ArrowRight, FileText, FileUp, Globe, Loader2, MessageSquare, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

const INDUSTRIES = [
    "Technology",
    "Healthcare",
    "Finance",
    "Legal",
    "Education",
    "Manufacturing",
    "Retail",
    "Government",
    "Non-profit",
    "Other",
] as const;

const STEPS = ["Your company", "Documents", "What we understood"] as const;
type Step = 0 | 1 | 2;

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
function hint(value: string | null | undefined): string | null {
    if (!value) return null;
    const short = value.length > 140 ? `${value.slice(0, 139)}…` : value;
    return `From your sources: ${short}`;
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

    const importWebsite = useCallback(async (url: string) => {
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
                    message: body.error ?? `The page could not be fetched (HTTP ${res.status})`,
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
                message: errorText(e, "Import failed"),
                retry: true,
            });
        }
    }, []);

    const saveCompany = async () => {
        const website = answers.website.trim();
        const normalized = website ? normalizeWebsite(website) : null;
        if (website && !normalized) {
            setSaveError("That doesn't look like a web address. Try something like acme.com.");
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
                    throw new Error(body.error ?? "Saving failed");
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
            setSaveError(errorText(e, "Saving failed"));
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
                                ? { ...u, state: "failed", message: errorText(e, "Upload failed") }
                                : u
                        )
                    );
                }
            })();
        }
    };

    const companyName = name ?? "your company";

    // Nothing until it is known who is asking: a member must not see the admin's form flash by.
    if (!loaded)
        return (
            <div className="text-ink-3 mx-auto w-full max-w-[680px] py-10 text-sm" aria-busy="true">
                Loading…
            </div>
        );
    if (known && !known.canEdit) return <ReadOnly companyName={companyName} onLeave={leave} />;

    return (
        <div className="mx-auto flex w-full max-w-[680px] flex-col gap-5">
            <div className="flex flex-col gap-2">
                <div className="text-ink-3 flex items-center justify-between gap-3 text-xs">
                    <span>
                        Step {step + 1} of {STEPS.length} · {STEPS[step]}
                    </span>
                    <Button variant="ghost" size="sm" onClick={leave}>
                        Skip setup
                    </Button>
                </div>
                <Progress value={((step + 1) / STEPS.length) * 100} aria-label="Setup progress" />
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
    return (
        <form
            onSubmit={e => {
                e.preventDefault();
                onContinue();
            }}
        >
            <StepHeader title={`Tell us about ${companyName}`}>
                We read your website and documents and build a profile of the company that every
                tool here uses: chat answers, proposals, outreach. What you write here is kept as
                your own facts; you can change any of it later in Settings › Company.
            </StepHeader>
            <div className="flex flex-col gap-5 px-6 py-6 max-sm:px-4">
                <div className="grid gap-1.5">
                    <Label htmlFor="onboarding-website">Website</Label>
                    <Input
                        id="onboarding-website"
                        inputMode="url"
                        autoComplete="url"
                        placeholder={hint(fromSources?.website) ?? "acme.com"}
                        value={answers.website}
                        onChange={e => onChange({ website: e.target.value })}
                        maxLength={MAX_WEBSITE}
                        disabled={!loaded}
                    />
                    <p className="text-ink-3 text-xs">
                        {homepageIsSource
                            ? "Your homepage is already a source; it is not imported again."
                            : "We import your homepage as a source, so the profile can quote it."}
                    </p>
                </div>
                <div className="grid gap-1.5">
                    <Label htmlFor="onboarding-description">What does the company do?</Label>
                    <Textarea
                        id="onboarding-description"
                        rows={3}
                        placeholder={
                            hint(fromSources?.description) ??
                            "A sentence or two: what you offer and to whom."
                        }
                        value={answers.description}
                        onChange={e => onChange({ description: e.target.value })}
                        maxLength={MAX_TEXT}
                        disabled={!loaded}
                    />
                </div>
                <div className="grid gap-1.5">
                    <Label htmlFor="onboarding-idea">
                        What&rsquo;s the idea you&rsquo;re working on?
                    </Label>
                    <Textarea
                        id="onboarding-idea"
                        rows={3}
                        placeholder="What you're building, for whom, and why now."
                        value={answers.idea}
                        onChange={e => onChange({ idea: e.target.value })}
                        maxLength={MAX_TEXT}
                        disabled={!loaded}
                    />
                </div>
                <div className="grid gap-1.5">
                    <Label htmlFor="onboarding-industry">Industry</Label>
                    <Select
                        value={answers.industry}
                        onValueChange={value => onChange({ industry: value })}
                        disabled={!loaded}
                    >
                        <SelectTrigger id="onboarding-industry" className="w-full max-w-xs">
                            <SelectValue placeholder="Choose one (optional)" />
                        </SelectTrigger>
                        <SelectContent>
                            {INDUSTRIES.map(industry => (
                                <SelectItem key={industry} value={industry}>
                                    {industry}
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
                    Skip this step
                </Button>
                <div className="flex-1 max-sm:hidden" />
                <Button type="submit" disabled={saving || !loaded}>
                    {saving && (
                        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                    )}
                    Continue
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
    const input = useRef<HTMLInputElement>(null);
    const [over, setOver] = useState(false);
    const busy = uploads.some(u => u.state === "uploading");

    return (
        <>
            <StepHeader title="Add documents about the company">
                A pitch deck, one-pager, plan, past proposal or report. Only documents written by or
                about {companyName} count toward its profile; anything else you add later is kept
                for search and set aside, and each source says why.
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
                    <p className="text-ink-2 text-sm">Drop files here, or</p>
                    <Button type="button" variant="outline" onClick={() => input.current?.click()}>
                        Choose files
                    </Button>
                    <input
                        ref={input}
                        id="onboarding-files"
                        type="file"
                        multiple
                        className="sr-only"
                        aria-label="Choose documents about the company"
                        accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.md,.markdown,.txt,.html,.htm,.csv"
                        onChange={e => {
                            onFiles(Array.from(e.target.files ?? []));
                            e.target.value = "";
                        }}
                    />
                    <p className="text-ink-3 text-xs">PDF, Word, PowerPoint, Markdown or text</p>
                </div>
                {uploads.length > 0 && (
                    <ul
                        className="border-line divide-line-2 divide-y rounded-lg border"
                        aria-label="Added documents"
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
                    Back
                </Button>
                <div className="flex-1 max-sm:hidden" />
                <Button type="button" onClick={onContinue} disabled={busy}>
                    {uploads.length ? "Continue" : "Skip this step"}
                    <ArrowRight className="size-4" />
                </Button>
            </StepFooter>
        </>
    );
}

function UploadState({ item }: { item: UploadItem }) {
    if (item.state === "uploading")
        return (
            <span className="text-ink-3 inline-flex items-center gap-1 text-xs">
                <Loader2 className="size-3 animate-spin motion-reduce:animate-none" /> Uploading
            </span>
        );
    if (item.state === "failed")
        return (
            <span className="text-danger text-xs" title={item.message}>
                Failed{item.message ? `: ${item.message}` : ""}
            </span>
        );
    return <span className="text-ink-2 text-xs">Added</span>;
}

// ─── Step 3 ──────────────────────────────────────────────────────────────────

const POLL_MS = 3000;
const SHOWN_FACTS = 8;
const POLL_FOR_MS = 5 * 60 * 1000;

function failureLine(error: string | null): string {
    const reason = error?.trim();
    if (!reason) return "The profile could not be built.";
    return `The profile could not be built: ${reason}${/[.!?]$/.test(reason) ? "" : "."}`;
}

/** For screen readers, as the page updates: how far reading has got. */
function progressLine(profile: CompanyProfileDto): string {
    const read = profile.sources.filter(s => s.status !== "pending").length;
    const total = profile.sources.length;
    const facts = profile.facts.length;
    const sources = total ? `${read} of ${total} sources read. ` : "";
    return `${sources}${facts} ${facts === 1 ? "fact" : "facts"} so far.`;
}

function sourceState(source: ProfileSourceDto): {
    text: string;
    tone: "wait" | "ok" | "aside" | "bad";
} {
    if (source.status === "failed") return { text: "Could not be read", tone: "bad" };
    if (source.status === "pending" || source.role === null)
        return { text: "Reading…", tone: "wait" };
    if (source.counted)
        return {
            text: source.facts
                ? `About you · ${source.facts} fact${source.facts === 1 ? "" : "s"}`
                : "About you",
            tone: "ok",
        };
    return { text: source.role === "no_content" ? "Nothing to read" : "Set aside", tone: "aside" };
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
            <StepHeader title="Here's what we understood so far">
                {reading
                    ? "Your sources are being read now. This page updates as they are, and you can leave at any time: the profile keeps building."
                    : `This is the profile of ${companyName} as your sources and answers stand. Add documents any time and it grows.`}
            </StepHeader>
            <div className="flex flex-col gap-6 px-6 py-6 max-sm:px-4">
                {websiteImport.state !== "idle" && (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Globe className="text-ink-3 size-4" aria-hidden />
                        <span className="text-ink min-w-0 break-all">{websiteImport.url}</span>
                        {websiteImport.state === "importing" && (
                            <span className="text-ink-3 inline-flex items-center gap-1 text-xs">
                                <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
                                Importing the homepage
                            </span>
                        )}
                        {websiteImport.state === "done" && (
                            <span className="text-ink-2 text-xs">Homepage imported</span>
                        )}
                        {websiteImport.state === "failed" && (
                            <>
                                <span className="text-danger text-xs">
                                    {websiteImport.message}
                                    {!websiteImport.retry &&
                                        ". It stays your website; change it in Settings › Company."}
                                </span>
                                {websiteImport.retry && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => onRetryWebsite(websiteImport.url)}
                                    >
                                        Try again
                                    </Button>
                                )}
                            </>
                        )}
                    </div>
                )}

                {profile?.status === "failed" && (
                    <p role="alert" className="text-danger text-sm">
                        {failureLine(profile.error)} Your answers and sources are kept; rebuild it
                        from the company profile.
                    </p>
                )}

                {profile?.summary ? (
                    <p className="text-ink max-w-[65ch] text-[15px] leading-relaxed">
                        {profile.summary}
                    </p>
                ) : (
                    <p className="text-ink-3 text-sm">
                        {!profile
                            ? "Loading…"
                            : profile.status === "building"
                              ? "Writing the summary…"
                              : "No summary yet. It is written from your sources: add your website or a document about the company."}
                    </p>
                )}

                <p className="sr-only" aria-live="polite">
                    {profile ? progressLine(profile) : ""}
                </p>

                {facts.length > 0 && (
                    <div className="flex flex-col gap-2">
                        <dl
                            className="border-line divide-line-2 divide-y rounded-lg border"
                            aria-label="Facts so far"
                        >
                            {facts.map(f => (
                                <div
                                    key={f.path}
                                    className="grid grid-cols-[150px_minmax(0,1fr)] gap-3 px-3 py-2 max-sm:grid-cols-1 max-sm:gap-0.5"
                                >
                                    <dt className="text-ink-3 text-xs">
                                        {f.label}
                                        {f.source === "manual" && <span> · from you</span>}
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
                                {more} more in the company profile
                            </Link>
                        )}
                    </div>
                )}

                {profile && profile.sources.length > 0 && (
                    <div className="flex flex-col gap-2">
                        <h2 className="text-ink text-sm font-medium">Sources</h2>
                        <ul
                            className="border-line divide-line-2 divide-y rounded-lg border"
                            aria-label="Sources being read"
                        >
                            {profile.sources.map(s => {
                                const st = sourceState(s);
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
                    <h2 className="text-ink text-sm font-medium">Then try</h2>
                    <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
                        <NextTile
                            href="/employer/documents?feature=chat"
                            Icon={MessageSquare}
                            title="Ask your sources"
                            text="Answers cite the exact passage they come from."
                        />
                        <NextTile
                            href="/employer/documents?feature=proposals"
                            Icon={FileText}
                            title="Write a proposal"
                            text="Drafts grant and funding applications from the profile."
                        />
                        <NextTile
                            href="/employer/documents?feature=growth&at=%2Fprospects"
                            Icon={Search}
                            title="Find buyers"
                            text="Searches for companies that match what you sell."
                        />
                    </div>
                </div>
            </div>
            <StepFooter>
                <Button type="button" variant="ghost" onClick={onBack}>
                    Back
                </Button>
                <div className="flex-1 max-sm:hidden" />
                <Button asChild variant="outline">
                    <Link href="/employer/settings#company">Review the company profile</Link>
                </Button>
                <Button type="button" onClick={onFinish}>
                    Open your workspace
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
    return (
        <div className="mx-auto flex w-full max-w-[680px] flex-col gap-5">
            <section className="border-line bg-panel rounded-lg border">
                <StepHeader title={`Setting up ${companyName}`}>
                    A workspace admin tells the profile about the company: its website, what it does
                    and the documents about it. You can read the profile and ask questions of
                    everything in the workspace.
                </StepHeader>
                <div className="h-6" />
                <StepFooter>
                    <Button asChild variant="outline">
                        <Link href="/employer/settings#company">See the company profile</Link>
                    </Button>
                    <div className="flex-1 max-sm:hidden" />
                    <Button type="button" onClick={onLeave}>
                        Open your workspace
                        <ArrowRight className="size-4" />
                    </Button>
                </StepFooter>
            </section>
        </div>
    );
}
