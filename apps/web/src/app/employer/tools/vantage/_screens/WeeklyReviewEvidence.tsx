"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";

export type SourcePurpose = "company-architecture" | "workspace-required" | "personal-star";
export type SourceScope = {
    version: string;
    expectedParentHash: string;
    qualification: string;
    requiredUnits: { id: string; start: number; end: number; excerptHash: string }[];
};
export type SourceChoice = {
    id: string;
    title: string;
    purpose: SourcePurpose;
    configurationVersion: number;
    hasHiddenSources?: boolean;
};
type Reader = <T>(path: string) => Promise<T>;
type FrozenEvidence = {
    ref: string;
    title: string;
    text: string;
    version: string;
    hash: string;
    purpose: string;
    scope: null | {
        parentHash: string;
        scopeHash: string;
        start: number;
        end: number;
        anchors: unknown[];
        coverage: { qualification: string };
        offsetEncoding: "utf16_half_open";
    };
};
export type SourceInspection = {
    document: { id: string; title: string };
    purpose: SourcePurpose;
    configurationVersion: number;
    pin: null | {
        status: "valid" | "missing_version" | "content_changed" | "unavailable";
        scope: SourceScope;
    };
    versions: { version: string; createdAt: string }[];
    preview: null | {
        version: string;
        parentHash: string;
        text: string;
        chunks: { id: string; ordinal: number; start: number; end: number }[];
        offsetEncoding: "utf16_half_open";
    };
};
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

export function EvidenceRefs({
    refs,
    onInspect,
}: {
    refs: string[];
    onInspect: (ref: string) => void;
}) {
    const t = useTranslations("vantage.weeklyReview");
    return (
        <span className="flex flex-wrap gap-2 text-xs">
            {refs.map(ref => (
                <button
                    key={ref}
                    type="button"
                    className="text-brand underline"
                    aria-label={t("inspectCitation", { ref })}
                    onClick={() => onInspect(ref)}
                >
                    {ref}
                </button>
            ))}
        </span>
    );
}

export function EvidenceInspector({
    reportId,
    reference,
    read,
    onClose,
}: {
    reportId: string;
    reference: string;
    read: Reader;
    onClose: () => void;
}) {
    const t = useTranslations("vantage.weeklyReview");
    const [evidence, setEvidence] = useState<FrozenEvidence | null>(null);
    const [error, setError] = useState("");
    useEffect(() => {
        let active = true;
        setEvidence(null);
        setError("");
        read<FrozenEvidence>(
            `/${encodeURIComponent(reportId)}/evidence?ref=${encodeURIComponent(reference)}`
        )
            .then(value => {
                if (active) setEvidence(value);
            })
            .catch(() => {
                if (active) setError("evidenceUnavailable");
            });
        return () => {
            active = false;
        };
    }, [read, reportId, reference]);
    return (
        <section
            aria-label={t("exactEvidence")}
            className="border-line space-y-3 rounded border p-4"
        >
            <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold">{t("exactEvidence")}</h2>
                <Button variant="outline" onClick={onClose}>
                    {t("closeEvidence")}
                </Button>
            </div>
            <p className="break-all text-xs">{reference}</p>
            {error ? (
                <p role="alert">{t("evidenceUnavailable")}</p>
            ) : !evidence ? (
                <p role="status">{t("loadingEvidence")}</p>
            ) : (
                <>
                    <h3>{evidence.title}</h3>
                    <p>{t("evidenceVersion", { version: evidence.version })}</p>
                    <p className="break-all text-xs">
                        {t("evidenceHash", { hash: evidence.hash })}
                    </p>
                    <p>{t("evidencePurpose", { purpose: evidence.purpose })}</p>
                    {evidence.scope && (
                        <div className="space-y-2 text-sm">
                            <p>
                                {t("utf16Range", {
                                    start: evidence.scope.start,
                                    end: evidence.scope.end,
                                })}
                            </p>
                            <p className="break-all">
                                {t("parentHash", { hash: evidence.scope.parentHash })}
                            </p>
                            <p className="break-all">
                                {t("scopeHash", { hash: evidence.scope.scopeHash })}
                            </p>
                            <p>{evidence.scope.coverage.qualification}</p>
                            <pre className="overflow-auto whitespace-pre-wrap break-words text-xs">
                                {JSON.stringify(evidence.scope.anchors, null, 2)}
                            </pre>
                        </div>
                    )}
                    <p className="text-sm">{t("originalCompletenessUnknown")}</p>
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words">
                        {evidence.text}
                    </pre>
                </>
            )}
        </section>
    );
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
        <section
            aria-label={t("sourceScopePreview")}
            className="border-line space-y-3 rounded border p-4"
        >
            <h2 className="font-semibold">{t("sourceScopePreview")}</h2>
            <Label htmlFor="scope-source">{t("sourceToInspect")}</Label>
            <select
                id="scope-source"
                className="border-line w-full rounded border p-2"
                value={selected}
                disabled={disabled}
                onChange={event => setSelected(event.target.value)}
            >
                <option value="">{t("selectDocument")}</option>
                {sources.map(source => (
                    <option
                        key={`${source.purpose}:${source.id}`}
                        value={`${source.purpose}:${source.id}`}
                    >
                        {source.title} ({t(source.purpose)})
                    </option>
                ))}
            </select>
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
        </section>
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
    const [version, setVersion] = useState("");
    const [inspection, setInspection] = useState<SourceInspection | null>(null);
    const [error, setError] = useState<
        "" | "sourcePreviewUnavailable" | "invalidScope" | "scopeSaveFailed"
    >("");
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
                        ? "invalidScope"
                        : "scopeSaveFailed"
                );
        } finally {
            if (request.current === identity) setSaving(false);
        }
    }
    return (
        <div className="space-y-3">
            {error && (
                <div>
                    <p role="alert">{t(error)}</p>
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
                        <p>{t("evidenceVersion", { version: inspection.pin.scope.version })}</p>
                    )}
                    {inspection.pin && (
                        <Button variant="outline" disabled={blocked} onClick={() => save(true)}>
                            {t("clearPinnedScope")}
                        </Button>
                    )}
                    <Label htmlFor="scope-version">{t("sourceVersion")}</Label>
                    <select
                        id="scope-version"
                        className="border-line w-full rounded border p-2"
                        value={version.length > 0 ? version : (preview?.version ?? "")}
                        disabled={disabled || saving}
                        onChange={event => {
                            invalidate();
                            setInspection(null);
                            setVersion(event.target.value);
                        }}
                    >
                        <option value="">{t("chooseExplicitVersion")}</option>
                        {inspection.versions.map(item => (
                            <option key={item.version} value={item.version}>
                                {item.version} ({new Date(item.createdAt).toLocaleString()})
                            </option>
                        ))}
                    </select>
                    {preview && (
                        <>
                            <p>{t("evidenceVersion", { version: preview.version })}</p>
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
                            <details>
                                <summary>{t("chunkAnchors")}</summary>
                                <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">
                                    {JSON.stringify(preview.chunks, null, 2)}
                                </pre>
                            </details>
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
                                disabled={blocked || !scopedEnabled}
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
