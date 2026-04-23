"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { Mail, MessageSquare, Phone, Send } from "lucide-react";

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

export default function EmployerContactPage() {
  const router = useRouter();
  const { isLoaded, userId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    subject: "",
    message: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "success" | "error">(
    "idle",
  );

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitStatus("idle");
    try {
      // No real endpoint yet — keep the UX moving so users can still send
      // feedback via email once we wire this up.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setSubmitStatus("success");
      setFormData({ name: "", email: "", subject: "", message: "" });
    } catch {
      setSubmitStatus("error");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) return <LoadingPage />;

  const canSubmit =
    !!formData.name.trim() &&
    !!formData.email.trim() &&
    !!formData.subject.trim() &&
    !!formData.message.trim() &&
    !isSubmitting;

  return (
    <>
      <EmployerChrome pageLabel="Launchstack" pageTitle="Contact" />
      <PageShell>
        <PageHeader
          eyebrow="Support"
          title="Get in touch"
          description="Questions about Launchstack, feedback, or bug reports. We'll respond within one business day."
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
                {submitStatus === "success" && (
                  <div
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      background: "var(--accent-soft)",
                      color: "var(--accent-ink)",
                      fontSize: 13,
                      marginBottom: 14,
                    }}
                  >
                    Message queued — we&apos;ll be in touch shortly.
                  </div>
                )}
                {submitStatus === "error" && (
                  <div
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      background: "oklch(0.96 0.05 25)",
                      color: "var(--danger)",
                      fontSize: 13,
                      marginBottom: 14,
                    }}
                  >
                    Something went wrong. Try again in a moment.
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <Button type="submit" disabled={!canSubmit}>
                    <Send style={{ width: 14, height: 14 }} />
                    {isSubmitting ? "Sending…" : "Send message"}
                  </Button>
                </div>
              </form>
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
                <ContactRow
                  Icon={Mail}
                  label="Email"
                  value="hello@launchstack.dev"
                  hint="Fastest for technical questions."
                />
                <ContactRow
                  Icon={MessageSquare}
                  label="Community"
                  value="discord.gg/launchstack"
                  hint="Ask live in the #support channel."
                />
                <ContactRow
                  Icon={Phone}
                  label="Response time"
                  value="Within 1 business day"
                  hint="Faster for existing customers."
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
