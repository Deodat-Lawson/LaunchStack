"use client";
import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Check } from "lucide-react";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Textarea } from "~/components/ui/textarea";
import { Label } from "~/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { ReviewCitationChips, type ReviewSource } from "./ReviewCitationChips";
import { ReviewCommitmentDialog } from "./ReviewCommitmentDialog";
import { useVantageFormat } from "../_lib/format";
import type { WeeklyReviewContextDto, WeeklyReviewDto } from "../api";

type Topic = WeeklyReviewDto["report"]["topics"][number];
export function WeeklyReviewTopicCard({
    topic,
    decisions,
    draft,
    onDraft,
    onRecord,
    saving,
    disabled,
    error,
    sources,
    documents,
    onInspect,
    added,
    onAdded,
}: {
    topic: Topic;
    decisions: WeeklyReviewDto["decisions"];
    draft: string;
    onDraft: (text: string) => void;
    onRecord: () => void;
    saving: boolean;
    disabled: boolean;
    error?: string;
    sources: ReviewSource[];
    documents?: WeeklyReviewContextDto["documents"];
    onInspect: (ref: string) => void;
    added: boolean;
    onAdded: () => void;
}) {
    const t = useTranslations("vantage.weeklyReview");
    const fmt = useVantageFormat();
    const id = useId();
    const [editing, setEditing] = useState(false);
    const [commitment, setCommitment] = useState(false);
    const versions = decisions
        .filter(decision => decision.topicId === topic.id)
        .sort((a, b) => b.version - a.version);
    const latest = versions[0];
    const recommendation = topic.recommendation;
    return (
        <Card>
            <CardContent className="space-y-5 p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-ink-2 text-sm font-medium">{topic.title}</p>
                    <Badge variant={latest ? "success" : "warn"}>
                        {t(latest ? "founder.decided" : "founder.needsDecision")}
                    </Badge>
                </div>
                <h2 className="text-xl font-semibold">{topic.decisionQuestion}</h2>
                {recommendation ? (
                    <div className="bg-panel-2 space-y-2 rounded-lg p-4">
                        <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-ink-2 text-xs font-medium">
                                {t("founder.recommendation")}
                            </h3>
                            <Badge variant="outline">
                                {t("founder.confidence", {
                                    level: t(
                                        `founder.confidenceLevel.${recommendation.confidence}`
                                    ),
                                })}
                            </Badge>
                        </div>
                        <p className="font-medium">{recommendation.call}</p>
                        <p className="text-sm">
                            <span className="text-ink-2">{t("founder.because")}: </span>
                            {recommendation.because}
                        </p>
                        <p className="text-sm">
                            <span className="text-ink-2">{t("founder.wouldChangeIf")}: </span>
                            {recommendation.wouldChangeIf}
                        </p>
                        <ReviewCitationChips
                            refs={recommendation.refs}
                            sources={sources}
                            documents={documents}
                            onInspect={onInspect}
                        />
                    </div>
                ) : null}
                <dl className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                    {(
                        [
                            ["nextStep", topic.proposedNextStep],
                            ["owner", topic.proposedOwner],
                            ["due", topic.proposedDue ? fmt.date(topic.proposedDue) : null],
                            ["help", topic.helpRequested],
                        ] as const
                    )
                        .filter(([, value]) => value)
                        .map(([label, value]) => (
                            <div key={label} className="flex flex-wrap gap-x-2">
                                <dt className="text-ink-2">{t(`founder.${label}`)}</dt>
                                <dd>{value}</dd>
                            </div>
                        ))}
                </dl>
                <section className="border-brand/30 space-y-3 rounded-lg border p-4">
                    {latest ? (
                        <>
                            <h3 className="font-semibold">{t("founder.humanDecision")}</h3>
                            <p className="whitespace-pre-wrap">{latest.decision}</p>
                            <p className="text-ink-2 text-xs">
                                {t("founder.decisionVersion", {
                                    version: latest.version,
                                    date: fmt.dateTime(latest.recordedAt),
                                })}
                            </p>
                            {!editing && !draft ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setEditing(true)}
                                    disabled={disabled}
                                >
                                    {t("founder.changeDecision")}
                                </Button>
                            ) : null}
                        </>
                    ) : null}
                    {!latest || editing || draft ? (
                        <div className="space-y-2">
                            <Label htmlFor={id}>{t("founder.decisionDraft")}</Label>
                            <Textarea
                                id={id}
                                placeholder={t("founder.decisionPlaceholder")}
                                value={draft}
                                onChange={event => onDraft(event.target.value)}
                                maxLength={2000}
                            />
                            <Button
                                disabled={disabled || saving || !draft.trim()}
                                onClick={onRecord}
                            >
                                {t(saving ? "founder.savingDecision" : "founder.recordDecision")}
                            </Button>
                        </div>
                    ) : null}
                    {error ? (
                        <p role="alert" className="text-danger text-sm">
                            {error}
                        </p>
                    ) : null}
                    {versions.length > 1 ? (
                        <Collapsible>
                            <CollapsibleTrigger asChild>
                                <Button variant="ghost" size="sm">
                                    {t("founder.previousDecisions")}
                                </Button>
                            </CollapsibleTrigger>
                            <CollapsibleContent className="space-y-3">
                                {versions.slice(1).map(decision => (
                                    <div key={decision.version}>
                                        <p className="whitespace-pre-wrap text-sm">
                                            {decision.decision}
                                        </p>
                                        <p className="text-ink-2 text-xs">
                                            {t("founder.decisionVersion", {
                                                version: decision.version,
                                                date: fmt.dateTime(decision.recordedAt),
                                            })}
                                        </p>
                                    </div>
                                ))}
                            </CollapsibleContent>
                        </Collapsible>
                    ) : null}
                </section>
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        onClick={() => setCommitment(true)}
                        disabled={disabled}
                    >
                        {t("founder.addCommitment")}
                    </Button>
                    {added ? (
                        <Badge variant="success">
                            <Check aria-hidden="true" />
                            {t("founder.added")}
                        </Badge>
                    ) : null}
                </div>
                <Collapsible>
                    <CollapsibleTrigger asChild>
                        <Button
                            variant="ghost"
                            className="max-w-full gap-2 whitespace-normal text-left"
                        >
                            <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
                            {t("founder.whyEvidence")}
                            {topic.conflicts.length || topic.unknowns.length ? (
                                <Badge variant="warn">
                                    {t("founder.cautionCount", {
                                        conflicts: topic.conflicts.length,
                                        unknowns: topic.unknowns.length,
                                    })}
                                </Badge>
                            ) : null}
                        </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-4 pt-3">
                        {(
                            [
                                ["facts", topic.facts],
                                ["conflicts", topic.conflicts],
                            ] as const
                        ).map(([label, items]) =>
                            items.length ? (
                                <section key={label}>
                                    <h3 className="text-sm font-semibold">
                                        {t(`founder.${label}`)}
                                    </h3>
                                    <ul className="space-y-3 pt-2">
                                        {items.map((fact, index) => (
                                            <li key={index} className="space-y-2 text-sm">
                                                <p>{fact.text}</p>
                                                <ReviewCitationChips
                                                    refs={fact.refs}
                                                    sources={sources}
                                                    documents={documents}
                                                    onInspect={onInspect}
                                                />
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            ) : null
                        )}
                        {(
                            [
                                ["whyItMatters", topic.whyItMatters],
                                ["whyNow", topic.whyNow],
                                ["rationale", topic.rationale],
                            ] as const
                        ).map(([label, value]) => (
                            <section key={label}>
                                <h3 className="text-sm font-semibold">{t(`founder.${label}`)}</h3>
                                <p className="text-ink-2 text-sm">{value}</p>
                            </section>
                        ))}
                        {topic.unknowns.length ? (
                            <section>
                                <h3 className="text-sm font-semibold">{t("founder.unknowns")}</h3>
                                <ul className="text-ink-2 list-inside list-disc text-sm">
                                    {topic.unknowns.map((unknown, index) => (
                                        <li key={index}>{unknown}</li>
                                    ))}
                                </ul>
                            </section>
                        ) : null}
                    </CollapsibleContent>
                </Collapsible>
                {commitment ? (
                    <ReviewCommitmentDialog
                        topic={topic}
                        onClose={() => setCommitment(false)}
                        onAdded={onAdded}
                    />
                ) : null}
            </CardContent>
        </Card>
    );
}
