"use client";

import { History, MoreHorizontal, Quote } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useActionMenu } from "~/components/context-menu";
import { Field } from "~/components/field";
import { useToolNav, useToolSearchParams } from "~/components/tool-app/nav";
import { ToolNotFound } from "~/components/tool-app/ToolFrame";
import { SourceLink } from "~/components/tools/Cite";
import { InlineError } from "~/components/tools/EmptyState";
import { PageHeader, SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonBlock } from "~/components/tools/SkeletonRows";
import { Button } from "~/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "~/components/ui/sheet";
import { Textarea } from "~/components/ui/textarea";

import { useContractActions } from "./actions";
import { IconTooltip, paths, StatusBadge, useRenewalsFormat } from "./bits";
import { noticeBy, TODAY, useContracts, type Contract } from "./data";
import { buildContractMenuItems } from "./menu";

/**
 * One thing, in full: a record screen.
 *
 * - A plain title at the record size (`PageHeader size="md"`), the status and
 *   the one fact that matters most under it.
 * - One primary action (filled), the rest outline or behind "⋯".
 * - Main column for what the record says, a narrow column for its facts;
 *   the columns stack when the tab is narrower than 880px (`@max-lg`).
 * - Anything quoted from a document says which document and page, and
 *   opens it.
 * - Back is the frame's ‹, not a button of the screen's own.
 */
export function ContractScreen({ id }: { id: string }) {
    const t = useTranslations("designTemplate.contract");
    const tContracts = useTranslations("designTemplate.contracts");
    const tc = useTranslations("common");
    const f = useRenewalsFormat();
    const contracts = useContracts();
    const params = useToolSearchParams();
    const { navigate } = useToolNav();
    const menu = useActionMenu();
    const actions = useContractActions();
    const [deciding, setDeciding] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);

    // Another screen can open this one with the decision dialog up (`?decide=1`).
    useEffect(() => {
        if (params.get("decide") === "1") setDeciding(true);
    }, [params]);

    if (contracts.status === "loading") {
        return (
            <div className="mx-auto flex max-w-[1080px] flex-col gap-7">
                <SkeletonBlock lines={2} className="max-w-md" />
                <SkeletonBlock lines={5} />
            </div>
        );
    }
    if (contracts.status === "error") {
        return <InlineError message={t("loadFailed")} onRetry={contracts.retry} />;
    }
    const contract = contracts.data.find(c => c.id === id);
    if (!contract) {
        return (
            <ToolNotFound
                home={paths.contracts()}
                homeLabel={tContracts("title")}
                title={t("notFoundTitle")}
                body={t("notFoundBody")}
            />
        );
    }

    const items = buildContractMenuItems(
        contract,
        {
            onDecide: () => setDeciding(true),
            onAsk: () => actions.ask(contract),
            onCopyLink: () => actions.copyLink(contract),
            onDelete: () => actions.requestDelete(contract),
        },
        t
    );

    const facts: { label: string; value: string }[] = [
        { label: t("owner"), value: contract.owner },
        { label: t("value"), value: contract.value ? f.money(contract.value) : "—" },
        { label: t("noticePeriod"), value: t("noticePeriodValue", { days: contract.noticeDays }) },
        { label: t("noticeBy"), value: f.longDate(noticeBy(contract)) },
    ];

    return (
        <div className="mx-auto flex max-w-[1080px] flex-col gap-7">
            <PageHeader
                size="md"
                title={contract.vendor}
                sub={
                    <span className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={contract.status} />
                        <span>{t("renewsOn", { date: f.longDate(contract.renewsOn) })}</span>
                    </span>
                }
                actions={
                    <>
                        <Button size="sm" onClick={() => setDeciding(true)}>
                            {t("recordDecision")}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setHistoryOpen(true)}>
                            <History />
                            {t("history")}
                        </Button>
                        <IconTooltip label={tc("actions.moreActions")}>
                            <Button
                                size="icon"
                                variant="ghost"
                                className="size-8"
                                aria-label={tc("actions.moreActions")}
                                onClick={event => {
                                    const box = event.currentTarget.getBoundingClientRect();
                                    menu.open({
                                        x: box.right - 200,
                                        y: box.bottom + 4,
                                        items,
                                        ariaLabel: contract.vendor,
                                        via: "button",
                                        kind: "template-contract",
                                    });
                                }}
                            >
                                <MoreHorizontal />
                            </Button>
                        </IconTooltip>
                    </>
                }
            />

            <div className="@max-lg:grid-cols-1 grid grid-cols-[minmax(0,1fr)_280px] gap-7">
                <div className="flex min-w-0 flex-col gap-7">
                    <section>
                        <SectionHeading title={t("fromContract")} />
                        <figure className="border-line bg-panel m-0 rounded-lg border px-5 py-4">
                            <blockquote className="text-ink m-0 flex gap-3 text-sm leading-relaxed">
                                <Quote aria-hidden className="text-ink-4 mt-0.5 size-4 shrink-0" />
                                <span>{contract.source.quote}</span>
                            </blockquote>
                            <figcaption className="text-ink-3 mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 pl-7 text-xs">
                                <SourceLink
                                    href={sourceHref(contract)}
                                    className="text-brand-ink hover:underline"
                                >
                                    {contract.source.title}
                                </SourceLink>
                                <span>{t("page", { page: contract.source.page })}</span>
                            </figcaption>
                        </figure>
                    </section>
                    <section>
                        <SectionHeading title={t("terms")} />
                        <dl className="border-line bg-panel m-0 overflow-hidden rounded-lg border">
                            {[
                                { label: t("renewal"), value: t("renewalValue") },
                                { label: t("noticeHow"), value: t("noticeHowValue") },
                            ].map(row => (
                                <div
                                    key={row.label}
                                    className="border-line-2 @max-sm:grid-cols-1 @max-sm:gap-0.5 grid grid-cols-[180px_minmax(0,1fr)] gap-4 border-t px-4 py-2.5 text-sm first:border-t-0"
                                >
                                    <dt className="text-ink-3">{row.label}</dt>
                                    <dd className="text-ink m-0">{row.value}</dd>
                                </div>
                            ))}
                        </dl>
                    </section>
                </div>

                <aside className="min-w-0">
                    <SectionHeading title={t("details")} />
                    <dl className="m-0 flex flex-col gap-3">
                        {facts.map(fact => (
                            <div key={fact.label}>
                                <dt className="text-ink-3 text-xs">{fact.label}</dt>
                                <dd className="text-ink m-0 mt-0.5 text-sm tabular-nums">
                                    {fact.value}
                                </dd>
                            </div>
                        ))}
                    </dl>
                </aside>
            </div>

            <DecisionDialog
                contract={contract}
                open={deciding}
                onOpenChange={open => {
                    setDeciding(open);
                    if (!open && params.get("decide"))
                        navigate(paths.contract(contract.id), { replace: true });
                }}
            />
            <HistorySheet contract={contract} open={historyOpen} onOpenChange={setHistoryOpen} />
        </div>
    );
}

/**
 * The contract's document, opened at the quoted passage, highlighted — the
 * way a chat citation opens it. A site link: the tab hands it to the
 * workspace, which opens the document beside this tab.
 */
function sourceHref(contract: Contract): string {
    const params = new URLSearchParams({
        source: contract.source.id,
        find: contract.source.quote,
        page: String(contract.source.page),
    });
    return `/employer/documents?${params.toString()}`;
}

/**
 * A short task that needs a few inputs and then ends: a kit `Dialog`. Title
 * says the task, description says what happens, the footer has the cancel
 * and the one primary action, labelled with the verb (never "OK").
 */
function DecisionDialog({
    contract,
    open,
    onOpenChange,
}: {
    contract: Contract;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const t = useTranslations("designTemplate.contract");
    const tc = useTranslations("common.actions");
    const f = useRenewalsFormat();
    const [decision, setDecision] = useState("renew");
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("decisionTitle")}</DialogTitle>
                    <DialogDescription>
                        {t("decisionBody", {
                            vendor: contract.vendor,
                            date: f.longDate(contract.renewsOn),
                        })}
                    </DialogDescription>
                </DialogHeader>
                <form
                    id="template-decision"
                    className="flex flex-col gap-4"
                    onSubmit={event => {
                        event.preventDefault();
                        toast.success(t("decisionSaved", { owner: contract.owner }));
                        onOpenChange(false);
                    }}
                >
                    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
                        <legend className="text-ink-2 mb-1.5 text-xs font-semibold">
                            {t("decisionLabel")}
                        </legend>
                        <RadioGroup value={decision} onValueChange={setDecision}>
                            {(["renew", "renegotiate", "end"] as const).map(value => (
                                <div key={value} className="flex items-center gap-2.5">
                                    <RadioGroupItem value={value} id={`decision-${value}`} />
                                    <Label
                                        htmlFor={`decision-${value}`}
                                        className="text-sm font-normal"
                                    >
                                        {t(
                                            value === "renew"
                                                ? "decisionRenew"
                                                : value === "renegotiate"
                                                  ? "decisionRenegotiate"
                                                  : "decisionEnd"
                                        )}
                                    </Label>
                                </div>
                            ))}
                        </RadioGroup>
                    </fieldset>
                    <Field label={t("decisionNote")} htmlFor="decision-note">
                        <Textarea
                            id="decision-note"
                            rows={3}
                            placeholder={t("decisionNotePlaceholder")}
                        />
                    </Field>
                </form>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        {tc("cancel")}
                    </Button>
                    <Button type="submit" form="template-decision">
                        {t("saveDecision")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/**
 * Something to read beside the screen without leaving it: a kit `Sheet`.
 * Inside a `ToolFrame` it covers this tab only, so the pane beside it stays
 * usable.
 */
function HistorySheet({
    contract,
    open,
    onOpenChange,
}: {
    contract: Contract;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const t = useTranslations("designTemplate.contract");
    const f = useRenewalsFormat();
    const now = Date.parse(TODAY);
    const events = [
        {
            id: "reminder",
            text: t("historyReminder", { person: contract.owner }),
            on: "2026-11-14",
        },
        { id: "owner", text: t("historyOwner", { person: contract.owner }), on: "2026-10-02" },
        {
            id: "created",
            text: t("historyCreated", { title: contract.source.title, page: contract.source.page }),
            on: "2026-09-28",
        },
    ];
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="w-[360px] max-w-full">
                <SheetHeader>
                    <SheetTitle>{t("historyTitle")}</SheetTitle>
                    {/* Read out, not shown: on screen it would only restate the title. */}
                    <SheetDescription className="sr-only">{t("historyBody")}</SheetDescription>
                </SheetHeader>
                <ol className="m-0 flex list-none flex-col gap-4 px-4 pb-6">
                    {events.map(event => (
                        <li key={event.id} className="border-line border-l-2 pl-3">
                            <div className="text-ink text-sm">{event.text}</div>
                            <div className="text-ink-3 text-xs">
                                {f.relativeTime(event.on, now)}
                            </div>
                        </li>
                    ))}
                </ol>
            </SheetContent>
        </Sheet>
    );
}
