"use client";

import { Check, Pencil, Trash2, X } from "lucide-react";
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
import { SCENARIO_CAVEAT, SCENARIO_LIMITS, type ScenarioDetail } from "~/lib/scenarios/types";
import { relativeTime } from "~/lib/tools/format";
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
import { isLive, progressValue, progressWords, sizeWords } from "~/lib/scenarios/words";

type RunScreenProps = { screen: Extract<ScenariosScreen, { kind: "run" }> };

/**
 * One scenario: what it is about and where it stands, the creator's controls
 * (rename, share, cancel, add an event, delete), and five views of the same
 * run — Report, Feed, People, Ask, Sources. Polls every two seconds while it
 * runs; the sub-tab, a post jumped to and an open person are in the tab's
 * location, so Back and a shared link both land on them.
 */
export function RunScreen({ screen }: RunScreenProps) {
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
                homeLabel="Scenarios"
                title="This scenario is not here any more"
                body="It may have been deleted, or it was not shared with the workspace."
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
                    message={`Could not refresh: ${res.error}`}
                    onRetry={() => void res.reload()}
                />
            )}

            {run.status === "failed" && (
                <div
                    role="alert"
                    className="border-danger/40 bg-danger-soft flex flex-col items-start gap-2 rounded-lg border px-4 py-3"
                >
                    <div className="text-danger text-sm font-medium">This scenario failed</div>
                    {run.error && <p className="text-ink-2 text-[13px]">{run.error}</p>}
                    <Button asChild size="sm" variant="outline">
                        <ToolLink href="/new">Start a new scenario</ToolLink>
                    </Button>
                </div>
            )}
            {run.status === "cancelled" && (
                <p className="text-ink-2 text-[13px]">
                    Cancelled{" "}
                    {run.round > 0 ? `after round ${run.round}` : "before the first round"}. What
                    happened up to then is below.
                </p>
            )}

            {run.canManage && live && <EventBox run={run} onAdded={() => void res.reload()} />}

            <Tabs value={tab} onValueChange={v => setTab(v as RunTab)} className="gap-5">
                <TabsList className="@max-sm:w-full max-w-full justify-start overflow-x-auto">
                    <TabsTrigger
                        value="report"
                        className="@max-sm:flex-1 @max-sm:px-1.5 flex-none px-3"
                    >
                        Report
                    </TabsTrigger>
                    <TabsTrigger
                        value="feed"
                        className="@max-sm:flex-1 @max-sm:px-1.5 flex-none px-3"
                    >
                        Feed
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
                        People
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
                        Ask
                    </TabsTrigger>
                    <TabsTrigger
                        value="sources"
                        className="@max-sm:flex-1 @max-sm:px-1.5 flex-none px-3"
                    >
                        Sources
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
                    <SourcesTab run={run} focusSource={screen.source} />
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
            toast.error(e instanceof Error ? e.message : "Could not rename it");
        } finally {
            setSaving(false);
        }
    };

    const share = async (next: boolean) => {
        setShared(next);
        try {
            await scenariosApi.patch(run.id, { shared: next });
            toast(next ? "Shared with the workspace" : "Only you can see it now");
            onChanged();
            void onReloadList();
        } catch (e) {
            setShared(!next);
            toast.error(e instanceof Error ? e.message : "Could not change sharing");
        }
    };

    const act = async () => {
        const which = confirm;
        setBusy(true);
        try {
            if (which === "cancel") {
                await scenariosApi.cancel(run.id);
                toast("Scenario cancelled. Rounds that finished are kept.");
                onChanged();
            } else if (which === "delete") {
                await scenariosApi.remove(run.id);
                toast("Scenario deleted");
                navigate("/runs", { replace: true });
            }
            void onReloadList();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "That did not work");
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
                                aria-label="Title"
                                className="text-lg"
                                onKeyDown={e => {
                                    if (e.key === "Escape") setEditing(false);
                                }}
                            />
                            <Button
                                type="submit"
                                size="icon"
                                variant="outline"
                                aria-label="Save title"
                                disabled={saving}
                            >
                                <Check aria-hidden />
                            </Button>
                            <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                aria-label="Keep the old title"
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
                                    aria-label="Rename"
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
                    {/* A title taken from the situation would repeat it word for word. */}
                    {(run.kind === "post_test" || !run.subject.startsWith(run.title)) && (
                        <p className="text-ink-2 mt-2 max-w-[75ch] text-[13.5px] leading-relaxed">
                            <span className="text-ink-3">
                                {run.kind === "post_test"
                                    ? "The draft tested: "
                                    : "What happens if: "}
                            </span>
                            {run.kind === "post_test"
                                ? (run.draft?.text ?? run.subject)
                                : run.subject}
                        </p>
                    )}
                    <div className="text-ink-3 mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                        <StatusPill run={run} />
                        <span aria-hidden>·</span>
                        <span>{sizeWords(run)}</span>
                        <span aria-hidden>·</span>
                        <span>
                            {run.createdByMe ? "You" : run.createdByName},{" "}
                            {relativeTime(run.createdAt)}
                        </span>
                        {run.shared && (
                            <Badge variant="secondary" className="ml-1">
                                Shared
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
                                Share with workspace
                            </Label>
                        </span>
                        {live && (
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setConfirm("cancel")}
                            >
                                Cancel run
                            </Button>
                        )}
                        <Button
                            size="sm"
                            variant="ghost"
                            className="text-danger hover:text-danger"
                            onClick={() => setConfirm("delete")}
                        >
                            <Trash2 aria-hidden />
                            Delete
                        </Button>
                    </div>
                )}
            </div>

            {live && (
                <div className="flex max-w-[640px] flex-col gap-1.5" aria-live="polite">
                    <div className="text-ink-2 flex items-baseline justify-between text-xs">
                        <span>{progressWords(run)}</span>
                        <span className="text-ink-3 tabular-nums">
                            {run.round} of {run.rounds} rounds done
                        </span>
                    </div>
                    <Progress value={progressValue(run)} className="h-1.5" />
                </div>
            )}

            <p className="text-ink-3 text-xs">{SCENARIO_CAVEAT}</p>

            <ConfirmDialog
                open={confirm !== null}
                onOpenChange={open => !open && !busy && setConfirm(null)}
                title={confirm === "cancel" ? "Cancel this scenario?" : "Delete this scenario?"}
                description={
                    confirm === "cancel"
                        ? "It stops after the round in progress. Rounds that finished stay readable; there will be no report."
                        : "The feed, the people, the report and the interviews go with it. This cannot be undone."
                }
                confirmLabel={confirm === "cancel" ? "Cancel run" : "Delete"}
                cancelLabel={confirm === "cancel" ? "Keep running" : "Keep it"}
                destructive
                onConfirm={() => void act()}
            />
        </header>
    );
}

/** While it runs, the creator can drop something into the next round. */
function EventBox({ run, onAdded }: { run: ScenarioDetail; onAdded: () => void }) {
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
            setError(e instanceof Error ? e.message : "Could not add the event");
        } finally {
            setAdding(false);
        }
    };

    return (
        <section className="border-line bg-panel flex flex-col gap-3 rounded-lg border p-4">
            <SectionHeading
                title="Add an event"
                aside={closed ? "The last round has started" : "It appears in the next round"}
                className="mb-0"
            />
            <Textarea
                value={text}
                onChange={e => setText(e.target.value)}
                rows={2}
                maxLength={max}
                disabled={closed || adding}
                aria-label="What happens"
                placeholder="A competitor cuts its price in half."
                className="text-[13px]"
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Button
                    size="sm"
                    variant="outline"
                    disabled={closed || adding || !text.trim()}
                    onClick={() => void add()}
                >
                    {adding ? "Adding…" : "Add event"}
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
                                    ? "appears in the next round"
                                    : `round ${i.round}`}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
