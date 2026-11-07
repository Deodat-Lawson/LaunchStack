"use client";

import {
    Building2,
    CircleAlert,
    File as FileIcon,
    FileAudio,
    FileImage,
    FileSpreadsheet,
    FileText,
    Globe,
    Loader2,
    Presentation,
    X,
    type LucideIcon,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback } from "react";

import { Button } from "~/components/ui/button";
import type { ScenarioFileOption } from "~/lib/scenarios/types";
import { useToolFormat } from "~/lib/tools/format";
import { cn } from "~/lib/utils";

import { UPLOAD_FOLDER, fileKind, sizeParts, type FileKind } from "../_lib/files";
import type { UploadItem } from "../_lib/useUploads";

const KIND_LOOK: Record<FileKind, { icon: LucideIcon; tile: string }> = {
    pdf: { icon: FileText, tile: "bg-danger-soft text-danger" },
    doc: { icon: FileText, tile: "bg-info-soft text-info-ink" },
    slides: { icon: Presentation, tile: "bg-warn-soft text-warn-ink" },
    sheet: { icon: FileSpreadsheet, tile: "bg-success-soft text-success-ink" },
    web: { icon: Globe, tile: "bg-brand-soft text-brand-ink" },
    text: { icon: FileText, tile: "bg-panel-2 text-ink-2" },
    transcript: { icon: FileAudio, tile: "bg-panel-2 text-ink-2" },
    image: { icon: FileImage, tile: "bg-panel-2 text-ink-2" },
    file: { icon: FileIcon, tile: "bg-panel-2 text-ink-2" },
};

/** "12 KB", "1.4 MB" — the number in the reader's locale. */
function useFormatSize(): (bytes: number) => string {
    const t = useTranslations("scenarios.files.size");
    const format = useFormatter();
    return useCallback(
        (bytes: number) => {
            const { unit, value, digits } = sizeParts(bytes);
            return t(unit, {
                size: format.number(value, {
                    minimumFractionDigits: digits,
                    maximumFractionDigits: digits,
                }),
            });
        },
        [t, format]
    );
}

/** A file's kind as a small coloured tile, the way a file browser shows it. */
export function FileGlyph({ kind, className }: { kind: FileKind; className?: string }) {
    const look = KIND_LOOK[kind];
    const Icon = look.icon;
    return (
        <span
            aria-hidden
            className={cn(
                "inline-flex size-8 shrink-0 items-center justify-center rounded-md",
                look.tile,
                className
            )}
        >
            <Icon className="size-4" />
        </span>
    );
}

/** "About your company": the company profile counts this file as the company's own. */
export function CompanyTag({ className }: { className?: string }) {
    const t = useTranslations("scenarios.files");
    return (
        <span
            className={cn(
                "bg-brand-soft text-brand-ink inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-px text-[11px] font-medium",
                className
            )}
            title={t("companyTitle")}
        >
            <Building2 className="size-3" aria-hidden />
            {t("aboutCompany")}
        </span>
    );
}

/** Folder · kind · when it was added (unless `compact`), and where reading it stands. */
export function FileMeta({ file, compact }: { file: ScenarioFileOption; compact?: boolean }) {
    const t = useTranslations("scenarios.files");
    const fmt = useToolFormat();
    const parts = [
        file.folder,
        t(`kind.${fileKind(file)}`),
        compact ? null : t("added", { when: fmt.relativeTime(file.addedAt) }),
    ].filter((p): p is string => Boolean(p));
    return (
        <span className="text-ink-3 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs">
            <span className="truncate">{parts.join(" · ")}</span>
            <FileStatus status={file.status} />
        </span>
    );
}

export function FileStatus({ status }: { status: ScenarioFileOption["status"] }) {
    const t = useTranslations("scenarios.files");
    if (status === "processing")
        return (
            <span className="text-ink-2 inline-flex items-center gap-1">
                <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />
                {t("reading")}
            </span>
        );
    if (status === "failed")
        return (
            <span className="text-danger inline-flex items-center gap-1">
                <CircleAlert className="size-3" aria-hidden />
                {t("unreadable")}
            </span>
        );
    return null;
}

/** A picked file in the situation box: what it is, and a way to take it out. */
export function AttachedFile({
    file,
    onRemove,
}: {
    file: ScenarioFileOption;
    onRemove: () => void;
}) {
    const t = useTranslations("scenarios.files");
    return (
        <li
            className={cn(
                "bg-surface flex min-w-0 items-center gap-2.5 rounded-lg border py-2 pl-2 pr-1",
                file.status === "failed" ? "border-danger/50" : "border-line"
            )}
        >
            <FileGlyph kind={fileKind(file)} />
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                    <span className="text-ink truncate text-[13px] font-medium" title={file.title}>
                        {file.title}
                    </span>
                    {file.aboutCompany && (
                        <Building2
                            className="text-brand-ink size-3 shrink-0"
                            aria-label={t("aboutCompany")}
                        />
                    )}
                </div>
                <FileMeta file={file} compact />
            </div>
            <RemoveButton label={t("remove", { name: file.title })} onClick={onRemove} />
        </li>
    );
}

/** An upload in the situation box, before it is a workspace file. */
export function UploadingFile({ item, onDismiss }: { item: UploadItem; onDismiss: () => void }) {
    const t = useTranslations("scenarios.files");
    const formatSize = useFormatSize();
    const failed = item.state === "failed";
    return (
        <li
            className={cn(
                "bg-surface flex min-w-0 items-center gap-2.5 rounded-lg border py-2 pl-2 pr-1",
                failed ? "border-danger/50" : "border-line border-dashed"
            )}
        >
            <FileGlyph kind={fileKind({ title: item.name, mimeType: null })} />
            <div className="min-w-0 flex-1">
                <span className="text-ink block truncate text-[13px] font-medium" title={item.name}>
                    {item.name}
                </span>
                {failed ? (
                    <span className="text-danger block text-xs leading-snug">
                        {item.message ?? t("uploadFailed")}
                    </span>
                ) : (
                    <span className="text-ink-2 inline-flex items-center gap-1 text-xs">
                        <Loader2
                            className="size-3 animate-spin motion-reduce:animate-none"
                            aria-hidden
                        />
                        {t("uploading", { size: formatSize(item.size) })}
                    </span>
                )}
            </div>
            {failed && (
                <RemoveButton label={t("dismiss", { name: item.name })} onClick={onDismiss} />
            )}
        </li>
    );
}

/** A file just uploaded that the file list has not caught up with yet. */
export function ArrivingFile({ name, onRemove }: { name: string; onRemove: () => void }) {
    const t = useTranslations("scenarios.files");
    return (
        <li className="border-line bg-surface flex min-w-0 items-center gap-2.5 rounded-lg border py-2 pl-2 pr-1">
            <FileGlyph kind={fileKind({ title: name, mimeType: null })} />
            <div className="min-w-0 flex-1">
                <span className="text-ink block truncate text-[13px] font-medium" title={name}>
                    {name}
                </span>
                <span className="text-ink-3 flex flex-wrap items-center gap-x-1.5 text-xs">
                    {UPLOAD_FOLDER}
                    <FileStatus status="processing" />
                </span>
            </div>
            <RemoveButton label={t("remove", { name })} onClick={onRemove} />
        </li>
    );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-ink-3 size-7 shrink-0"
            aria-label={label}
            title={label}
            onClick={onClick}
        >
            <X className="size-3.5" />
        </Button>
    );
}
