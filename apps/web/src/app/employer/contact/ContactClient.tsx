"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { Bug, Mail, MessageSquare, Phone, Send } from "lucide-react";

import type { SupportChannels } from "~/server/support";

import LoadingPage from "~/app/_components/loading";
import { EmployerChrome } from "~/app/employer/_components/EmployerChrome";
import {
  Button,
  Card,
  Field,
  PageHeader,
  PageShell,
  Section,
  TextArea,
  TextInput,
} from "~/app/employer/_components/primitives";

export function ContactClient({ support }: { support: SupportChannels }) {
  const router = useRouter();
  const { isLoaded, userId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    subject: "",
    message: "",
  });

  useEffect(() => {
    if (!isLoaded) return;
    if (!userId) {
      router.push("/");
      return;
    }
    setLoading(false);
  }, [userId, router, isLoaded]);

  const handleInput = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
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
          title="Get in touch"
          description={
            support.email
              ? "Questions, feedback, or bug reports. Your message opens in your mail client."
              : "Questions, feedback, or bug reports."
          }
        />

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
                <div style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.6 }}>
                  <p style={{ margin: "0 0 12px" }}>
                    This instance has no support address configured. Whoever
                    operates it can set <code>SUPPORT_CONTACT_EMAIL</code> to
                    receive messages here.
                  </p>
                  <p style={{ margin: 0 }}>
                    For problems with Launchstack itself, open an issue on{" "}
                    <a href={support.issuesUrl} target="_blank" rel="noopener noreferrer">
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
