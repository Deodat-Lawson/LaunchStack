"use client";

import { AcceleratorError, assertAnswer } from "@launchstack/pipelines/accelerators/types";
import { FileUp, Loader2, PenLine, Save, Sparkles, Video } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type HTMLInputTypeAttribute } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
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
import { Textarea } from "~/components/ui/textarea";
import { useErrorText } from "~/lib/tools/errorText";
import { cn } from "~/lib/utils";

import type { AcceleratorSection, FormField } from "../api";
import { runIsLive, useAccelerators } from "../_lib/context";
import { EditSuggestionPanel } from "./EditSuggestionPanel";
import { Notice } from "./ProgramFacts";

const INPUT_TYPES: Record<
    "short_text" | "url" | "email" | "number" | "date",
    HTMLInputTypeAttribute
> = {
    short_text: "text",
    url: "url",
    email: "email",
    number: "number",
    date: "date",
};

export interface FieldEditorProps {
    applicationId: string;
    section: AcceleratorSection;
}

/** All writers share this buffer's base revision; selection editing can use the same context. */
export function FieldEditor({ applicationId, section }: FieldEditorProps) {
    const t = useTranslations("accelerators.field");
    const format = useFormatter();
    const errorText = useErrorText();
    const id = useId();
    const {
        home,
        buffers,
        changeAnswer,
        resolveConflict,
        saveAnswer,
        draftAnswer,
        activeRun,
        runBusy,
        pendingEdit,
        restoringEdit,
        suggestEdit,
        applyEdit,
        dismissEdit,
    } = useAccelerators();
    const [pending, setPending] = useState<"save" | "draft" | "edit" | "apply" | null>(null);
    const [lastAction, setLastAction] = useState<"save" | "draft" | "edit" | "apply">("save");
    const busy = useRef(false);
    const [failure, setFailure] = useState<unknown>(null);
    const [editOpen, setEditOpen] = useState(false);
    const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
    const [instruction, setInstruction] = useState("");
    const field = section.field;
    const buffer = buffers[section.id] ?? {
        value: section.draft ?? "",
        baseline: section.draft ?? "",
        baseRevision: section.revision,
    };
    const dirty = buffer.value !== buffer.baseline;
    const conflict = section.revision !== buffer.baseRevision;
    const manual = field.fieldType === "file" || field.fieldType === "video";
    const prose = field.fieldType === "long_text" || field.fieldType === "short_text";
    const empty =
        buffer.value.trim() === "" || (field.fieldType === "multi_select" && buffer.value === "[]");
    const live = runIsLive(activeRun);
    const words = buffer.value.trim() ? buffer.value.trim().split(/\s+/u).length : 0;
    let validation: string | null = null;
    try {
        assertAnswer(field, buffer.value);
    } catch (error) {
        if (error instanceof AcceleratorError && error.code === "character_limit")
            validation = t("validation.characterLimit");
        else if (error instanceof AcceleratorError && error.code === "word_limit")
            validation = t("validation.wordLimit");
        else if (error instanceof AcceleratorError && error.code === "manual_requirement")
            validation = t("validation.manual");
        else validation = t("validation.invalid");
    }
    const save = async () => {
        if (busy.current || conflict || !dirty || validation || !home?.canEdit) return;
        busy.current = true;
        setPending("save");
        setLastAction("save");
        setFailure(null);
        try {
            await saveAnswer(applicationId, section.id, buffer);
        } catch (error) {
            setFailure(error);
        } finally {
            busy.current = false;
            setPending(null);
        }
    };
    // Offsets refer to the saved answer, so a selection only counts while the buffer is clean.
    const savedText = section.draft ?? "";
    const edit =
        pendingEdit?.applicationId === applicationId && pendingEdit.sectionId === section.id
            ? pendingEdit
            : null;
    const editable =
        prose && !manual && Boolean(home?.canEdit) && savedText.trim() !== "" && !conflict;
    const activeSelection =
        selection !== null && selection.end > selection.start && selection.end <= savedText.length
            ? selection
            : null;
    const hasSelection = activeSelection !== null;
    const stale =
        edit !== null &&
        (section.revision !== edit.suggestion.expectedRevision ||
            savedText.slice(edit.suggestion.start, edit.suggestion.end) !==
                edit.suggestion.original);
    const editingRun = live && activeRun?.kind === "accel_edit";
    // The saved answer moved on, so an old range no longer means the same text.
    useEffect(() => {
        setSelection(null);
    }, [section.revision]);
    const suggest = async () => {
        if (busy.current || !activeSelection || dirty || conflict) return;
        const request = instruction.trim();
        if (!request || pendingEdit !== null || restoringEdit || runBusy) return;
        busy.current = true;
        setPending("edit");
        setLastAction("edit");
        setFailure(null);
        try {
            await suggestEdit(applicationId, section.id, {
                expectedRevision: buffer.baseRevision,
                start: activeSelection.start,
                end: activeSelection.end,
                instruction: request,
            });
        } catch (error) {
            setFailure(error);
        } finally {
            busy.current = false;
            setPending(null);
        }
    };
    const apply = async () => {
        if (busy.current || !edit || dirty || stale || !home?.canEdit) return;
        busy.current = true;
        setPending("apply");
        setLastAction("apply");
        setFailure(null);
        try {
            await applyEdit(applicationId, section.id, {
                expectedRevision: edit.suggestion.expectedRevision,
                start: edit.suggestion.start,
                end: edit.suggestion.end,
                original: edit.suggestion.original,
                replacement: edit.suggestion.replacement,
            });
        } catch (error) {
            setFailure(error);
        } finally {
            busy.current = false;
            setPending(null);
        }
    };
    return (
        <article
            className="border-line bg-panel space-y-4 rounded-xl border p-5"
            data-field-key={section.key}
        >
            <form
                noValidate
                onSubmit={event => {
                    event.preventDefault();
                    void save();
                }}
                className="space-y-4"
            >
                <header className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{t(`types.${field.fieldType}`)}</Badge>
                        <Badge variant="outline">
                            {t(field.required ? "required" : "optional")}
                        </Badge>
                        {!manual && (
                            <span
                                className={cn(
                                    "ml-auto text-xs",
                                    dirty ? "text-warn" : "text-ink-3"
                                )}
                            >
                                {t(dirty ? "unsaved" : "saved")}
                            </span>
                        )}
                    </div>
                    <h2
                        id={`${id}-question`}
                        className="text-ink text-base font-semibold leading-relaxed"
                    >
                        {field.question}
                    </h2>
                    {field.guidance && (
                        <p
                            id={`${id}-guidance`}
                            className="text-ink-2 whitespace-pre-wrap text-sm leading-relaxed"
                        >
                            {field.guidance}
                        </p>
                    )}
                </header>
                {manual ? (
                    <Notice>
                        <div className="flex items-start gap-2">
                            {field.fieldType === "file" ? (
                                <FileUp className="mt-0.5 size-4 shrink-0" />
                            ) : (
                                <Video className="mt-0.5 size-4 shrink-0" />
                            )}
                            <p>{t(field.fieldType === "file" ? "manualFile" : "manualVideo")}</p>
                        </div>
                    </Notice>
                ) : (
                    <FieldInput
                        id={id}
                        field={field}
                        value={buffer.value}
                        disabled={!home?.canEdit}
                        invalid={validation !== null}
                        describedBy={`${id}-limits${field.guidance ? ` ${id}-guidance` : ""}${validation ? ` ${id}-validation` : ""}`}
                        onChange={value => {
                            setFailure(null);
                            setSelection(null);
                            changeAnswer(section, value);
                        }}
                        onSelectionChange={setSelection}
                    />
                )}
                {!manual && (
                    <div id={`${id}-limits`} className="text-ink-3 space-y-1 text-xs">
                        <div className="flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
                            <span
                                className={cn(
                                    field.charLimit !== null &&
                                        buffer.value.length > field.charLimit &&
                                        "text-danger"
                                )}
                            >
                                {field.charLimit === null
                                    ? t("characters", { count: format.number(buffer.value.length) })
                                    : t("characterLimit", {
                                          count: format.number(buffer.value.length),
                                          limit: format.number(field.charLimit),
                                      })}
                            </span>
                            {(prose || field.wordLimit !== null) && (
                                <span
                                    className={cn(
                                        field.wordLimit !== null &&
                                            words > field.wordLimit &&
                                            "text-danger"
                                    )}
                                >
                                    {field.wordLimit === null
                                        ? t("words", { count: format.number(words) })
                                        : t("wordLimit", {
                                              count: format.number(words),
                                              limit: format.number(field.wordLimit),
                                          })}
                                </span>
                            )}
                        </div>
                        {field.charLimit === null && field.wordLimit === null && (
                            <p>{t(field.limitConfirmed ? "limitNone" : "limitUnconfirmed")}</p>
                        )}
                        {field.limitSource && (
                            <div className="space-y-1">
                                <a
                                    href={field.limitSource.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-brand underline underline-offset-4"
                                >
                                    {t("limitSource")}
                                </a>
                                <blockquote className="whitespace-pre-wrap">
                                    {field.limitSource.quote}
                                </blockquote>
                            </div>
                        )}
                    </div>
                )}
                {field.required && (empty || manual) && (
                    <p className="text-ink-3 text-xs">{t("requiredEmpty")}</p>
                )}
                {validation && (
                    <p id={`${id}-validation`} role="alert" className="text-danger text-sm">
                        {validation}
                    </p>
                )}
                {conflict && (
                    <Notice>
                        <h3 className="text-ink font-semibold">{t("conflictTitle")}</h3>
                        <p className="mt-1">{t("conflictBody")}</p>
                        <h4 className="mt-3 text-xs font-medium">{t("latestSaved")}</h4>
                        <p className="border-line bg-surface text-ink-2 mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border p-3 text-sm">
                            {section.draft?.length ? section.draft : t("emptySaved")}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={pending !== null}
                                onClick={() => {
                                    setFailure(null);
                                    resolveConflict(section, false);
                                }}
                            >
                                {t("useSaved")}
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={pending !== null || !home?.canEdit}
                                onClick={() => {
                                    setFailure(null);
                                    resolveConflict(section, true);
                                }}
                            >
                                {t("keepLocal")}
                            </Button>
                        </div>
                    </Notice>
                )}
                {!manual && home?.canEdit && (
                    <div className="flex flex-wrap items-center gap-3">
                        <Button
                            type="submit"
                            size="sm"
                            disabled={!dirty || conflict || validation !== null || pending !== null}
                        >
                            {pending === "save" ? (
                                <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                            ) : (
                                <Save className="size-3.5" />
                            )}
                            {t(pending === "save" ? "saving" : "save")}
                        </Button>
                        {prose && buffer.value === "" && !section.draft && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={
                                    dirty ||
                                    conflict ||
                                    pending !== null ||
                                    runBusy ||
                                    !home.profileReady
                                }
                                onClick={async () => {
                                    if (busy.current) return;
                                    busy.current = true;
                                    setPending("draft");
                                    setLastAction("draft");
                                    setFailure(null);
                                    try {
                                        await draftAnswer(
                                            applicationId,
                                            section.id,
                                            buffer.baseRevision
                                        );
                                    } catch (error) {
                                        setFailure(error);
                                    } finally {
                                        busy.current = false;
                                        setPending(null);
                                    }
                                }}
                            >
                                {pending === "draft" ? (
                                    <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                                ) : (
                                    <Sparkles className="size-3.5" />
                                )}
                                {pending === "draft"
                                    ? t("drafting")
                                    : t("draft", { credits: format.number(home.costs.draft) })}
                            </Button>
                        )}
                    </div>
                )}
                {prose && empty && !manual && (
                    <p className="text-ink-3 text-xs leading-relaxed">{t("draftHint")}</p>
                )}
                {live && !manual && (
                    <p className="text-ink-3 text-xs leading-relaxed">
                        {t(editingRun ? "editRunning" : "draftRunning")}
                    </p>
                )}
                {failure != null && !(lastAction === "apply" && edit) && (
                    <p role="alert" className="text-danger text-sm">
                        {errorText(failure, t(`${lastAction}Failed`))}
                    </p>
                )}
            </form>
            {editable && !edit && (
                <section
                    aria-label={t("editToggle")}
                    className="border-line space-y-3 border-t pt-4"
                >
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-expanded={editOpen}
                        onClick={() => setEditOpen(open => !open)}
                    >
                        <PenLine className="size-3.5" />
                        {t("editToggle")}
                    </Button>
                    {editOpen && (
                        <div className="space-y-3">
                            <p className="text-ink-3 text-xs leading-relaxed">{t("editHint")}</p>
                            {activeSelection && !dirty ? (
                                <div className="space-y-1">
                                    <p className="text-ink-3 text-xs">
                                        {t("editSelected", {
                                            count: format.number(
                                                activeSelection.end - activeSelection.start
                                            ),
                                        })}
                                    </p>
                                    <blockquote
                                        data-testid="edit-selection"
                                        className="border-line bg-surface text-ink-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md border p-3 text-sm"
                                    >
                                        {savedText.slice(
                                            activeSelection.start,
                                            activeSelection.end
                                        )}
                                    </blockquote>
                                </div>
                            ) : (
                                <p role="status" className="text-ink-3 text-sm">
                                    {t(dirty ? "editNeedSaved" : "editNeedSelection")}
                                </p>
                            )}
                            <div className="space-y-1.5">
                                <Label htmlFor={`${id}-instruction`}>
                                    {t("editInstructionLabel")}
                                </Label>
                                <Input
                                    id={`${id}-instruction`}
                                    value={instruction}
                                    maxLength={600}
                                    placeholder={t("editInstructionPlaceholder")}
                                    disabled={pending !== null}
                                    onChange={event => setInstruction(event.target.value)}
                                    onKeyDown={event => {
                                        if (event.key === "Enter") {
                                            event.preventDefault();
                                            void suggest();
                                        }
                                    }}
                                />
                            </div>
                            {pendingEdit !== null && (
                                <p role="status" className="text-ink-3 text-sm">
                                    {t("editFinishFirst")}
                                </p>
                            )}
                            <Button
                                type="button"
                                size="sm"
                                disabled={
                                    !hasSelection ||
                                    dirty ||
                                    conflict ||
                                    instruction.trim() === "" ||
                                    pending !== null ||
                                    runBusy ||
                                    pendingEdit !== null ||
                                    restoringEdit
                                }
                                onClick={() => void suggest()}
                            >
                                {pending === "edit" ? (
                                    <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                                ) : (
                                    <Sparkles className="size-3.5" />
                                )}
                                {pending === "edit"
                                    ? t("editGenerating")
                                    : t("editGenerate", {
                                          credits: format.number(home?.costs.edit ?? 0),
                                      })}
                            </Button>
                        </div>
                    )}
                </section>
            )}
            {edit && (
                <EditSuggestionPanel
                    edit={edit}
                    stale={stale}
                    dirty={dirty}
                    canEdit={Boolean(home?.canEdit)}
                    credits={home?.costs.edit ?? 0}
                    applying={pending === "apply"}
                    failureText={
                        failure != null && lastAction === "apply"
                            ? errorText(failure, t("applyFailed"))
                            : null
                    }
                    onApply={() => void apply()}
                    onDiscard={() => {
                        setFailure(null);
                        dismissEdit();
                    }}
                />
            )}
            {section.draftMeta?.gaps.length ? (
                <section className="border-line space-y-2 border-t pt-4">
                    <h3 className="text-ink text-sm font-medium">{t("missingFacts")}</h3>
                    <ul className="text-ink-2 list-disc space-y-1 pl-5 text-sm">
                        {section.draftMeta.gaps.map((gap, index) => (
                            <li key={index}>{gap}</li>
                        ))}
                    </ul>
                </section>
            ) : null}
            {section.draftMeta?.evidence.length ? (
                <section className="border-line space-y-2 border-t pt-4">
                    <h3 className="text-ink text-sm font-medium">{t("evidence")}</h3>
                    {section.draftMeta.evidence.map(evidence => (
                        <div
                            key={evidence.n}
                            className="text-ink-2 space-y-1 text-xs leading-relaxed"
                        >
                            <p className="font-medium">
                                {evidence.page === null
                                    ? evidence.title
                                    : t("evidencePage", {
                                          title: evidence.title,
                                          page: evidence.page,
                                      })}
                            </p>
                            {evidence.quote && (
                                <blockquote className="whitespace-pre-wrap">
                                    {evidence.quote}
                                </blockquote>
                            )}
                        </div>
                    ))}
                </section>
            ) : null}
        </article>
    );
}

function FieldInput({
    id,
    field,
    value,
    disabled,
    invalid,
    describedBy,
    onChange,
    onSelectionChange,
}: {
    id: string;
    field: FormField;
    value: string;
    disabled: boolean;
    invalid: boolean;
    describedBy: string;
    onChange: (value: string) => void;
    /** UTF-16 offsets into `value`, as the browser reports them. */
    onSelectionChange?: (range: { start: number; end: number }) => void;
}) {
    const reportSelection = (element: HTMLInputElement | HTMLTextAreaElement) =>
        onSelectionChange?.({ start: element.selectionStart ?? 0, end: element.selectionEnd ?? 0 });
    const t = useTranslations("accelerators.field");
    const accessibility = {
        "aria-labelledby": `${id}-question`,
        "aria-describedby": describedBy,
        "aria-required": field.required,
        "aria-invalid": invalid,
    };
    switch (field.fieldType) {
        case "long_text":
            return (
                <Textarea
                    id={id}
                    {...accessibility}
                    value={value}
                    disabled={disabled}
                    onChange={event => onChange(event.target.value)}
                    onSelect={event => reportSelection(event.currentTarget)}
                    rows={7}
                    className="resize-y text-sm leading-relaxed"
                />
            );
        case "short_text":
        case "url":
        case "email":
        case "number":
        case "date":
            return (
                <Input
                    id={id}
                    {...accessibility}
                    type={INPUT_TYPES[field.fieldType]}
                    step={field.fieldType === "number" ? "any" : undefined}
                    value={value}
                    disabled={disabled}
                    onChange={event => onChange(event.target.value)}
                    onSelect={event => reportSelection(event.currentTarget)}
                />
            );
        case "select":
            return (
                <div className="flex items-center gap-2">
                    <Select value={value} disabled={disabled} onValueChange={onChange}>
                        <SelectTrigger id={id} {...accessibility}>
                            <SelectValue placeholder={t("choose")} />
                        </SelectTrigger>
                        <SelectContent>
                            {field.options.map(option => (
                                <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {value && !disabled && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => onChange("")}
                        >
                            {t("clearChoice")}
                        </Button>
                    )}
                </div>
            );
        case "multi_select": {
            let selected: string[] = [];
            try {
                const parsed: unknown = JSON.parse(value || "[]");
                if (Array.isArray(parsed) && parsed.every(item => typeof item === "string"))
                    selected = parsed;
            } catch {
                /* Validation shows malformed saved values without replacing them. */
            }
            return (
                <div id={id} role="group" {...accessibility} className="space-y-3">
                    {field.options.map((option, index) => (
                        <div key={option.value} className="flex items-start gap-2.5">
                            <Checkbox
                                id={`${id}-${index}`}
                                disabled={disabled}
                                checked={selected.includes(option.value)}
                                onCheckedChange={checked => {
                                    const next =
                                        checked === true
                                            ? [...selected, option.value]
                                            : selected.filter(item => item !== option.value);
                                    onChange(JSON.stringify(next));
                                }}
                            />
                            <Label
                                htmlFor={`${id}-${index}`}
                                className="text-ink-2 cursor-pointer text-sm font-normal leading-4"
                            >
                                {option.label}
                            </Label>
                        </div>
                    ))}
                </div>
            );
        }
        case "file":
        case "video":
            return null;
    }
}
