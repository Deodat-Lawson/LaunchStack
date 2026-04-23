"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Building2,
  ChevronLeft,
  ChevronRight,
  FileSearch,
  Megaphone,
  Upload,
} from "lucide-react";

import { EmployerChrome } from "~/app/employer/_components/EmployerChrome";
import {
  Button,
  Card,
  Field,
  PageShell,
  SelectInput,
  TextArea,
} from "~/app/employer/_components/primitives";

const INDUSTRIES = [
  "Technology",
  "Healthcare",
  "Finance",
  "Legal",
  "Education",
  "Manufacturing",
  "Retail",
  "Government",
  "Non-profit",
  "Other",
] as const;

type Step = 0 | 1 | 2;

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);
  const [description, setDescription] = useState("");
  const [industry, setIndustry] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const skip = () => router.replace("/employer/documents");

  const saveAndContinue = async () => {
    if (!description.trim() && !industry) {
      setStep(2);
      return;
    }
    setIsSaving(true);
    try {
      await fetch("/api/company/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim() || undefined,
          industry: industry || undefined,
        }),
      });
    } catch (err) {
      console.error("Failed to save onboarding data:", err);
    } finally {
      setIsSaving(false);
      setStep(2);
    }
  };

  const finish = () => router.replace("/employer/documents");

  return (
    <>
      <EmployerChrome pageLabel="First steps" pageTitle="Onboarding" />
      <PageShell>
        <div style={{ maxWidth: 680, margin: "0 auto" }}>
          <ProgressBar step={step} />
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {step === 0 && <WelcomeStep onNext={() => setStep(1)} onSkip={skip} />}
            {step === 1 && (
              <CompanyInfoStep
                description={description}
                setDescription={setDescription}
                industry={industry}
                setIndustry={setIndustry}
                onBack={() => setStep(0)}
                onNext={() => void saveAndContinue()}
                onSkip={skip}
                isSaving={isSaving}
              />
            )}
            {step === 2 && <QuickStartStep router={router} onFinish={finish} />}
          </Card>
        </div>
      </PageShell>
    </>
  );
}

function ProgressBar({ step }: { step: Step }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        margin: "8px 0 20px",
        padding: "0 2px",
      }}
    >
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: 4,
            borderRadius: 2,
            background:
              i === step
                ? "var(--accent)"
                : i < step
                ? "var(--accent-glow)"
                : "var(--line)",
            transition: "background 200ms",
          }}
        />
      ))}
    </div>
  );
}

function StepFooter({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "14px 24px",
        borderTop: "1px solid var(--line)",
        background: "var(--line-2)",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      {children}
    </div>
  );
}

function WelcomeStep({
  onNext,
  onSkip,
}: {
  onNext: () => void;
  onSkip: () => void;
}) {
  return (
    <>
      <div style={{ padding: "32px 30px 24px" }}>
        <div
          className="mono"
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: "var(--ink-3)",
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          Welcome
        </div>
        <h1
          className="serif"
          style={{
            fontSize: 34,
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            color: "var(--ink)",
            margin: "0 0 10px",
          }}
        >
          Turn your team&apos;s context into answers.
        </h1>
        <div style={{ fontSize: 14, color: "var(--ink-3)", lineHeight: 1.55 }}>
          Launchstack ingests your docs, emails, transcripts, and repos into one
          place you can ask anything. A couple of short steps and you&apos;re live.
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 12,
            marginTop: 24,
          }}
        >
          <FeatureTile
            Icon={Building2}
            title="Company knowledge"
            text="AI extracts and organizes key facts from every document"
          />
          <FeatureTile
            Icon={Megaphone}
            title="Marketing pipeline"
            text="Generate on-brand campaigns for LinkedIn, X, Reddit"
          />
          <FeatureTile
            Icon={FileSearch}
            title="Grounded Q&A"
            text="Ask across every source; answers cite the exact passage"
          />
        </div>
      </div>
      <StepFooter>
        <Button variant="ghost" onClick={onSkip}>
          Skip for now
        </Button>
        <div style={{ flex: 1 }} />
        <Button onClick={onNext}>
          Get started <ChevronRight style={{ width: 14, height: 14 }} />
        </Button>
      </StepFooter>
    </>
  );
}

function FeatureTile({
  Icon,
  title,
  text,
}: {
  Icon: React.ComponentType<{ style?: React.CSSProperties }>;
  title: string;
  text: string;
}) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 10,
        border: "1px solid var(--line)",
        background: "var(--panel-2)",
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: "var(--accent-soft)",
          color: "var(--accent)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 10,
        }}
      >
        <Icon style={{ width: 16, height: 16 }} />
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{title}</div>
      <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 4, lineHeight: 1.5 }}>
        {text}
      </div>
    </div>
  );
}

function CompanyInfoStep({
  description,
  setDescription,
  industry,
  setIndustry,
  onBack,
  onNext,
  onSkip,
  isSaving,
}: {
  description: string;
  setDescription: (v: string) => void;
  industry: string;
  setIndustry: (v: string) => void;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  isSaving: boolean;
}) {
  return (
    <>
      <div style={{ padding: "32px 30px 24px" }}>
        <div
          className="mono"
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: "var(--ink-3)",
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          About your company
        </div>
        <h2
          className="serif"
          style={{
            fontSize: 28,
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
            color: "var(--ink)",
            margin: "0 0 8px",
          }}
        >
          Tell us who you are.
        </h2>
        <div
          style={{
            fontSize: 13,
            color: "var(--ink-3)",
            lineHeight: 1.55,
            marginBottom: 20,
          }}
        >
          Your description feeds into every AI call — better context here means
          sharper answers everywhere.
        </div>

        <Field label="Company description (optional)">
          <TextArea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does your company do? Products, services, target market…"
            rows={4}
          />
        </Field>
        <Field label="Industry / sector (optional)">
          <SelectInput
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
          >
            <option value="">Select an industry…</option>
            {INDUSTRIES.map((ind) => (
              <option key={ind} value={ind}>
                {ind}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      <StepFooter>
        <Button variant="ghost" onClick={onSkip}>
          Skip for now
        </Button>
        <div style={{ flex: 1 }} />
        <Button variant="secondary" onClick={onBack}>
          <ChevronLeft style={{ width: 14, height: 14 }} /> Back
        </Button>
        <Button onClick={onNext} disabled={isSaving}>
          {isSaving ? "Saving…" : "Continue"}
          {!isSaving && <ChevronRight style={{ width: 14, height: 14 }} />}
        </Button>
      </StepFooter>
    </>
  );
}

function QuickStartStep({
  router,
  onFinish,
}: {
  router: ReturnType<typeof useRouter>;
  onFinish: () => void;
}) {
  const actions = [
    {
      Icon: Upload,
      title: "Upload documents to build your knowledge base",
      text: "Every upload enriches your company profile and powers AI features",
      href: "/employer/documents?view=upload",
    },
    {
      Icon: Megaphone,
      title: "Create a marketing campaign",
      text: "Generate platform-ready posts using your company knowledge",
      href: "/employer/documents?view=marketing-pipeline",
    },
    {
      Icon: Building2,
      title: "View your company metadata",
      text: "See AI-extracted facts about your people, services, and markets",
      href: "/employer/documents?view=metadata",
    },
  ];

  return (
    <>
      <div style={{ padding: "32px 30px 24px" }}>
        <div
          className="mono"
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: "var(--ink-3)",
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          You&apos;re in
        </div>
        <h2
          className="serif"
          style={{
            fontSize: 28,
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
            color: "var(--ink)",
            margin: "0 0 8px",
          }}
        >
          Let&apos;s get your first win.
        </h2>
        <div
          style={{
            fontSize: 13,
            color: "var(--ink-3)",
            lineHeight: 1.55,
            marginBottom: 20,
          }}
        >
          Pick one to start — you can always come back to the rest.
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {actions.map((a) => (
            <button
              key={a.title}
              onClick={() => router.push(a.href)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "14px 16px",
                borderRadius: 12,
                border: "1px solid var(--line)",
                background: "var(--panel-2)",
                textAlign: "left",
                cursor: "pointer",
                transition: "border-color 120ms, background 120ms",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--accent)";
                e.currentTarget.style.background = "var(--accent-soft)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--line)";
                e.currentTarget.style.background = "var(--panel-2)";
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: "var(--panel)",
                  color: "var(--accent)",
                  border: "1px solid var(--line)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <a.Icon style={{ width: 18, height: 18 }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                  {a.title}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--ink-3)",
                    marginTop: 2,
                    lineHeight: 1.5,
                  }}
                >
                  {a.text}
                </div>
              </div>
              <ArrowRight
                style={{ width: 16, height: 16, color: "var(--ink-3)", flexShrink: 0 }}
              />
            </button>
          ))}
        </div>
      </div>
      <StepFooter>
        <div style={{ flex: 1 }} />
        <Button onClick={onFinish}>
          Go to workspace <ArrowRight style={{ width: 14, height: 14 }} />
        </Button>
      </StepFooter>
    </>
  );
}
