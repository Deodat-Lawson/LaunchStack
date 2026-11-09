"use client";

import { BookmarkPlus, ChevronDown, Loader2, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { useErrorText } from "~/lib/tools/errorText";

import type {
    ProgramCycle,
    TrackerOpportunity,
    TrackerPriority,
    TrackerStatus,
    UpdateTrackerOpportunity,
} from "../api";
import { useTracker } from "../_lib/tracker";

export const TRACKER_STATUSES: TrackerStatus[] = [
    "shortlisted",
    "preparing",
    "applied",
    "interviewing",
    "accepted",
    "rejected",
    "withdrawn",
];
export const TRACKER_PRIORITIES: TrackerPriority[] = ["high", "medium", "low"];
const NO_CYCLE = "__none__";

export const PRIORITY_VARIANT = { high: "danger", medium: "warn", low: "secondary" } as const;

/** Start tracking, or edit every tracked cycle of one Program. Never touches the official application. */
export function TrackerControls({
    programId,
    cycles,
    canEdit,
}: {
    programId: string;
    cycles: ProgramCycle[];
    canEdit: boolean;
}) {
    const t = useTranslations("accelerators.tracker");
    const errorText = useErrorText();
    const { opportunities, error, track } = useTracker();
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<unknown>(null);
    if (opportunities === null) {
        return error ? (
            <p role="alert" className="text-danger text-sm">
                {errorText(error, t("loadFailed"))}
            </p>
        ) : (
            <p role="status" className="text-ink-3 flex items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin" />
                {t("loading")}
            </p>
        );
    }
    const mine = opportunities
        .filter(item => item.programId === programId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const start = async () => {
        setBusy(true);
        setFailure(null);
        try {
            await track(programId);
        } catch (caught) {
            setFailure(caught);
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className="divide-line space-y-4 divide-y [&>*:not(:first-child)]:pt-4">
            {mine.length === 0 ? (
                <div className="space-y-3">
                    <p className="text-ink-3 text-sm leading-relaxed">{t("notTracked")}</p>
                    {canEdit && (
                        <Button
                            variant="outline"
                            className="w-full"
                            onClick={() => void start()}
                            disabled={busy}
                        >
                            {busy ? <Loader2 className="animate-spin" /> : <BookmarkPlus />}
                            {t("track")}
                        </Button>
                    )}
                </div>
            ) : (
                mine.map(opportunity => (
                    <OpportunityEditor
                        key={opportunity.id}
                        opportunity={opportunity}
                        cycles={cycles}
                        canEdit={canEdit}
                    />
                ))
            )}
            {failure !== null && (
                <p role="alert" className="text-danger text-sm">
                    {errorText(failure, t("saveFailed"))}
                </p>
            )}
        </div>
    );
}

export function OpportunityEditor({
    opportunity,
    cycles,
    canEdit,
    detailsOpen = false,
}: {
    opportunity: TrackerOpportunity;
    cycles: ProgramCycle[];
    canEdit: boolean;
    /** Show cycle, dates, notes and tasks without a click (e.g. in the tracker's side panel). */
    detailsOpen?: boolean;
}) {
    const t = useTranslations("accelerators.tracker");
    const format = useFormatter();
    const errorText = useErrorText();
    const { update, untrack, track } = useTracker();
    const [failure, setFailure] = useState<unknown>(null);
    const [confirming, setConfirming] = useState(false);
    const save = async (patch: UpdateTrackerOpportunity) => {
        setFailure(null);
        try {
            await update(opportunity.id, patch);
        } catch (caught) {
            setFailure(caught);
        }
    };
    const cycle = cycles.find(item => item.id === opportunity.cycleId);
    const untrackedCycles = cycles.filter(item => item.id !== opportunity.cycleId);
    const id = opportunity.id;
    return (
        <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                    <Label htmlFor={`${id}-status`} className="text-ink-3 text-xs">
                        {t("status")}
                    </Label>
                    <Select
                        value={opportunity.status}
                        disabled={!canEdit}
                        onValueChange={value => void save({ status: value as TrackerStatus })}
                    >
                        <SelectTrigger id={`${id}-status`} size="sm" className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {TRACKER_STATUSES.map(status => (
                                <SelectItem key={status} value={status}>
                                    {t(`statuses.${status}`)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor={`${id}-priority`} className="text-ink-3 text-xs">
                        {t("priority")}
                    </Label>
                    <Select
                        value={opportunity.priority}
                        disabled={!canEdit}
                        onValueChange={value => void save({ priority: value as TrackerPriority })}
                    >
                        <SelectTrigger id={`${id}-priority`} size="sm" className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {TRACKER_PRIORITIES.map(priority => (
                                <SelectItem key={priority} value={priority}>
                                    {t(`priorities.${priority}`)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <div className="space-y-1.5">
                <Label htmlFor={`${id}-next`} className="text-ink-3 text-xs">
                    {t("nextAction")}
                </Label>
                <Input
                    id={`${id}-next`}
                    key={`next-${opportunity.updatedAt}`}
                    defaultValue={opportunity.nextAction ?? ""}
                    disabled={!canEdit}
                    placeholder={t("nextActionPlaceholder")}
                    className="h-8 text-sm"
                    onBlur={event => {
                        const value = event.target.value.trim() || null;
                        if (value !== opportunity.nextAction) void save({ nextAction: value });
                    }}
                />
            </div>

            <Collapsible defaultOpen={detailsOpen}>
                <CollapsibleTrigger className="text-ink-2 hover:text-ink group flex w-full items-center justify-between gap-2 text-xs font-medium">
                    {t("moreDetails")}
                    <span className="text-ink-3 flex items-center gap-1.5 font-normal">
                        {t("openTasks", {
                            count: opportunity.tasks.filter(task => !task.done).length,
                        })}
                        <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
                    </span>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-3">
                    <div className="space-y-1.5">
                        <Label htmlFor={`${id}-cycle`} className="text-ink-3 text-xs">
                            {t("cycle")}
                        </Label>
                        {opportunity.cycleId !== null ? (
                            <p id={`${id}-cycle`} className="text-ink-2 text-sm">
                                {cycle?.label ?? opportunity.cycleId}
                                {opportunity.plannedDeadline && (
                                    <span className="text-ink-3 block text-xs">
                                        {t("plannedDeadline", {
                                            date: format.dateTime(
                                                new Date(opportunity.plannedDeadline),
                                                {
                                                    dateStyle: "medium",
                                                    timeStyle: "short",
                                                }
                                            ),
                                        })}
                                    </span>
                                )}
                            </p>
                        ) : (
                            <Select
                                value={NO_CYCLE}
                                disabled={!canEdit || cycles.length === 0}
                                onValueChange={value =>
                                    value !== NO_CYCLE && void save({ cycleId: value })
                                }
                            >
                                <SelectTrigger id={`${id}-cycle`} className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={NO_CYCLE}>{t("noCycle")}</SelectItem>
                                    {cycles.map(item => (
                                        <SelectItem key={item.id} value={item.id}>
                                            {item.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                        {opportunity.cycleId !== null && canEdit && untrackedCycles.length > 0 && (
                            <Select
                                value={NO_CYCLE}
                                onValueChange={value =>
                                    value !== NO_CYCLE &&
                                    void track(opportunity.programId, value).catch(setFailure)
                                }
                            >
                                <SelectTrigger aria-label={t("anotherCycle")} className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={NO_CYCLE}>{t("anotherCycle")}</SelectItem>
                                    {untrackedCycles.map(item => (
                                        <SelectItem key={item.id} value={item.id}>
                                            {item.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>

                    {opportunity.status !== "shortlisted" && opportunity.status !== "preparing" && (
                        <div className="space-y-1.5">
                            <Label htmlFor={`${id}-submitted`} className="text-ink-3 text-xs">
                                {t("submittedOn")}
                            </Label>
                            <Input
                                id={`${id}-submitted`}
                                type="date"
                                key={`submitted-${opportunity.updatedAt}`}
                                defaultValue={opportunity.submittedOn ?? ""}
                                disabled={!canEdit}
                                onBlur={event => {
                                    const value = event.target.value || null;
                                    if (value !== opportunity.submittedOn)
                                        void save({ submittedOn: value });
                                }}
                            />
                        </div>
                    )}

                    <div className="space-y-1.5">
                        <Label htmlFor={`${id}-notes`} className="text-ink-3 text-xs">
                            {t("notes")}
                        </Label>
                        <Textarea
                            id={`${id}-notes`}
                            key={`notes-${opportunity.updatedAt}`}
                            defaultValue={opportunity.notes}
                            disabled={!canEdit}
                            rows={3}
                            placeholder={t("notesPlaceholder")}
                            onBlur={event => {
                                if (event.target.value !== opportunity.notes)
                                    void save({ notes: event.target.value });
                            }}
                        />
                    </div>

                    <TaskList opportunity={opportunity} canEdit={canEdit} />
                    {canEdit && (
                        <>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="text-danger -ml-2"
                                onClick={() => setConfirming(true)}
                            >
                                <Trash2 />
                                {t("untrack")}
                            </Button>
                            <ConfirmDialog
                                open={confirming}
                                onOpenChange={setConfirming}
                                title={t("untrackTitle")}
                                description={t("untrackBody")}
                                confirmLabel={t("untrack")}
                                destructive
                                onConfirm={() => void untrack(opportunity.id).catch(setFailure)}
                            />
                        </>
                    )}
                </CollapsibleContent>
            </Collapsible>
            {failure !== null && (
                <p role="alert" className="text-danger text-sm">
                    {errorText(failure, t("saveFailed"))}
                </p>
            )}
        </div>
    );
}

function TaskList({ opportunity, canEdit }: { opportunity: TrackerOpportunity; canEdit: boolean }) {
    const t = useTranslations("accelerators.tracker");
    const format = useFormatter();
    const errorText = useErrorText();
    const { addTask, setTaskDone, removeTask } = useTracker();
    const [title, setTitle] = useState("");
    const [dueOn, setDueOn] = useState("");
    const [failure, setFailure] = useState<unknown>(null);
    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (!title.trim()) return;
        setFailure(null);
        try {
            await addTask(opportunity.id, { title: title.trim(), dueOn: dueOn || null });
            setTitle("");
            setDueOn("");
        } catch (caught) {
            setFailure(caught);
        }
    };
    const tasks = [...opportunity.tasks].sort(
        (left, right) =>
            Number(left.done) - Number(right.done) ||
            (left.dueOn ?? "9").localeCompare(right.dueOn ?? "9")
    );
    return (
        <div className="space-y-2">
            <h3 className="text-ink text-sm font-medium">{t("tasks")}</h3>
            {tasks.length === 0 && <p className="text-ink-3 text-xs">{t("noTasks")}</p>}
            <ul className="space-y-1.5">
                {tasks.map(task => (
                    <li key={task.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                            id={`task-${task.id}`}
                            checked={task.done}
                            disabled={!canEdit}
                            onCheckedChange={checked =>
                                void setTaskDone(opportunity.id, task.id, checked === true).catch(
                                    setFailure
                                )
                            }
                        />
                        <Label
                            htmlFor={`task-${task.id}`}
                            className={task.done ? "text-ink-3 line-through" : "text-ink-2"}
                        >
                            {task.title}
                        </Label>
                        {task.dueOn && (
                            <Badge variant="secondary" className="ml-auto">
                                {format.dateTime(new Date(`${task.dueOn}T00:00:00Z`), {
                                    dateStyle: "medium",
                                    timeZone: "UTC",
                                })}
                            </Badge>
                        )}
                        {canEdit && (
                            <Button
                                variant="ghost"
                                size="icon"
                                className={task.dueOn ? "size-7" : "ml-auto size-7"}
                                aria-label={t("removeTask", { title: task.title })}
                                onClick={() =>
                                    void removeTask(opportunity.id, task.id).catch(setFailure)
                                }
                            >
                                <Trash2 className="size-3.5" />
                            </Button>
                        )}
                    </li>
                ))}
            </ul>
            {canEdit && (
                <form onSubmit={event => void submit(event)} className="flex flex-wrap gap-2">
                    <Input
                        value={title}
                        onChange={event => setTitle(event.target.value)}
                        placeholder={t("taskPlaceholder")}
                        aria-label={t("taskTitle")}
                        className="min-w-0 flex-1"
                    />
                    <Input
                        type="date"
                        value={dueOn}
                        onChange={event => setDueOn(event.target.value)}
                        aria-label={t("taskDue")}
                        className="w-auto"
                    />
                    <Button type="submit" size="sm" variant="outline" disabled={!title.trim()}>
                        {t("addTask")}
                    </Button>
                </form>
            )}
            {failure !== null && (
                <p role="alert" className="text-danger text-sm">
                    {errorText(failure, t("saveFailed"))}
                </p>
            )}
        </div>
    );
}
