"use client";

import { FilePlus2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useToolNav } from "~/components/tool-app/nav";
import { InlineError } from "~/components/tools/EmptyState";
import { PageHeader, SectionHeading } from "~/components/tools/PageHeader";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Skeleton } from "~/components/ui/skeleton";
import { Spinner } from "~/components/ui/spinner";
import { EXTRACTION_LIMITS } from "~/lib/extraction/types";
import { useErrorText } from "~/lib/tools/errorText";
import { useResource } from "~/lib/tools/useResource";

import { extractApi } from "../api";
import { KindGlyph } from "../_components/Bits";
import { DocumentPickerDialog } from "../_components/DocumentPickerDialog";
import { FieldsEditor } from "../_components/FieldsEditor";
import { useExtract } from "../_lib/context";
import { reconcileSelection } from "../_lib/documents";
import { blankField, fieldProblems, toFieldInputs, type FieldDraft } from "../_lib/fields";
import { tablePath, type ExtractScreen } from "../_lib/screens";

type NewScreenProps = { screen: Extract<ExtractScreen, { kind: "new" }> };

/**
 * A new table in three steps on one page: which documents (the rows), which
 * fields (the columns), then Run. Another surface can arrive with the
 * documents already chosen (`/new?docs=12,15`); the ones this member cannot
 * use yet are left out and the form says how many.
 */
export function NewScreen({ screen }: NewScreenProps) {
    const t = useTranslations("extract.new");
    const tw = useTranslations("extract.words");
    const errorText = useErrorText();
    const { navigate } = useToolNav();
    const { expectLive } = useExtract();
    const sourcesRes = useResource("extract:sources", () => extractApi.sources());
    const sources = useMemo(() => sourcesRes.data?.sources ?? [], [sourcesRes.data]);
    const maxDocuments = EXTRACTION_LIMITS.maxDocuments;

    const [title, setTitle] = useState("");
    const [picked, setPicked] = useState<number[]>(screen.docs);
    const [dropped, setDropped] = useState(0);
    const [drafts, setDrafts] = useState<FieldDraft[]>(() => [blankField()]);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [attempted, setAttempted] = useState(false);
    const [busy, setBusy] = useState(false);

    // A deep link names documents before the list of what can be chosen has
    // loaded; once it has, keep the ones that can be.
    const reconciled = useRef(false);
    useEffect(() => {
        if (reconciled.current || !sourcesRes.data) return;
        reconciled.current = true;
        if (screen.docs.length === 0) return;
        const result = reconcileSelection(screen.docs, sourcesRes.data.sources, maxDocuments);
        setPicked(result.picked);
        setDropped(result.dropped);
    }, [sourcesRes.data, screen.docs, maxDocuments]);

    const byId = useMemo(() => new Map(sources.map(s => [s.documentId, s])), [sources]);
    const pickedSources = picked.flatMap(id => {
        const source = byId.get(id);
        return source ? [source] : [];
    });
    const loadingPicked = sourcesRes.loading && picked.length > 0;

    const problems = fieldProblems(drafts);
    const fieldsOk = Object.keys(problems).length === 0;
    const blocker = picked.length === 0 ? t("needDocuments") : !fieldsOk ? t("needFields") : null;

    const run = async () => {
        setAttempted(true);
        if (blocker || busy) return;
        setBusy(true);
        try {
            const trimmed = title.trim();
            const { table } = await extractApi.create({
                ...(trimmed ? { title: trimmed } : {}),
                fields: toFieldInputs(drafts),
                documentIds: picked,
            });
            expectLive();
            navigate(tablePath(table.id));
        } catch (e) {
            toast.error(errorText(e, t("runFailed")));
            setBusy(false);
        }
    };

    return (
        <div className="mx-auto flex max-w-[920px] flex-col gap-7">
            <PageHeader title={t("title")} sub={t("sub")} size="md" />

            <section className="flex max-w-[480px] flex-col gap-1.5">
                <Label htmlFor="extract-title">
                    {t("titleLabel")}{" "}
                    <span className="text-ink-3 font-normal">{t("optionalMark")}</span>
                </Label>
                <Input
                    id="extract-title"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder={t("titlePlaceholder")}
                    maxLength={EXTRACTION_LIMITS.titleLength}
                />
            </section>

            <section aria-label={t("documentsHeading")}>
                <SectionHeading title={t("documentsHeading")} aside={t("documentsAside")} />
                {sourcesRes.error && (
                    <InlineError
                        className="mb-2"
                        message={sourcesRes.error}
                        onRetry={() => void sourcesRes.reload()}
                    />
                )}
                {picked.length === 0 ? (
                    <div className="border-line bg-panel flex flex-col items-start gap-2 rounded-lg border border-dashed px-5 py-5">
                        <p className="text-ink-2 max-w-[60ch] text-sm">{t("documentsEmpty")}</p>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setPickerOpen(true)}
                        >
                            <FilePlus2 />
                            {t("chooseDocuments")}
                        </Button>
                        {attempted && (
                            <p role="alert" className="text-danger text-xs">
                                {t("needDocuments")}
                            </p>
                        )}
                    </div>
                ) : (
                    <div className="border-line bg-panel rounded-lg border">
                        <div className="border-line-2 flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
                            <span className="text-ink text-[13px] font-medium tabular-nums">
                                {t("documentsChosen", { count: picked.length })}
                            </span>
                            <div className="flex items-center gap-1">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        setPicked([]);
                                        setDropped(0);
                                    }}
                                >
                                    {t("clearDocuments")}
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setPickerOpen(true)}
                                >
                                    <FilePlus2 />
                                    {t("changeDocuments")}
                                </Button>
                            </div>
                        </div>
                        <ul className="max-h-[236px] overflow-y-auto">
                            {loadingPicked
                                ? picked.slice(0, 6).map(id => (
                                      <li
                                          key={id}
                                          className="border-line-2 flex h-9 items-center gap-3 border-t px-3 first:border-t-0"
                                      >
                                          <Skeleton className="size-4" />
                                          <Skeleton className="h-3 w-1/3" />
                                      </li>
                                  ))
                                : pickedSources.map(source => (
                                      <li
                                          key={source.documentId}
                                          className="border-line-2 flex h-9 items-center gap-2.5 border-t pl-3 pr-1 first:border-t-0"
                                      >
                                          <KindGlyph kind={source.kind} />
                                          <span className="text-ink min-w-0 flex-1 truncate text-[13px]">
                                              {source.title}
                                          </span>
                                          {source.folder && (
                                              <span className="text-ink-3 @max-sm:hidden max-w-[40%] shrink-0 truncate text-xs">
                                                  {source.folder}
                                              </span>
                                          )}
                                          <Button
                                              type="button"
                                              variant="ghost"
                                              size="icon"
                                              className="text-ink-3 size-7"
                                              aria-label={t("removeDocument", {
                                                  title: source.title,
                                              })}
                                              onClick={() =>
                                                  setPicked(current =>
                                                      current.filter(id => id !== source.documentId)
                                                  )
                                              }
                                          >
                                              <X />
                                          </Button>
                                      </li>
                                  ))}
                        </ul>
                    </div>
                )}
                {dropped > 0 && (
                    <p className="text-ink-3 mt-2 text-xs">
                        {t("documentsDropped", { count: dropped })}
                    </p>
                )}
            </section>

            <section aria-label={t("fieldsHeading")}>
                <SectionHeading title={t("fieldsHeading")} aside={t("fieldsAside")} />
                <FieldsEditor drafts={drafts} onChange={setDrafts} showAllProblems={attempted} />
            </section>

            <div className="border-line flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <div className="min-w-0">
                    <p className="text-ink text-sm font-medium tabular-nums">
                        {tw("size", { documents: picked.length, fields: drafts.length })}
                    </p>
                    <p
                        className={
                            attempted && blocker ? "text-danger text-xs" : "text-ink-3 text-xs"
                        }
                        aria-live="polite"
                    >
                        {attempted && blocker ? blocker : t("runNote")}
                    </p>
                </div>
                <Button type="button" onClick={() => void run()} disabled={busy}>
                    {busy && <Spinner />}
                    {t("run")}
                </Button>
            </div>

            <DocumentPickerDialog
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                sources={sources}
                loading={sourcesRes.loading}
                error={sourcesRes.error}
                onRetry={() => void sourcesRes.reload()}
                picked={picked}
                max={maxDocuments}
                onChange={setPicked}
            />
        </div>
    );
}
