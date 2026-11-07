"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "~/lib/auth-client";
import { useRouter } from "next/navigation";
import {
    Bug,
    CircleAlert,
    Copy,
    Lightbulb,
    Mail,
    MessageSquare,
    MessageSquareText,
    Phone,
    Send,
} from "lucide-react";
import { useTranslations } from "next-intl";

import type { SupportChannels } from "~/server/support";
import { useSourceFailureCopy, type SourceFailureReport } from "~/lib/source-failure";

import LoadingPage from "~/app/_components/loading";
import { useFeedback } from "~/components/feedback/FeedbackProvider";
import { EmployerChrome } from "~/app/employer/_components/EmployerChrome";
import { Button } from "~/components/ui/button";
import { Card, PageHeader, PageShell, Section } from "~/components/layout/page-shell";
import { Field, TextArea, TextInput } from "~/components/field";

export function ContactClient({
    support,
    report = null,
}: {
    support: SupportChannels;
    /** A failed source's details, when its "Contact us about this error" link opened the page. */
    report?: SourceFailureReport | null;
}) {
    const t = useTranslations("onboarding.contact");
    const tc = useTranslations("common");
    const failureCopy = useSourceFailureCopy();
    const feedback = useFeedback();
    const router = useRouter();
    const { isLoaded, userId } = useAuth();
    const [loading, setLoading] = useState(true);
    const reportText = report ? failureCopy.reportText(report) : null;
    const [formData, setFormData] = useState(() => ({
        name: "",
        email: "",
        subject: reportText?.subject ?? "",
        message: reportText ? `${t("messageTemplate")}\n\n\n—\n${reportText.details}` : "",
    }));

    useEffect(() => {
        if (!isLoaded) return;
        if (!userId) {
            router.push("/");
            return;
        }
        setLoading(false);
    }, [userId, router, isLoaded]);

    const handleInput = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    /**
     * Hand the message to the user's mail client, addressed to whatever support
     * address this instance configured.
     *
     * This used to `await new Promise(r => setTimeout(r, 1000))` and then report
     * success — the message went nowhere. There is no mail transport in this app
     * (the email-pipeline's default adapter logs to stdout), so rather than
     * pretend, compose a mailto: the user can actually see leave their outbox.
     */
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!support.email) return;
        const body = `${formData.message}\n\n—\nFrom: ${formData.name} <${formData.email}>`;
        window.location.href =
            `mailto:${support.email}` +
            `?subject=${encodeURIComponent(formData.subject)}` +
            `&body=${encodeURIComponent(body)}`;
    };

    if (loading) return <LoadingPage />;

    const canSubmit =
        !!formData.name.trim() &&
        !!formData.email.trim() &&
        !!formData.subject.trim() &&
        !!formData.message.trim();

    return (
        <>
            <EmployerChrome pageLabel="Launchstack" pageTitle={t("crumb")} />
            <PageShell>
                <PageHeader
                    title={report ? t("titleReport") : t("title")}
                    description={support.email ? t("descriptionMail") : t("description")}
                />

                {feedback.enabled && <InAppReporter onOpen={kind => feedback.open({ kind })} />}

                {report && reportText && (
                    <FailureReportCard
                        report={report}
                        details={reportText.details}
                        inMessage={Boolean(support.email)}
                    />
                )}

                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
                        gap: 20,
                    }}
                >
                    <Section>
                        <Card>
                            {!support.email ? (
                                // No support address configured. Say so plainly rather than
                                // showing a form whose submit button cannot do anything.
                                <div
                                    style={{
                                        fontSize: 13.5,
                                        color: "var(--ink-2)",
                                        lineHeight: 1.6,
                                    }}
                                >
                                    <p style={{ margin: "0 0 12px" }}>
                                        {t.rich("noAddress", {
                                            code: chunks => <code>{chunks}</code>,
                                        })}
                                    </p>
                                    <p style={{ margin: 0 }}>
                                        {t.rich("issueTracker", {
                                            link: chunks => (
                                                <a
                                                    href={support.issuesUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                >
                                                    {chunks}
                                                </a>
                                            ),
                                        })}
                                    </p>
                                </div>
                            ) : (
                                <form onSubmit={handleSubmit} style={{ display: "block" }}>
                                    <Field label={t("yourName")}>
                                        <TextInput
                                            name="name"
                                            value={formData.name}
                                            onChange={handleInput}
                                            placeholder={t("namePlaceholder")}
                                            required
                                        />
                                    </Field>
                                    <Field label={tc("fields.email")}>
                                        <TextInput
                                            type="email"
                                            name="email"
                                            value={formData.email}
                                            onChange={handleInput}
                                            placeholder="jane@company.com"
                                            required
                                        />
                                    </Field>
                                    <Field label={t("subject")}>
                                        <TextInput
                                            name="subject"
                                            value={formData.subject}
                                            onChange={handleInput}
                                            placeholder={t("subjectPlaceholder")}
                                            required
                                        />
                                    </Field>
                                    <Field label={t("message")}>
                                        <TextArea
                                            name="message"
                                            value={formData.message}
                                            onChange={handleInput}
                                            placeholder={t("messagePlaceholder")}
                                            rows={6}
                                            required
                                        />
                                    </Field>
                                    <div
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                            gap: 12,
                                        }}
                                    >
                                        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                                            {t("opensIn", { email: support.email })}
                                        </span>
                                        <Button type="submit" disabled={!canSubmit}>
                                            <Send style={{ width: 14, height: 14 }} />
                                            {t("compose")}
                                        </Button>
                                    </div>
                                </form>
                            )}
                        </Card>
                    </Section>

                    <Section>
                        <Card>
                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 14,
                                }}
                            >
                                {/*
                  These used to be Launchstack's own address, Discord and SLA,
                  hardcoded — which told every self-hosted instance's users to
                  contact a company they have no relationship with. Each row
                  now appears only if this deployment configured it.
                */}
                                {support.email && (
                                    <ContactRow
                                        Icon={Mail}
                                        label={tc("fields.email")}
                                        value={support.email}
                                        hint={t("rows.emailHint")}
                                    />
                                )}
                                {support.community && (
                                    <ContactRow
                                        Icon={MessageSquare}
                                        label={t("rows.community")}
                                        value={support.community}
                                        hint={t("rows.communityHint")}
                                    />
                                )}
                                {support.responseTime && (
                                    <ContactRow
                                        Icon={Phone}
                                        label={t("rows.responseTime")}
                                        value={support.responseTime}
                                        hint={t("rows.responseTimeHint")}
                                    />
                                )}
                                <ContactRow
                                    Icon={Bug}
                                    label={t("rows.software")}
                                    value={support.issuesUrl.replace(/^https?:\/\//, "")}
                                    hint={t("rows.softwareHint")}
                                />
                            </div>
                        </Card>
                    </Section>
                </div>
            </PageShell>
        </>
    );
}

/**
 * While the instance takes in-app reports, they are the better way to say
 * something is broken: stored, answered where the person will see it, with
 * the page and a screenshot attached. Mail stays for everything else.
 */
function InAppReporter({ onOpen }: { onOpen: (kind: "bug" | "idea") => void }) {
    const t = useTranslations("feedback.contact");
    const tEntry = useTranslations("feedback.entry");
    return (
        <div
            className="border-line bg-panel mb-5 flex flex-wrap items-center gap-3 rounded-[10px] border px-4 py-3.5"
            data-testid="contact-feedback"
        >
            <MessageSquareText className="text-brand size-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
                <div className="text-ink text-[13.5px] font-semibold">{t("title")}</div>
                <p className="text-ink-3 m-0 mt-0.5 text-[12.5px]">{t("body")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => onOpen("idea")}>
                    <Lightbulb aria-hidden />
                    {tEntry("requestFeature")}
                </Button>
                <Button size="sm" onClick={() => onOpen("bug")}>
                    <Bug aria-hidden />
                    {tEntry("reportBug")}
                </Button>
            </div>
        </div>
    );
}

/**
 * What the failed source's link carried, shown above the form so the person
 * can see what will be sent — and copy it, when this instance has no
 * support address and the issue tracker is the way to reach anyone.
 */
function FailureReportCard({
    report,
    details,
    inMessage,
}: {
    report: SourceFailureReport;
    details: string;
    /** The form below already carries them (a support address is configured). */
    inMessage: boolean;
}) {
    const t = useTranslations("onboarding.contact.report");
    const tc = useTranslations("common.actions");
    const { categoryName } = useSourceFailureCopy();
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(details);
            setCopied(true);
        } catch {
            // Clipboard refused — the details are on screen to select by hand.
        }
    };
    return (
        <div className="border-line bg-panel mb-5 flex items-start gap-3 rounded-[10px] border px-4 py-3.5">
            <CircleAlert className="text-danger mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
                <div className="text-ink text-[13.5px] font-semibold">
                    {categoryName(report.category)}
                </div>
                <dl className="text-ink-2 mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12.5px]">
                    <dt className="text-ink-3">{t("document")}</dt>
                    <dd className="truncate">{report.document}</dd>
                    {report.jobId && (
                        <>
                            <dt className="text-ink-3">{t("jobId")}</dt>
                            <dd className="mono select-all truncate text-[12px]">{report.jobId}</dd>
                        </>
                    )}
                </dl>
                <p className="text-ink-3 mt-2 text-[12px]">
                    {inMessage ? t("inMessage") : t("include")}
                </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void copy()}>
                <Copy aria-hidden />
                {copied ? tc("copied") : t("copy")}
            </Button>
        </div>
    );
}

interface ContactRowProps {
    Icon: React.ComponentType<{ style?: React.CSSProperties }>;
    label: string;
    value: string;
    hint: string;
}

function ContactRow({ Icon, label, value, hint }: ContactRowProps) {
    return (
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div
                style={{
                    width: 34,
                    height: 34,
                    borderRadius: 9,
                    background: "var(--accent-soft)",
                    color: "var(--accent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                }}
            >
                <Icon style={{ width: 16, height: 16 }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div
                    className="mono"
                    style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.1em",
                        color: "var(--ink-3)",
                        textTransform: "uppercase",
                    }}
                >
                    {label}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", marginTop: 2 }}>
                    {value}
                </div>
                <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>{hint}</div>
            </div>
        </div>
    );
}
