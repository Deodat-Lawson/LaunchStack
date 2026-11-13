"use client";

import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Input } from "~/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import {
    EXTRACTION_FIELD_TYPES,
    EXTRACTION_LIMITS,
    type ExtractionFieldType,
} from "~/lib/extraction/types";
import { cn } from "~/lib/utils";

import {
    STARTER_SETS,
    blankField,
    fieldProblems,
    isUntouched,
    moveField,
    starterHintKey,
    type FieldDraft,
    type StarterSet,
} from "../_lib/fields";
import { TypeGlyph } from "./Bits";

/**
 * The columns of a table: a name, the kind of value, and — when the name
 * alone is not enough — what to look for. A starter set fills the rows for
 * a common kind of document; it asks first if that would replace something
 * typed. A row's problem (no name, a name used twice) is said under it:
 * a repeat at once, an empty name once the row has been left or Run pressed.
 */
export function FieldsEditor({
    drafts,
    onChange,
    showAllProblems,
}: {
    drafts: FieldDraft[];
    onChange: (next: FieldDraft[]) => void;
    /** Run was pressed: say every problem, including rows never touched. */
    showAllProblems: boolean;
}) {
    const t = useTranslations("extract.new");
    const tw = useTranslations("extract.words");
    const [left, setLeft] = useState<ReadonlySet<string>>(new Set());
    const [pendingStarter, setPendingStarter] = useState<StarterSet | null>(null);
    /** The key of a field just added with "Add field": its name takes the focus once it mounts. */
    const focusKey = useRef<string | null>(null);
    const problems = fieldProblems(drafts);
    const max = EXTRACTION_LIMITS.maxFields;
    const full = drafts.length >= max;

    const patch = (key: string, change: Partial<FieldDraft>) =>
        onChange(drafts.map(d => (d.key === key ? { ...d, ...change } : d)));

    const fill = (set: StarterSet) =>
        onChange(
            set.fields.map(field => {
                const hint = starterHintKey(field.key);
                return {
                    ...blankField(field.type),
                    name: t(`starterFields.${field.key}`),
                    instruction: hint ? t(`starterHints.${hint}`) : "",
                };
            })
        );

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-ink-3 text-xs">{t("startFrom")}</span>
                {STARTER_SETS.map(set => (
                    <Button
                        key={set.id}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2.5 text-xs"
                        onClick={() => (isUntouched(drafts) ? fill(set) : setPendingStarter(set))}
                    >
                        {t(`starters.${set.id}`)}
                    </Button>
                ))}
            </div>

            <div className="border-line bg-panel rounded-lg border">
                <div
                    aria-hidden
                    className="border-line-2 text-ink-3 @max-md:hidden grid grid-cols-[minmax(0,5fr)_9rem_minmax(0,7fr)_6.5rem] gap-2 border-b px-3 py-2 text-xs font-medium"
                >
                    <span>{t("fieldName")}</span>
                    <span>{t("fieldType")}</span>
                    <span>
                        {t("fieldInstruction")}{" "}
                        <span className="font-normal">{t("optionalMark")}</span>
                    </span>
                    <span />
                </div>
                <ol>
                    {drafts.map((draft, index) => {
                        const problem = problems[draft.key];
                        const shownProblem =
                            problem &&
                            (problem !== "empty" || showAllProblems || left.has(draft.key))
                                ? problem
                                : null;
                        const position = index + 1;
                        const label = draft.name.trim() || t("fieldNumber", { n: position });
                        const nameInvalid =
                            shownProblem !== null && shownProblem !== "instructionTooLong";
                        return (
                            <li
                                key={draft.key}
                                className="border-line-2 @max-md:grid-cols-[minmax(0,1fr)_auto] grid grid-cols-[minmax(0,5fr)_9rem_minmax(0,7fr)_6.5rem] items-center gap-2 border-t px-3 py-2 first:border-t-0"
                            >
                                <Input
                                    ref={el => {
                                        if (el && focusKey.current === draft.key) {
                                            focusKey.current = null;
                                            el.focus();
                                        }
                                    }}
                                    value={draft.name}
                                    onChange={e => patch(draft.key, { name: e.target.value })}
                                    onBlur={() =>
                                        setLeft(current => new Set(current).add(draft.key))
                                    }
                                    placeholder={t("fieldNamePlaceholder")}
                                    aria-label={t("fieldNameAria", { n: position })}
                                    aria-invalid={nameInvalid || undefined}
                                    aria-describedby={
                                        shownProblem ? `${draft.key}-problem` : undefined
                                    }
                                    maxLength={EXTRACTION_LIMITS.fieldNameLength}
                                    className="@max-md:col-span-2 h-8 md:text-[13px]"
                                />
                                <Select
                                    value={draft.type}
                                    onValueChange={value =>
                                        patch(draft.key, { type: value as ExtractionFieldType })
                                    }
                                >
                                    <SelectTrigger
                                        size="sm"
                                        className="w-full text-[13px]"
                                        aria-label={t("fieldTypeAria", { name: label })}
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {EXTRACTION_FIELD_TYPES.map(type => (
                                            <SelectItem key={type} value={type}>
                                                <span className="flex items-center gap-2">
                                                    <TypeGlyph type={type} />
                                                    {tw(`types.${type}`)}
                                                </span>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Input
                                    value={draft.instruction}
                                    onChange={e =>
                                        patch(draft.key, { instruction: e.target.value })
                                    }
                                    placeholder={t("fieldInstructionPlaceholder")}
                                    aria-label={t("fieldInstructionAria", { name: label })}
                                    aria-invalid={
                                        shownProblem === "instructionTooLong" || undefined
                                    }
                                    maxLength={EXTRACTION_LIMITS.instructionLength}
                                    className="@max-md:order-last @max-md:col-span-2 h-8 md:text-[13px]"
                                />
                                <div className="flex items-center justify-end">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="text-ink-3 size-8"
                                        disabled={index === 0}
                                        aria-label={t("moveUp", { name: label })}
                                        onClick={() => onChange(moveField(drafts, index, -1))}
                                    >
                                        <ArrowUp />
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="text-ink-3 size-8"
                                        disabled={index === drafts.length - 1}
                                        aria-label={t("moveDown", { name: label })}
                                        onClick={() => onChange(moveField(drafts, index, 1))}
                                    >
                                        <ArrowDown />
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="text-ink-3 size-8"
                                        disabled={drafts.length === 1}
                                        aria-label={t("removeField", { name: label })}
                                        onClick={() =>
                                            onChange(drafts.filter(d => d.key !== draft.key))
                                        }
                                    >
                                        <X />
                                    </Button>
                                </div>
                                {shownProblem && (
                                    <p
                                        id={`${draft.key}-problem`}
                                        className="text-danger col-span-full text-xs"
                                    >
                                        {t(`problems.${shownProblem}`, {
                                            max:
                                                shownProblem === "instructionTooLong"
                                                    ? EXTRACTION_LIMITS.instructionLength
                                                    : EXTRACTION_LIMITS.fieldNameLength,
                                        })}
                                    </p>
                                )}
                            </li>
                        );
                    })}
                </ol>
                <div className="border-line-2 flex items-center justify-between gap-3 border-t px-3 py-2">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={full}
                        onClick={() => {
                            const added = blankField();
                            focusKey.current = added.key;
                            onChange([...drafts, added]);
                        }}
                    >
                        <Plus />
                        {t("addField")}
                    </Button>
                    <span
                        className={cn(
                            "text-xs tabular-nums",
                            full ? "text-warn-ink" : "text-ink-3"
                        )}
                    >
                        {t("fieldCount", { count: drafts.length, max })}
                    </span>
                </div>
            </div>

            <ConfirmDialog
                open={pendingStarter !== null}
                onOpenChange={open => !open && setPendingStarter(null)}
                title={t("replaceTitle")}
                description={t("replaceBody")}
                confirmLabel={t("replaceConfirm")}
                destructive={false}
                onConfirm={() => pendingStarter && fill(pendingStarter)}
            />
        </div>
    );
}
