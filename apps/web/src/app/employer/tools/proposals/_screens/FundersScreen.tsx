"use client";

import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { ToolLink } from "~/components/tool-app/ToolLink";
import { cn } from "~/lib/utils";

import { FitMeter } from "~/components/tools/FitMeter";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader, SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { plural } from "~/lib/tools/format";
import { useResource } from "~/lib/tools/useResource";
import { NewApplicationDialog } from "../_components/NewApplicationDialog";
import { StatusWord } from "../_components/Pills";
import { useProposals } from "../_lib/context";
import { amountWords, closeWords, FUNDER_STATUS_LABEL } from "../_lib/words";
import { proposalsApi, type ApplicantType, type FunderRow, type FunderStatus } from "../api";

type View = "all" | "strong" | "saved" | "dismissed";

const SOURCE_WORD: Record<FunderRow["source"], string> = {
    grants_gov: "Grants.gov",
    web: "Web",
    manual: "Added by hand",
};

const STATUS_TONE: Record<FunderStatus, "quiet" | "info" | "won" | "active"> = {
    candidate: "quiet",
    saved: "info",
    dismissed: "quiet",
    applied: "active",
};

function FunderItem({
    f,
    onStatus,
    onApply,
    href,
}: {
    f: FunderRow;
    onStatus: (status: FunderStatus) => void;
    onApply: () => void;
    href: (path: string) => string;
}) {
    const [open, setOpen] = useState(false);
    const amount = amountWords(f.amountMin, f.amountMax);
    return (
        <div className="border-line-2 border-t first:border-t-0">
            <div className="@max-lg:grid-cols-[20px_minmax(0,1fr)_110px_auto] @max-md:grid-cols-[20px_minmax(0,1fr)_auto] grid grid-cols-[20px_minmax(0,1fr)_120px_110px_auto] items-center gap-3 px-3 py-2.5">
                <button
                    type="button"
                    onClick={() => setOpen(o => !o)}
                    className="text-ink-3 hover:text-ink focus-visible:ring-brand/50 rounded-sm outline-none focus-visible:ring-2"
                    aria-label={open ? "Hide details" : "Show details"}
                    aria-expanded={open}
                >
                    {open ? (
                        <ChevronDown className="size-4" />
                    ) : (
                        <ChevronRight className="size-4" />
                    )}
                </button>
                <span className="min-w-0">
                    <span className="text-ink block truncate text-sm font-medium">{f.title}</span>
                    <span className="text-ink-3 block truncate text-xs">
                        {f.funder} · {SOURCE_WORD[f.source]}
                        {amount ? ` · ${amount}` : ""}
                    </span>
                </span>
                <span
                    className={cn(
                        "@max-lg:hidden text-xs",
                        f.daysLeft !== null && f.daysLeft >= 0 && f.daysLeft <= 14
                            ? "text-warn"
                            : "text-ink-3"
                    )}
                >
                    {closeWords(f.closesOn, f.daysLeft)}
                </span>
                <span className="@max-md:hidden">
                    <FitMeter value={f.fit} threshold={70} />
                </span>
                <span className="flex items-center gap-1.5">
                    {f.status === "applied" && f.applicationId ? (
                        <Button size="sm" variant="outline" asChild>
                            <ToolLink href={href(`/write/${f.applicationId}`)}>
                                Open application
                            </ToolLink>
                        </Button>
                    ) : (
                        <>
                            {f.status !== "saved" && (
                                <Button size="sm" variant="ghost" onClick={() => onStatus("saved")}>
                                    Save
                                </Button>
                            )}
                            {f.status !== "dismissed" ? (
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => onStatus("dismissed")}
                                >
                                    Dismiss
                                </Button>
                            ) : (
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => onStatus("candidate")}
                                >
                                    Restore
                                </Button>
                            )}
                            <Button size="sm" variant="outline" onClick={onApply}>
                                Apply
                            </Button>
                        </>
                    )}
                </span>
            </div>
            {open && (
                <div className="text-ink-2 @max-md:grid-cols-1 grid grid-cols-2 gap-3 px-3 pb-4 pl-[44px] text-[13px]">
                    <div className="grid gap-2">
                        {f.why.length > 0 && (
                            <div>
                                <div className="text-ink-3 mb-1 text-xs">Why it fits</div>
                                <ul className="list-disc space-y-0.5 pl-4">
                                    {f.why.map(w => (
                                        <li key={w}>{w}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {f.concerns.length > 0 && (
                            <div>
                                <div className="text-ink-3 mb-1 text-xs">Concerns</div>
                                <ul className="list-disc space-y-0.5 pl-4">
                                    {f.concerns.map(c => (
                                        <li key={c}>{c}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {f.why.length === 0 && f.concerns.length === 0 && (
                            <p className="text-ink-3 text-xs">
                                Not scored: build your profile and search again to see why it fits.
                            </p>
                        )}
                    </div>
                    <div className="grid content-start gap-2">
                        {f.summary && <p className="leading-relaxed">{f.summary}</p>}
                        {f.eligibility && (
                            <p className="text-ink-3 text-xs leading-relaxed">
                                Eligibility: {f.eligibility}
                            </p>
                        )}
                        <div className="flex items-center gap-3">
                            <StatusWord tone={STATUS_TONE[f.status]}>
                                {FUNDER_STATUS_LABEL[f.status]}
                            </StatusWord>
                            {f.url && (
                                <a
                                    href={f.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-brand-ink inline-flex items-center gap-1 text-xs hover:underline"
                                >
                                    Open the call
                                    <ExternalLink className="size-3" />
                                </a>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function AddFunderDialog({
    open,
    onOpenChange,
    onAdded,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onAdded: () => void;
}) {
    const [title, setTitle] = useState("");
    const [funder, setFunder] = useState("");
    const [url, setUrl] = useState("");
    const [closesOn, setClosesOn] = useState("");
    const [amountMax, setAmountMax] = useState("");
    const [busy, setBusy] = useState(false);
    const valid = title.trim().length > 0 && funder.trim().length > 0 && !busy;
    const submit = async () => {
        setBusy(true);
        try {
            await proposalsApi.addFunder({
                title: title.trim(),
                funder: funder.trim(),
                url: url.trim() || null,
                closesOn: closesOn || null,
                amountMax: amountMax ? Number(amountMax) : null,
            });
            toast.success("Funder saved");
            onAdded();
            onOpenChange(false);
            setTitle("");
            setFunder("");
            setUrl("");
            setClosesOn("");
            setAmountMax("");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not add the funder");
        } finally {
            setBusy(false);
        }
    };
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Add a funder</DialogTitle>
                    <DialogDescription>
                        A call you heard about elsewhere. It is saved straight away.
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
                        <Label htmlFor="funder-title" className="text-xs">
                            Programme or call
                        </Label>
                        <Input
                            id="funder-title"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            autoFocus
                        />
                    </div>
                    <div className="grid gap-1.5">
                        <Label htmlFor="funder-name" className="text-xs">
                            Funder
                        </Label>
                        <Input
                            id="funder-name"
                            value={funder}
                            onChange={e => setFunder(e.target.value)}
                        />
                    </div>
                    <div className="grid gap-1.5">
                        <Label htmlFor="funder-url" className="text-xs">
                            Link
                        </Label>
                        <Input
                            id="funder-url"
                            value={url}
                            onChange={e => setUrl(e.target.value)}
                            inputMode="url"
                            placeholder="https://"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="grid gap-1.5">
                            <Label htmlFor="funder-closes" className="text-xs">
                                Closes
                            </Label>
                            <Input
                                id="funder-closes"
                                type="date"
                                value={closesOn}
                                onChange={e => setClosesOn(e.target.value)}
                            />
                        </div>
                        <div className="grid gap-1.5">
                            <Label htmlFor="funder-amount" className="text-xs">
                                Award up to (USD)
                            </Label>
                            <Input
                                id="funder-amount"
                                inputMode="numeric"
                                value={amountMax}
                                onChange={e => setAmountMax(e.target.value.replace(/[^0-9]/g, ""))}
                            />
                        </div>
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
                            Save funder
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

/**
 * Find funders: the search is planned from the profile (or from words you
 * give), runs over Grants.gov and the web, and comes back scored against
 * what the organisation is. Save what fits, dismiss what does not, apply
 * from here.
 */
export function FundersScreen() {
    const { href, trackRun, finishedTick } = useProposals();
    const res = useResource("proposals:funders", () => proposalsApi.funders("all"));
    const reload = res.reload;
    useEffect(() => {
        if (finishedTick > 0) void reload();
    }, [finishedTick, reload]);

    const [view, setView] = useState<View>("all");
    const [keywords, setKeywords] = useState("");
    const [geography, setGeography] = useState("");
    const [applicantType, setApplicantType] = useState<ApplicantType | "auto">("auto");
    const [includeWeb, setIncludeWeb] = useState(true);
    // The switch follows what the deployment can do; a person can still turn it off.
    const webAvailable = res.data?.sources.web;
    useEffect(() => {
        if (webAvailable !== undefined) setIncludeWeb(webAvailable);
    }, [webAvailable]);
    const [starting, setStarting] = useState(false);
    const [adding, setAdding] = useState(false);
    const [applying, setApplying] = useState<FunderRow | null>(null);

    const funders = useMemo(() => res.data?.funders ?? [], [res.data]);
    const shown = useMemo(() => {
        switch (view) {
            case "strong":
                return funders.filter(f => (f.fit ?? 0) >= 70 && f.status !== "dismissed");
            case "saved":
                return funders.filter(f => f.status === "saved" || f.status === "applied");
            case "dismissed":
                return funders.filter(f => f.status === "dismissed");
            default:
                return funders.filter(f => f.status !== "dismissed");
        }
    }, [funders, view]);
    const counts = {
        all: funders.filter(f => f.status !== "dismissed").length,
        strong: funders.filter(f => (f.fit ?? 0) >= 70 && f.status !== "dismissed").length,
        saved: funders.filter(f => f.status === "saved" || f.status === "applied").length,
        dismissed: funders.filter(f => f.status === "dismissed").length,
    };

    const find = async () => {
        setStarting(true);
        try {
            const { run } = await proposalsApi.findFunders({
                keywords: keywords
                    .split(",")
                    .map(k => k.trim())
                    .filter(Boolean),
                geography: geography.trim() || undefined,
                applicantType: applicantType === "auto" ? undefined : applicantType,
                includeWeb,
            });
            trackRun(run);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not start the search");
        } finally {
            setStarting(false);
        }
    };

    const setStatus = async (f: FunderRow, status: FunderStatus) => {
        try {
            const { funder } = await proposalsApi.setFunderStatus(f.id, status);
            res.mutate(current => ({
                ...current,
                funders: current.funders.map(x => (x.id === funder.id ? funder : x)),
            }));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not update the funder");
        }
    };

    const sources = res.data?.sources;
    const sub = sources
        ? `Searches ${sources.grantsGov ? "Grants.gov" : "no federal source"}${sources.web ? " and the web" : " · web search needs an EXA or SERPER key"}`
        : undefined;

    return (
        <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
            <PageHeader
                title="Funders that"
                accent="fit"
                sub={sub}
                actions={
                    <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                        Add by hand
                    </Button>
                }
            />
            {res.error && <InlineError message={res.error} onRetry={() => void res.reload()} />}

            <form
                className="border-line bg-panel @max-lg:grid-cols-2 @max-sm:grid-cols-1 grid grid-cols-[minmax(0,1fr)_180px_170px_auto] items-end gap-3 rounded-lg border px-4 py-4"
                onSubmit={e => {
                    e.preventDefault();
                    void find();
                }}
            >
                <div className="grid gap-1.5">
                    <Label htmlFor="funders-keywords" className="text-ink-3 text-xs font-normal">
                        Focus — leave empty to plan from your profile
                    </Label>
                    <Input
                        id="funders-keywords"
                        value={keywords}
                        onChange={e => setKeywords(e.target.value)}
                        placeholder="youth literacy, after-school"
                    />
                </div>
                <div className="grid gap-1.5">
                    <Label htmlFor="funders-geo" className="text-ink-3 text-xs font-normal">
                        Where
                    </Label>
                    <Input
                        id="funders-geo"
                        value={geography}
                        onChange={e => setGeography(e.target.value)}
                        placeholder="Oregon"
                    />
                </div>
                <div className="grid gap-1.5">
                    <Label className="text-ink-3 text-xs font-normal">Applicant</Label>
                    <Select
                        value={applicantType}
                        onValueChange={v => setApplicantType(v as ApplicantType | "auto")}
                    >
                        <SelectTrigger aria-label="Applicant type">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="auto">From profile</SelectItem>
                            <SelectItem value="nonprofit">Nonprofit</SelectItem>
                            <SelectItem value="small_business">Small business</SelectItem>
                            <SelectItem value="for_profit">Company</SelectItem>
                            <SelectItem value="individual">Individual</SelectItem>
                            <SelectItem value="any">Any</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex items-center gap-3">
                    <label className="text-ink-2 flex items-center gap-2 text-xs">
                        <Switch
                            checked={includeWeb}
                            onCheckedChange={setIncludeWeb}
                            disabled={sources ? !sources.web : false}
                            aria-label="Include the web"
                        />
                        Web
                    </label>
                    <Button type="submit" size="sm" disabled={starting}>
                        Find funders
                    </Button>
                </div>
            </form>

            <section>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                    <SectionHeading title="Funders" className="mb-0" />
                    <ToggleGroup
                        type="single"
                        value={view}
                        onValueChange={v => v && setView(v as View)}
                        size="sm"
                        variant="outline"
                    >
                        <ToggleGroupItem value="all">All · {counts.all}</ToggleGroupItem>
                        <ToggleGroupItem value="strong">
                            Strong fit · {counts.strong}
                        </ToggleGroupItem>
                        <ToggleGroupItem value="saved">Saved · {counts.saved}</ToggleGroupItem>
                        <ToggleGroupItem value="dismissed">
                            Dismissed · {counts.dismissed}
                        </ToggleGroupItem>
                    </ToggleGroup>
                </div>
                {res.loading ? (
                    <SkeletonRows rows={5} height={52} />
                ) : shown.length === 0 ? (
                    <EmptyState
                        title={funders.length === 0 ? "No funders yet" : "Nothing in this view"}
                        body={
                            funders.length === 0
                                ? "Run a search: every open call that matches comes back with why it fits and what to worry about."
                                : "Change the view, or search again with other words."
                        }
                        action={
                            funders.length === 0 ? (
                                <Button size="sm" onClick={() => void find()} disabled={starting}>
                                    Find funders
                                </Button>
                            ) : undefined
                        }
                    />
                ) : (
                    <div className="border-line bg-panel rounded-lg border">
                        {shown.map(f => (
                            <FunderItem
                                key={f.id}
                                f={f}
                                href={href}
                                onStatus={status => void setStatus(f, status)}
                                onApply={() => setApplying(f)}
                            />
                        ))}
                    </div>
                )}
                {!res.loading && shown.length > 0 && (
                    <p className="text-ink-3 mt-2 text-xs">
                        {plural(shown.length, "funder")} · fit above 70 is a strong match for your
                        profile
                    </p>
                )}
            </section>

            <p className="text-ink-3 max-w-[70ch] text-[13px]">
                Raising equity instead of grants?{" "}
                <ToolLink
                    href="/employer/documents?feature=investors"
                    className="text-brand-ink hover:underline"
                >
                    Investor relations
                </ToolLink>{" "}
                finds the venture funds raising now and drafts the pitch from the same sources.
            </p>

            <AddFunderDialog
                open={adding}
                onOpenChange={setAdding}
                onAdded={() => void res.reload()}
            />
            <NewApplicationDialog
                open={applying !== null}
                onOpenChange={open => !open && setApplying(null)}
                funder={applying}
            />
        </div>
    );
}
