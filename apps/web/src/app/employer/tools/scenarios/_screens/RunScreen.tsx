"use client";

import { Check, Pencil, Trash2, X } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ToolNotFound } from "~/components/tool-app/ToolFrame";
import { ToolLink } from "~/components/tool-app/ToolLink";
import { useToolNav } from "~/components/tool-app/nav";
import { InlineError } from "~/components/tools/EmptyState";
import { SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonBlock, SkeletonRows } from "~/components/tools/SkeletonRows";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Progress } from "~/components/ui/progress";
import { Switch } from "~/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Textarea } from "~/components/ui/textarea";
import { SCENARIO_LIMITS, type ScenarioDetail } from "~/lib/scenarios/types";
import { useResource } from "~/lib/tools/useResource";
import { cn } from "~/lib/utils";

import { scenariosApi } from "../api";
import { AskTab } from "../_components/AskTab";
import { StatusPill } from "../_components/Bits";
import { FeedTab } from "../_components/FeedTab";
import { PeopleTab } from "../_components/PeopleTab";
import { PersonSheet } from "../_components/PersonSheet";
import { ReportTab } from "../_components/ReportTab";
import { SourcesTab } from "../_components/SourcesTab";
import { useScenarios } from "../_lib/context";
import { runPath, type RunTab, type ScenariosScreen } from "../_lib/screens";
import { isLive, progressLabel, progressValue, sizeLabel } from "~/lib/scenarios/words";

type RunScreenProps = { screen: Extract<ScenariosScreen, { kind: "run" }> };

/**
 * One scenario: what it is about and where it stands, the creator's controls
 * (rename, share, cancel, add an event, delete), and five views of the same
 * run — Report, Feed, People, Ask, Sources. Polls every two seconds while it
 * runs; the sub-tab, a post jumped to and an open person are in the tab's
 * location, so Back and a shared link both land on them.
 */
export function RunScreen({ screen }: RunScreenProps) {
    const t = useTranslations("scenarios.run");
    const tt = useTranslations("scenarios.tool");
    const { navigate } = useToolNav();
    const { list } = useScenarios();
    const [polling, setPolling] = useState(true);
    const res = useResource(`scenario:${screen.id}`, () => scenariosApi.get(screen.id), {
        pollMs: polling ? 2000 : null,
    });
    const run = res.data?.run ?? null;
    const live = run ? isLive(run.status) : true;
    const reloadList = list.reload;

    // Stop polling once it ends, and tell the list (which may still show it running).
    const wasLive = useRef<boolean | null>(null);
    useEffect(() => {
        if (!run) return;
        setPolling(live);
        if (wasLive.current === true && !live) void reloadList();
        wasLive.current = live;
    }, [run, live, reloadList]);

    const interviewsRes = useResource(`scenario:${screen.id}:interviews`, () =>
        scenariosApi.interviews(screen.id)
    );
    const interviews = interviewsRes.data?.interviews ?? [];
    const ask = async (agentId: string, question: string) => {
        const { interview } = await scenariosApi.ask(screen.id, agentId, question);
        interviewsRes.mutate(current => ({ interviews: [...current.interviews, interview] }));
    };

    if (res.errorStatus === 404) {
        return (
            <ToolNotFound
                home="/runs"
                homeLabel={tt("title")}
                title={t("notFoundTitle")}
                body={t("notFoundBody")}
            />
        );
    }
    if (!run) {
        return (
            <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
                {res.error ? (
                    <InlineError message={res.error} onRetry={() => void res.reload()} />
                ) : (
                    <>
                        <SkeletonBlock lines={3} className="max-w-[640px]" />
                        <SkeletonRows rows={4} height={64} />
                    </>
                )}
            </div>
        );
    }

    const tab: RunTab = screen.tab ?? "report";
    const go = (query: Record<string, string | null>, replace = true) =>
        navigate(runPath(run.id, query), { replace });
    const setTab = (next: RunTab) => go({ tab: next });
    const jumpToPost = (postId: string) => go({ tab: "feed", post: postId }, false);
    const openPerson = (personId: string) => go({ tab, person: personId });
    const closePerson = () => go({ tab });
    const openSource = (sourceId: string) => go({ tab: "sources", source: sourceId });

    return (
        <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
            <RunHeader run={run} onChanged={() => void res.reload()} onReloadList={reloadList} />

            {res.error && (
                <InlineError
                    message={t("refreshError", { error: res.error })}
                    onRetry={() => void res.reload()}
                />
            )}

            {run.status === "failed" && (
                <div
                    role="alert"
                    className="border-danger/40 bg-danger-soft flex flex-col items-start gap-2 rounded-lg border px-4 py-3"
                >
                    <div className="text-danger text-sm font-medium">{t("failedTitle")}</div>
                    {run.error && <p className="text-ink-2 text-[13px]">{run.error}</p>}
                    <Button asChild size="sm" variant="outline">
                        <ToolLink href="/new">{t("startNew")}</ToolLink>
                    </Button>
                </div>
            )}
            {run.status === "cancelled" && (
                <p className="text-ink-2 text-[13px]">
                    {run.round > 0
                        ? t("cancelledAfter", { round: run.round })
                        : t("cancelledBefore")}
                </p>
            )}

            {run.canManage && live && <EventBox run={run} onAdded={() => void res.reload()} />}

            <Tabs value={tab} onValueChange={v => setTab(v as RunTab)} className="gap-5">
                <TabsList className="@max-sm:w-full max-w-full justify-start overflow-x-auto">
                    <TabsTrigger
                        value="report"
                        className="@max-sm:flex-1 @max-sm:px-1.5 flex-none px-3"
                    >
                        {t("tabs.report")}
                    </TabsTrigger>
                    <TabsTrigger
                        value="feed"
                        className="@max-sm:flex-1 @max-sm:px-1.5 flex-none px-3"
                    >
                        {t("tabs.feed")}
                        {run.posts.length > 0 && (
                            <span className="text-ink-3 @max-sm:hidden font-mono text-[11px] tabular-nums">
                                {run.posts.length}
                            </span>
                        )}
                    </TabsTrigger>
                    <TabsTrigger
                        value="people"
                        className="@max-sm:flex-1 @max-sm:px-1.5 flex-none px-3"
                    >
                        {t("tabs.people")}
                        {run.people.length > 0 && (
                            <span className="text-ink-3 @max-sm:hidden font-mono text-[11px] tabular-nums">
                                {run.people.length}
                            </span>
                        )}
                    </TabsTrigger>
                    <TabsTrigger
                        value="ask"
                        className="@max-sm:flex-1 @max-sm:px-1.5 flex-none px-3"
                    >
                        {t("tabs.ask")}
                    </TabsTrigger>
                    <TabsTrigger
                        value="sources"
                        className="@max-sm:flex-1 @max-sm:px-1.5 flex-none px-3"
                    >
                        {t("tabs.sources")}
                        {run.sources.length > 0 && (
                            <span className="text-ink-3 @max-sm:hidden font-mono text-[11px] tabular-nums">
                                {run.sources.length}
                            </span>
                        )}
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="report">
                    <ReportTab run={run} onJump={jumpToPost} onPerson={openPerson} />
                </TabsContent>
                <TabsContent value="feed">
                    <FeedTab run={run} focusPost={screen.post} onPerson={openPerson} />
                </TabsContent>
                <TabsContent value="people">
                    <PeopleTab run={run} onPerson={openPerson} />
                </TabsContent>
                <TabsContent value="ask">
                    <AskTab
                        run={run}
                        interviews={interviews}
                        interviewsError={interviewsRes.error}
                        onAsk={ask}
                    />
                </TabsContent>
                <TabsContent value="sources">
                    <SourcesTab run={run} focusSource={screen.source} onPerson={openPerson} />
                </TabsContent>
            </Tabs>

            <PersonSheet
                run={run}
                personId={screen.person}
                interviews={interviews}
                onClose={closePerson}
                onJump={jumpToPost}
                onSource={openSource}
                onAsk={ask}
            />
        </div>
    );
}

function RunHeader({
    run,
    onChanged,
    onReloadList,
}: {
    run: ScenarioDetail;
    onChanged: () => void;
    onReloadList: () => Promise<void>;
}) {
    const t = useTranslations("scenarios.run");
    const tw = useTranslations("scenarios.words");
    const tc = useTranslations("common");
    const format = useFormatter();
    const now = useNow();
    const { navigate } = useToolNav();
    const live = isLive(run.status);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(run.title);
    const [saving, setSaving] = useState(false);
    const [shared, setShared] = useState(run.shared);
    const [confirm, setConfirm] = useState<"cancel" | "delete" | null>(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => setShared(run.shared), [run.shared]);

    const rename = async () => {
        const title = draft.trim();
        if (!title || title === run.title) {
            setEditing(false);
            return;
        }
        setSaving(true);
        try {
            await scenariosApi.patch(run.id, { title });
            setEditing(false);
            onChanged();
            void onReloadList();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t("renameError"));
        } finally {
            setSaving(false);
        }
    };

    const share = async (next: boolean) => {
        setShared(next);
        try {
            await scenariosApi.patch(run.id, { shared: next });
            toast(next ? t("sharedToast") : t("privateToast"));
            onChanged();
            void onReloadList();
        } catch (e) {
            setShared(!next);
            toast.error(e instanceof Error ? e.message : t("sharingError"));
        }
    };

    const act = async () => {
        const which = confirm;
        setBusy(true);
        try {
            if (which === "cancel") {
                await scenariosApi.cancel(run.id);
                toast(t("cancelledToast"));
                onChanged();
            } else if (which === "delete") {
                await scenariosApi.remove(run.id);
                toast(t("deletedToast"));
                navigate("/runs", { replace: true });
            }
            void onReloadList();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t("actionError"));
        } finally {
            setBusy(false);
            setConfirm(null);
        }
    };

    return (
        <header className="flex flex-col gap-3">
            <div className="@max-md:flex-col @max-md:items-stretch flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                    {editing ? (
                        <form
                            className="flex max-w-[640px] items-center gap-2"
                            onSubmit={e => {
                                e.preventDefault();
                                void rename();
                            }}
                        >
                            <Input
                                autoFocus
                                value={draft}
                                onChange={e => setDraft(e.target.value)}
                                maxLength={120}
                                aria-label={tc("fields.title")}
                                className="text-lg"
                                onKeyDown={e => {
                                    if (e.key === "Escape") setEditing(false);
                                }}
                            />
                            <Button
                                type="submit"
                                size="icon"
                                variant="outline"
                                aria-label={t("saveTitle")}
                                disabled={saving}
                            >
                                <Check aria-hidden />
                            </Button>
                            <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                aria-label={t("keepTitle")}
                                onClick={() => setEditing(false)}
                            >
                                <X aria-hidden />
                            </Button>
                        </form>
                    ) : (
                        <div className="flex items-start gap-1.5">
                            <h1 className="display text-ink @max-md:text-[24px] text-balance text-[28px] leading-[1.1] tracking-[-0.02em]">
                                {run.title}
                            </h1>
                            {run.canManage && (
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    className="text-ink-3 mt-0.5 size-8 shrink-0"
                                    aria-label={tc("actions.rename")}
                                    onClick={() => {
                                        setDraft(run.title);
                                        setEditing(true);
                                    }}
                                >
                                    <Pencil className="size-3.5" aria-hidden />
                                </Button>
                            )}
                        </div>
                    )}
                    {/* A title that is the whole situation would repeat it word for word. */}
                    {(run.kind === "post_test" || run.subject !== run.title) && (
                        <SituationText
                            lead={run.kind === "post_test" ? t("draftTested") : t("whatHappensIf")}
                            text={
                                run.kind === "post_test"
                                    ? (run.draft?.text ?? run.subject)
                                    : run.subject
                            }
                        />
                    )}
                    <div className="text-ink-3 mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                        <StatusPill run={run} />
                        <span aria-hidden>·</span>
                        <span>{sizeLabel(tw, run)}</span>
                        <span aria-hidden>·</span>
                        <span>
                            {t("createdBy", {
                                name: run.createdByMe ? t("you") : run.createdByName,
                                when: format.relativeTime(new Date(run.createdAt), now),
                            })}
                        </span>
                        {run.shared && (
                            <Badge variant="secondary" className="ml-1">
                                {t("shared")}
                            </Badge>
                        )}
                    </div>
                </div>
                {run.canManage && (
                    <div className="@max-md:justify-start flex shrink-0 flex-wrap items-center justify-end gap-2">
                        <span className="flex items-center gap-2 pr-1">
                            <Switch
                                id={`scenario-share-${run.id}`}
                                checked={shared}
                                onCheckedChange={v => void share(v)}
                            />
                            <Label
                                htmlFor={`scenario-share-${run.id}`}
                                className="text-ink-2 text-xs font-normal"
                            >
                                {t("shareLabel")}
                            </Label>
                        </span>
                        {live && (
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setConfirm("cancel")}
                            >
                                {t("cancelRun")}
                            </Button>
                        )}
                        <Button
                            size="sm"
                            variant="ghost"
                            className="text-danger hover:text-danger"
                            onClick={() => setConfirm("delete")}
                        >
                            <Trash2 aria-hidden />
                            {tc("actions.delete")}
                        </Button>
                    </div>
                )}
            </div>

            {live && (
                <div className="flex max-w-[640px] flex-col gap-1.5" aria-live="polite">
                    <div className="text-ink-2 flex items-baseline justify-between text-xs">
                        <span>{progressLabel(tw, run)}</span>
                        <span className="text-ink-3 tabular-nums">
                            {t("roundsDone", { round: run.round, rounds: run.rounds })}
                        </span>
                    </div>
                    <Progress value={progressValue(run)} className="h-1.5" />
                </div>
            )}

            <p className="text-ink-3 text-xs">{tw("caveat")}</p>

            <ConfirmDialog
                open={confirm !== null}
                onOpenChange={open => !open && !busy && setConfirm(null)}
                title={confirm === "cancel" ? t("confirmCancelTitle") : t("confirmDeleteTitle")}
                description={confirm === "cancel" ? t("confirmCancelBody") : t("confirmDeleteBody")}
                confirmLabel={confirm === "cancel" ? t("cancelRun") : tc("actions.delete")}
                cancelLabel={confirm === "cancel" ? t("keepRunning") : t("keepIt")}
                destructive
                onConfirm={() => void act()}
            />
        </header>
    );
}

/** While it runs, the creator can drop something into the next round. */
/** The situation as written; a long one (a plan, its actions, the current cases) opens on request. */
function SituationText({ lead, text }: { lead: string; text: string }) {
    const t = useTranslations("scenarios.run");
    const tc = useTranslations("common");
    const [open, setOpen] = useState(false);
    const long = text.length > 320 || text.split("\n").length > 3;
    return (
        <div className="mt-2 max-w-[75ch]">
            <p
                className={cn(
                    "text-ink-2 text-[13.5px] leading-relaxed",
                    // Closed, paragraphs run on so three lines hold text, not blank breaks.
                    long && !open ? "line-clamp-3" : "whitespace-pre-line"
                )}
            >
                <span className="text-ink-3">{lead} </span>
                {text}
            </p>
            {long && (
                <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto px-0 py-0.5 text-xs"
                    aria-expanded={open}
                    onClick={() => setOpen(o => !o)}
                >
                    {open ? tc("actions.showLess") : t("showSituation")}
                </Button>
            )}
        </div>
    );
}

function EventBox({ run, onAdded }: { run: ScenarioDetail; onAdded: () => void }) {
    const t = useTranslations("scenarios.run");
    const [text, setText] = useState("");
    const [adding, setAdding] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const max = SCENARIO_LIMITS.eventMax;
    const closed = !run.eventsOpen;

    const add = async () => {
        setAdding(true);
        setError(null);
        try {
            await scenariosApi.addEvent(run.id, text.trim());
            setText("");
            onAdded();
        } catch (e) {
            setError(e instanceof Error ? e.message : t("addEventError"));
        } finally {
            setAdding(false);
        }
    };

    return (
        <section className="border-line bg-panel flex flex-col gap-3 rounded-lg border p-4">
            <SectionHeading
                title={t("addEventTitle")}
                aside={closed ? t("eventsClosed") : t("eventsOpen")}
                className="mb-0"
            />
            <Textarea
                value={text}
                onChange={e => setText(e.target.value)}
                rows={2}
                maxLength={max}
                disabled={closed || adding}
                aria-label={t("eventLabel")}
                placeholder={t("eventPlaceholder")}
                className="text-[13px]"
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Button
                    size="sm"
                    variant="outline"
                    disabled={closed || adding || !text.trim()}
                    onClick={() => void add()}
                >
                    {adding ? t("adding") : t("addEvent")}
                </Button>
                <span className="text-ink-3 @max-sm:hidden font-mono text-[11px] tabular-nums">
                    {text.length}/{max}
                </span>
                {error && (
                    <span role="alert" className="text-danger text-xs">
                        {error}
                    </span>
                )}
            </div>
            {run.injections.length > 0 && (
                <ul className="border-line-2 flex flex-col gap-1.5 border-t pt-3">
                    {run.injections.map(i => (
                        <li
                            key={i.id}
                            className="flex items-baseline justify-between gap-3 text-[13px]"
                        >
                            <span className="text-ink-2 min-w-0">{i.text}</span>
                            <span
                                className={cn(
                                    "shrink-0 text-xs",
                                    i.round === null ? "text-warn" : "text-ink-3"
                                )}
                            >
                                {i.round === null
                                    ? t("injectionPending")
                                    : t("injectionRound", { round: i.round })}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
