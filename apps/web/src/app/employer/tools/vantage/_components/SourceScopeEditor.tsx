"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "~/components/ui/collapsible";
import {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
} from "~/components/ui/select";
import type {
    WeeklyReviewSourceScope as SourceScope,
    WeeklyReviewSourceInspectionDto as SourceInspection,
} from "~/server/vantage/weekly-review-client-types";
export type {
    WeeklyReviewSourceScope as SourceScope,
    WeeklyReviewSourceInspectionDto as SourceInspection,
} from "~/server/vantage/weekly-review-client-types";
export type SourceChoice = {
    id: string;
    title: string;
    purpose: SourceInspection["purpose"];
    configurationVersion: number;
    hasHiddenSources?: boolean;
};
import { useVantageFormat } from "../_lib/format";
import { useWeeklyReviewErrorText } from "../_lib/weekly-review-errors";
type Reader = <T>(path: string) => Promise<T>;
type UnitDraft = { id: string; start: string; end: string };
const emptyUnit = (): UnitDraft => ({ id: "", start: "", end: "" });
function splitsSurrogate(text: string, offset: number) {
    return (
        offset > 0 &&
        offset < text.length &&
        text.charCodeAt(offset - 1) >= 0xd800 &&
        text.charCodeAt(offset - 1) <= 0xdbff &&
        text.charCodeAt(offset) >= 0xdc00 &&
        text.charCodeAt(offset) <= 0xdfff
    );
}
export async function buildSourceScope(
    preview: NonNullable<SourceInspection["preview"]>,
    qualification: string,
    drafts: UnitDraft[]
): Promise<SourceScope> {
    if (
        !qualification.trim() ||
        qualification.trim().length > 500 ||
        !drafts.length ||
        drafts.length > 16
    )
        throw Error("invalidScope");
    const units = drafts.map(unit => ({
        id: unit.id.trim(),
        start: Number(unit.start),
        end: Number(unit.end),
        validNumbers: /^(0|[1-9]\d*)$/.test(unit.start) && /^(0|[1-9]\d*)$/.test(unit.end),
    }));
    const ordered = [...units].sort((a, b) => a.start - b.start);
    if (
        new Set(units.map(unit => unit.id)).size !== units.length ||
        ordered.some(
            (unit, index) =>
                !unit.id ||
                unit.id.length > 200 ||
                !unit.validNumbers ||
                !Number.isSafeInteger(unit.start) ||
                !Number.isSafeInteger(unit.end) ||
                unit.start >= unit.end ||
                unit.end > preview.text.length ||
                unit.end - unit.start > 6000 ||
                splitsSurrogate(preview.text, unit.start) ||
                splitsSurrogate(preview.text, unit.end) ||
                (index > 0 && unit.start < ordered[index - 1]!.end)
        )
    )
        throw Error("invalidScope");
    const requiredUnits = await Promise.all(
        units.map(async unit => {
            const digest = await crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(preview.text.slice(unit.start, unit.end))
            );
            const excerptHash = Array.from(new Uint8Array(digest), byte =>
                byte.toString(16).padStart(2, "0")
            ).join("");
            return { id: unit.id, start: unit.start, end: unit.end, excerptHash };
        })
    );
    return {
        version: preview.version,
        expectedParentHash: preview.parentHash,
        qualification: qualification.trim(),
        requiredUnits,
    };
}

export function SourceScopeEditor({
    sources,
    read,
    disabled,
    scopedEnabled,
    onSave,
}: {
    sources: SourceChoice[];
    read: Reader;
    disabled: boolean;
    scopedEnabled: boolean;
    onSave: (source: SourceChoice, scope: SourceScope | null, version: number) => Promise<void>;
}) {
    const t = useTranslations("vantage.weeklyReview");
    const [selected, setSelected] = useState("");
    const source = sources.find(source => `${source.purpose}:${source.id}` === selected);
    return (
        <Collapsible className="border-line space-y-3 rounded border p-4">
            <CollapsibleTrigger asChild>
                <Button variant="ghost">{t("advancedScope")}</Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3">
                <Label htmlFor="scope-source">{t("sourceToInspect")}</Label>
                <Select
                    value={selected || undefined}
                    disabled={disabled}
                    onValueChange={setSelected}
                >
                    <SelectTrigger id="scope-source">
                        <SelectValue placeholder={t("selectDocument")} />
                    </SelectTrigger>
                    <SelectContent>
                        {sources.map(source => (
                            <SelectItem
                                key={`${source.purpose}:${source.id}`}
                                value={`${source.purpose}:${source.id}`}
                            >
                                {source.title} ({t(source.purpose)})
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {source && (
                    <ScopePreview
                        key={selected}
                        source={source}
                        read={read}
                        disabled={disabled}
                        scopedEnabled={scopedEnabled}
                        onSave={onSave}
                    />
                )}
            </CollapsibleContent>
        </Collapsible>
    );
}

function ScopePreview({
    source,
    read,
    disabled,
    scopedEnabled,
    onSave,
}: {
    source: SourceChoice;
    read: Reader;
    disabled: boolean;
    scopedEnabled: boolean;
    onSave: (source: SourceChoice, scope: SourceScope | null, version: number) => Promise<void>;
}) {
    const t = useTranslations("vantage.weeklyReview");
    const errorText = useWeeklyReviewErrorText();
    const fmt = useVantageFormat();
    const [version, setVersion] = useState("");
    const [inspection, setInspection] = useState<SourceInspection | null>(null);
    const [error, setError] = useState("");
    const [qualification, setQualification] = useState("");
    const [units, setUnits] = useState<UnitDraft[]>([emptyUnit()]);
    const [saving, setSaving] = useState(false);
    const [retry, setRetry] = useState(0);
    const request = useRef(0);
    const invalidate = useCallback(() => {
        request.current++;
    }, []);
    useEffect(() => {
        const identity = ++request.current;
        setInspection(null);
        setError("");
        const query = new URLSearchParams({ documentId: source.id, purpose: source.purpose });
        if (version) query.set("version", version);
        read<SourceInspection>("/context/source?" + query.toString())
            .then(value => {
                if (request.current !== identity) return;
                setInspection(value);
                const pin = !version && value.pin?.status === "valid" ? value.pin.scope : null;
                setQualification(pin?.qualification ?? "");
                setUnits(
                    pin?.requiredUnits.map(unit => ({
                        id: unit.id,
                        start: String(unit.start),
                        end: String(unit.end),
                    })) ?? [emptyUnit()]
                );
            })
            .catch(() => {
                if (request.current === identity) setError("sourcePreviewUnavailable");
            });
        return invalidate;
    }, [read, source.id, source.purpose, version, retry, invalidate]);
    const preview = inspection?.preview;
    const stale = inspection && inspection.configurationVersion !== source.configurationVersion;
    const unchanged = Boolean(
        inspection?.pin?.status === "valid" &&
            preview?.version === inspection.pin.scope.version &&
            qualification.trim() === inspection.pin.scope.qualification &&
            JSON.stringify(
                units.map(unit => ({
                    id: unit.id.trim(),
                    start: Number(unit.start),
                    end: Number(unit.end),
                }))
            ) ===
                JSON.stringify(
                    inspection.pin.scope.requiredUnits.map(({ id, start, end }) => ({
                        id,
                        start,
                        end,
                    }))
                )
    );
    const blocked =
        disabled || saving || !inspection || Boolean(stale) || Boolean(source.hasHiddenSources);
    async function save(clear: boolean) {
        if (!inspection || blocked || (!clear && (!preview || !scopedEnabled))) return;
        const identity = request.current;
        setSaving(true);
        setError("");
        try {
            const scope = clear ? null : await buildSourceScope(preview!, qualification, units);
            if (request.current === identity)
                await onSave(source, scope, inspection.configurationVersion);
        } catch (reason) {
            if (request.current === identity)
                setError(
                    reason instanceof Error && reason.message === "invalidScope"
                        ? t("invalidScope")
                        : errorText(reason)
                );
        } finally {
            if (request.current === identity) setSaving(false);
        }
    }
    return (
        <div className="space-y-3">
            {error && (
                <div>
                    <p role="alert">
                        {error === "sourcePreviewUnavailable"
                            ? t("sourcePreviewUnavailable")
                            : error}
                    </p>
                    {!inspection && (
                        <Button
                            variant="outline"
                            onClick={() => {
                                setVersion("");
                                setRetry(previous => previous + 1);
                            }}
                        >
                            {t("retrySourceInspection")}
                        </Button>
                    )}
                </div>
            )}
            {!inspection && !error && <p role="status">{t("loadingEvidence")}</p>}
            {inspection && (
                <>
                    {source.hasHiddenSources && <p role="alert">{t("hiddenConfiguration")}</p>}
                    {stale && <p role="alert">{t("staleScopeConfiguration")}</p>}
                    <p role="status">
                        {t(inspection.pin ? `pin_${inspection.pin.status}` : "pin_none")}
                    </p>
                    {inspection.pin && (
                        <p>
                            {t("sourceVersion")}: {inspection.pin.scope.version}
                        </p>
                    )}
                    {inspection.pin && (
                        <Button variant="outline" disabled={blocked} onClick={() => save(true)}>
                            {t("clearPinnedScope")}
                        </Button>
                    )}
                    <Label htmlFor="scope-version">{t("sourceVersion")}</Label>
                    <Select
                        value={version.length > 0 ? version : (preview?.version ?? undefined)}
                        disabled={disabled || saving}
                        onValueChange={value => {
                            invalidate();
                            setInspection(null);
                            setVersion(value);
                        }}
                    >
                        <SelectTrigger id="scope-version">
                            <SelectValue placeholder={t("chooseExplicitVersion")} />
                        </SelectTrigger>
                        <SelectContent>
                            {inspection.versions.map(item => (
                                <SelectItem key={item.version} value={item.version}>
                                    {item.version} ({fmt.dateTime(item.createdAt)})
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {preview && (
                        <>
                            <p>
                                {t("sourceVersion")}: {preview.version}
                            </p>
                            <p className="break-all text-xs">
                                {t("parentHash", { hash: preview.parentHash })}
                            </p>
                            <p className="text-sm">
                                {t("scopeRangeHelp", { length: preview.text.length })}
                            </p>
                            <p className="text-sm">{t("originalCompletenessUnknown")}</p>
                            <Label htmlFor="scope-canonical-text">
                                {t("canonicalIndexedText")}
                            </Label>
                            <Textarea
                                id="scope-canonical-text"
                                readOnly
                                value={preview.text}
                                className="max-h-80 min-h-40"
                            />
                            <Collapsible>
                                <CollapsibleTrigger asChild>
                                    <Button variant="ghost">{t("chunkAnchors")}</Button>
                                </CollapsibleTrigger>
                                <CollapsibleContent>
                                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">
                                        {JSON.stringify(preview.chunks, null, 2)}
                                    </pre>
                                </CollapsibleContent>
                            </Collapsible>
                            <Label htmlFor="scope-qualification">{t("scopeQualification")}</Label>
                            <Textarea
                                id="scope-qualification"
                                value={qualification}
                                maxLength={500}
                                disabled={disabled || saving}
                                onChange={event => setQualification(event.target.value)}
                            />
                            {units.map((unit, index) => (
                                <fieldset
                                    key={index}
                                    className="border-line space-y-2 rounded border p-3"
                                >
                                    <legend>{t("scopeUnit", { number: index + 1 })}</legend>
                                    {(["id", "start", "end"] as const).map(field => (
                                        <div key={field}>
                                            <Label htmlFor={`scope-unit-${index}-${field}`}>
                                                {t(`unit_${field}`, { number: index + 1 })}
                                            </Label>
                                            <Input
                                                id={`scope-unit-${index}-${field}`}
                                                type={field === "id" ? "text" : "number"}
                                                min={field === "id" ? undefined : 0}
                                                step={field === "id" ? undefined : 1}
                                                value={unit[field]}
                                                disabled={disabled || saving}
                                                onChange={event => {
                                                    const value = event.target.value;
                                                    setUnits(previous =>
                                                        previous.map((unit, position) =>
                                                            position === index
                                                                ? { ...unit, [field]: value }
                                                                : unit
                                                        )
                                                    );
                                                }}
                                            />
                                        </div>
                                    ))}
                                    {/^\d+$/.test(unit.start) &&
                                        /^\d+$/.test(unit.end) &&
                                        Number(unit.start) < Number(unit.end) && (
                                            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words">
                                                {preview.text.slice(
                                                    Number(unit.start),
                                                    Number(unit.end)
                                                )}
                                            </pre>
                                        )}
                                    <Button
                                        variant="outline"
                                        disabled={blocked || units.length === 1}
                                        onClick={() =>
                                            setUnits(previous =>
                                                previous.filter((_, position) => position !== index)
                                            )
                                        }
                                    >
                                        {t("removeUnit", { number: index + 1 })}
                                    </Button>
                                </fieldset>
                            ))}
                            <Button
                                variant="outline"
                                disabled={blocked || units.length >= 16}
                                onClick={() => setUnits(previous => [...previous, emptyUnit()])}
                            >
                                {t("addEvidenceUnit")}
                            </Button>
                            {!scopedEnabled && <p>{t("scopeEditingDisabled")}</p>}
                            <Button
                                disabled={blocked || !scopedEnabled || unchanged}
                                onClick={() => save(false)}
                            >
                                {t("approveFiniteScope")}
                            </Button>
                        </>
                    )}
                </>
            )}
        </div>
    );
}
