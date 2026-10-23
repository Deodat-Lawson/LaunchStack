"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "~/lib/auth-client";
import { useRouter } from "next/navigation";
import { Bug, CircleAlert, Copy, Mail, MessageSquare, Phone, Send } from "lucide-react";

import type { SupportChannels } from "~/server/support";
import {
    SOURCE_FAILURE_CATEGORY_NAMES,
    sourceFailureReportText,
    type SourceFailureReport,
} from "~/lib/source-failure";

import LoadingPage from "~/app/_components/loading";
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
    const router = useRouter();
    const { isLoaded, userId } = useAuth();
    const [loading, setLoading] = useState(true);
    const reportText = report ? sourceFailureReportText(report) : null;
    const [formData, setFormData] = useState({
        name: "",
        email: "",
        subject: reportText?.subject ?? "",
        message: reportText ? `What I was doing:\n\n\n—\n${reportText.details}` : "",
    });

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
            <EmployerChrome pageLabel="Launchstack" pageTitle="Contact" />
            <PageShell>
                <PageHeader
                    eyebrow="Support"
                    title={report ? "Report a processing error" : "Get in touch"}
                    description={
                        support.email
                            ? "Questions, feedback, or bug reports. Your message opens in your mail client."
                            : "Questions, feedback, or bug reports."
                    }
                />

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
                                        This instance has no support address configured. Whoever
                                        operates it can set <code>SUPPORT_CONTACT_EMAIL</code> to
                                        receive messages here.
                                    </p>
                                    <p style={{ margin: 0 }}>
                                        For problems with Launchstack itself, open an issue on{" "}
                                        <a
                                            href={support.issuesUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            the issue tracker
                                        </a>
                                        .
                                    </p>
                                </div>
                            ) : (
                                <form onSubmit={handleSubmit} style={{ display: "block" }}>
                                    <Field label="Your name">
                                        <TextInput
                                            name="name"
                                            value={formData.name}
                                            onChange={handleInput}
                                            placeholder="Jane Doe"
                                            required
                                        />
                                    </Field>
                                    <Field label="Email">
                                        <TextInput
                                            type="email"
                                            name="email"
                                            value={formData.email}
                                            onChange={handleInput}
                                            placeholder="jane@company.com"
                                            required
                                        />
                                    </Field>
                                    <Field label="Subject">
                                        <TextInput
                                            name="subject"
                                            value={formData.subject}
                                            onChange={handleInput}
                                            placeholder="What's this about?"
                                            required
                                        />
                                    </Field>
                                    <Field label="Message">
                                        <TextArea
                                            name="message"
                                            value={formData.message}
                                            onChange={handleInput}
                                            placeholder="Tell us what's on your mind…"
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
                                            Opens in your mail client, addressed to {support.email}.
                                        </span>
                                        <Button type="submit" disabled={!canSubmit}>
                                            <Send style={{ width: 14, height: 14 }} />
                                            Compose message
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
                                        label="Email"
                                        value={support.email}
                                        hint="Fastest for questions about your workspace."
                                    />
                                )}
                                {support.community && (
                                    <ContactRow
                                        Icon={MessageSquare}
                                        label="Community"
                                        value={support.community}
                                        hint="Ask other people running this instance."
                                    />
                                )}
                                {support.responseTime && (
                                    <ContactRow
                                        Icon={Phone}
                                        label="Response time"
                                        value={support.responseTime}
                                        hint="Set by whoever operates this instance."
                                    />
                                )}
                                <ContactRow
                                    Icon={Bug}
                                    label="Launchstack itself"
                                    value={support.issuesUrl.replace(/^https?:\/\//, "")}
                                    hint="Bugs and feature requests for the software."
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
                    {SOURCE_FAILURE_CATEGORY_NAMES[report.category]}
                </div>
                <dl className="text-ink-2 mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12.5px]">
                    <dt className="text-ink-3">Document</dt>
                    <dd className="truncate">{report.document}</dd>
                    {report.jobId && (
                        <>
                            <dt className="text-ink-3">Job / trace ID</dt>
                            <dd className="mono select-all truncate text-[12px]">{report.jobId}</dd>
                        </>
                    )}
                </dl>
                <p className="text-ink-3 mt-2 text-[12px]">
                    {inMessage
                        ? "These details are already in your message, so whoever runs this instance can find the error in its logs."
                        : "Include these details in your report, so whoever runs this instance can find the error in its logs."}
                </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void copy()}>
                <Copy aria-hidden />
                {copied ? "Copied" : "Copy details"}
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
