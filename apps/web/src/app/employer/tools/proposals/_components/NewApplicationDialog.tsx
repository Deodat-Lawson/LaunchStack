"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Textarea } from "~/components/ui/textarea";
import { useToolRouter } from "~/components/tool-app/nav";
import { cn } from "~/lib/utils";

import { useProposals } from "../_lib/context";
import { proposalsApi, type FunderRow, type SourceOption } from "../api";

type RequestKind = "paste" | "url" | "source";

/**
 * Start an application: name it, say who it is for, and give the funder's
 * request — pasted, as a URL, or as a Source already in the workspace. The
 * request is read into a checklist as soon as the application exists.
 */
export function NewApplicationDialog({
    open,
    onOpenChange,
    funder,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Pre-fills from a found funder and links the application to it. */
    funder?: FunderRow | null;
}) {
    const router = useToolRouter();
    const { href, trackRun, reloadCounts } = useProposals();
    const [title, setTitle] = useState("");
    const [funderName, setFunderName] = useState("");
    const [deadline, setDeadline] = useState("");
    const [kind, setKind] = useState<RequestKind>("paste");
    const [text, setText] = useState("");
    const [url, setUrl] = useState("");
    const [sourceQuery, setSourceQuery] = useState("");
    const [sources, setSources] = useState<SourceOption[]>([]);
    const [sourceId, setSourceId] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!open) return;
        setTitle(funder?.title ?? "");
        setFunderName(funder?.funder ?? "");
        setDeadline(funder?.closesOn ?? "");
        setUrl(funder?.url ?? "");
        setKind(funder?.url ? "url" : "paste");
        setText("");
        setSourceId(null);
    }, [open, funder]);

    useEffect(() => {
        if (!open || kind !== "source") return;
        let cancelled = false;
        void proposalsApi
            .sources(sourceQuery || undefined)
            .then(({ sources: list }) => {
                if (!cancelled) setSources(list);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [open, kind, sourceQuery]);

    const hasRequest =
        (kind === "paste" && text.trim().length >= 40) ||
        (kind === "url" && /^https?:\/\//.test(url.trim())) ||
        (kind === "source" && sourceId !== null);
    const valid = (title.trim().length > 0 || Boolean(funder)) && !busy;

    const submit = async () => {
        setBusy(true);
        try {
            const { application, run } = await proposalsApi.createApplication({
                title: title.trim(),
                funder: funderName.trim() || null,
                deadline: deadline || null,
                opportunityId: funder?.id ?? null,
                requestText: kind === "paste" && text.trim() ? text.trim() : null,
                requestUrl: kind === "url" && url.trim() ? url.trim() : null,
                requestDocumentId: kind === "source" ? sourceId : null,
            });
            await reloadCounts();
            if (run) trackRun(run, { openSheet: false });
            toast.success(
                run ? "Application started; reading the request now" : "Application started"
            );
            onOpenChange(false);
            router.push(href(`/write/${application.id}`));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not start the application");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>New application</DialogTitle>
                    <DialogDescription>
                        Give the funder&apos;s request and it becomes a checklist of everything they
                        ask for. You can add it later too.
                    </DialogDescription>
                </DialogHeader>
                <form
                    className="grid gap-3"
                    onSubmit={e => {
                        e.preventDefault();
                        if (valid) void submit();
                    }}
                >
                    <div className="grid gap-1.5">
                        <Label htmlFor="app-title" className="text-xs">
                            Title
                        </Label>
                        <Input
                            id="app-title"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            placeholder="Community Resilience Fund 2026"
                            autoFocus
                        />
                    </div>
                    <div className="grid grid-cols-[minmax(0,1fr)_150px] gap-3">
                        <div className="grid gap-1.5">
                            <Label htmlFor="app-funder" className="text-xs">
                                Funder
                            </Label>
                            <Input
                                id="app-funder"
                                value={funderName}
                                onChange={e => setFunderName(e.target.value)}
                                placeholder="Meyer Memorial Trust"
                            />
                        </div>
                        <div className="grid gap-1.5">
                            <Label htmlFor="app-deadline" className="text-xs">
                                Deadline
                            </Label>
                            <Input
                                id="app-deadline"
                                type="date"
                                value={deadline}
                                onChange={e => setDeadline(e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="grid gap-1.5">
                        <Label className="text-xs">The funder&apos;s request</Label>
                        <Tabs value={kind} onValueChange={v => setKind(v as RequestKind)}>
                            <TabsList>
                                <TabsTrigger value="paste">Paste</TabsTrigger>
                                <TabsTrigger value="url">Link</TabsTrigger>
                                <TabsTrigger value="source">From Sources</TabsTrigger>
                            </TabsList>
                            <TabsContent value="paste">
                                <Textarea
                                    value={text}
                                    onChange={e => setText(e.target.value)}
                                    rows={7}
                                    placeholder="Paste the call, the guidelines or the application form's questions…"
                                    className="text-[13px]"
                                    aria-label="The funder's request"
                                />
                            </TabsContent>
                            <TabsContent value="url">
                                <Input
                                    value={url}
                                    onChange={e => setUrl(e.target.value)}
                                    placeholder="https://funder.org/grants/apply"
                                    aria-label="The request's URL"
                                    inputMode="url"
                                />
                                <p className="text-ink-3 mt-1.5 text-xs">
                                    The page is read once; portals behind a login will not open.
                                </p>
                            </TabsContent>
                            <TabsContent value="source" className="grid gap-2">
                                <Input
                                    value={sourceQuery}
                                    onChange={e => setSourceQuery(e.target.value)}
                                    placeholder="Search your sources"
                                    aria-label="Search sources"
                                />
                                <div className="border-line max-h-44 overflow-y-auto rounded-md border">
                                    {sources.length === 0 ? (
                                        <p className="text-ink-3 px-3 py-2 text-xs">
                                            No sources match.
                                        </p>
                                    ) : (
                                        sources.map(s => (
                                            <button
                                                key={s.id}
                                                type="button"
                                                onClick={() => setSourceId(s.id)}
                                                aria-pressed={sourceId === s.id}
                                                className={cn(
                                                    "border-line-2 hover:bg-panel-2 focus-visible:ring-brand/50 flex w-full items-center justify-between gap-3 border-t px-3 py-1.5 text-left text-[13px] outline-none first:border-t-0 focus-visible:ring-2",
                                                    sourceId === s.id &&
                                                        "bg-brand-soft text-brand-ink"
                                                )}
                                            >
                                                <span className="truncate">{s.title}</span>
                                                <span className="text-ink-3 shrink-0 text-xs">
                                                    {s.folder}
                                                </span>
                                            </button>
                                        ))
                                    )}
                                </div>
                            </TabsContent>
                        </Tabs>
                    </div>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => onOpenChange(false)}
                            disabled={busy}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={!valid}>
                            {hasRequest ? "Start and read the request" : "Start application"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
