"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Brain,
  Building2,
  Megaphone,
  FileSearch,
  Upload,
  ArrowRight,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import styles from "~/styles/Employer/Onboarding.module.css";

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

  const skip = () => {
    router.replace("/employer/documents");
  };

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

  const finish = () => {
    router.replace("/employer/documents");
  };

  const renderProgress = () => (
    <div className={styles.progressBar}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={`${styles.progressStep} ${
            i === step
              ? styles.progressStepActive
              : i < step
                ? styles.progressStepDone
                : styles.progressStepPending
          }`}
        />
      ))}
    </div>
  );

  const renderWelcome = () => (
    <>
      <div className={styles.cardBody}>
        <div className={styles.welcomeLogo}>
          <Brain className={styles.welcomeLogoIcon} />
          <span className={styles.welcomeLogoText}>Launchstack</span>
        </div>

        <h1 className={styles.welcomeTitle}>Welcome to Launchstack</h1>
        <p className={styles.welcomeSubtitle}>
          Turn your company&apos;s documents into a living knowledge base that
          powers smarter decisions, automated marketing, and team-wide insights.
        </p>

        <div className={styles.features}>
          <div className={styles.featureCard}>
            <div className={styles.featureIconWrap}>
              <Building2 className={styles.featureIcon} />
            </div>
            <h4 className={styles.featureTitle}>Company Knowledge</h4>
            <p className={styles.featureText}>
              AI extracts and organizes key facts from every document you upload
            </p>
          </div>
          <div className={styles.featureCard}>
            <div className={styles.featureIconWrap}>
              <Megaphone className={styles.featureIcon} />
            </div>
            <h4 className={styles.featureTitle}>Marketing Pipeline</h4>
            <p className={styles.featureText}>
              Generate on-brand campaigns for LinkedIn, X, Reddit, and more
            </p>
          </div>
          <div className={styles.featureCard}>
            <div className={styles.featureIconWrap}>
              <FileSearch className={styles.featureIcon} />
            </div>
            <h4 className={styles.featureTitle}>AI Q&amp;A</h4>
            <p className={styles.featureText}>
              Ask questions across all your documents and get instant answers
            </p>
          </div>
        </div>
      </div>

      <div className={styles.footer}>
        <button type="button" onClick={skip} className={styles.skipLink}>
          Skip for now
        </button>
        <button
          type="button"
          onClick={() => setStep(1)}
          className={styles.primaryButton}
        >
          Get Started
          <ChevronRight className="inline w-4 h-4 ml-1 -mr-1" />
        </button>
      </div>
    </>
  );

  const renderCompanyInfo = () => (
    <>
      <div className={styles.cardBody}>
        <h2 className={styles.stepTitle}>Tell us about your company</h2>
        <p className={styles.stepSubtitle}>
          Your description feeds directly into your company knowledge base --
          powering smarter document analysis, more relevant marketing campaigns,
          and better AI answers across the platform.
        </p>

        <div className={styles.formGroup}>
          <label htmlFor="description" className={styles.label}>
            Company Description{" "}
            <span className={styles.labelHint}>(optional)</span>
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={styles.textarea}
            placeholder="Briefly describe what your company does, your products or services, and your target market..."
            rows={4}
          />
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="industry" className={styles.label}>
            Industry / Sector{" "}
            <span className={styles.labelHint}>(optional)</span>
          </label>
          <select
            id="industry"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            className={styles.selectTrigger}
          >
            <option value="">Select an industry...</option>
            {INDUSTRIES.map((ind) => (
              <option key={ind} value={ind}>
                {ind}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={styles.footer}>
        <button type="button" onClick={skip} className={styles.skipLink}>
          Skip for now
        </button>
        <div className={styles.buttonGroup}>
          <button
            type="button"
            onClick={() => setStep(0)}
            className={styles.secondaryButton}
          >
            <ChevronLeft className="inline w-4 h-4 mr-1 -ml-1" />
            Back
          </button>
          <button
            type="button"
            onClick={() => void saveAndContinue()}
            disabled={isSaving}
            className={styles.primaryButton}
          >
            {isSaving ? "Saving..." : "Continue"}
            {!isSaving && (
              <ChevronRight className="inline w-4 h-4 ml-1 -mr-1" />
            )}
          </button>
        </div>
      </div>
    </>
  );

  const renderQuickStart = () => {
    const actions = [
      {
        icon: Upload,
        title: "Upload documents to build your knowledge base",
        text: "Every upload enriches your company profile and powers AI features",
        iconWrap: styles.quickStartIconPurple,
        iconColor: styles.quickStartIconColorPurple,
        href: "/employer/documents?view=upload",
      },
      {
        icon: Megaphone,
        title: "Create a marketing campaign",
        text: "Generate platform-ready posts using your company knowledge",
        iconWrap: styles.quickStartIconIndigo,
        iconColor: styles.quickStartIconColorIndigo,
        href: "/employer/documents?view=marketing-pipeline",
      },
      {
        icon: Building2,
        title: "View your company metadata",
        text: "See AI-extracted facts about your people, services, and markets",
        iconWrap: styles.quickStartIconViolet,
        iconColor: styles.quickStartIconColorViolet,
        href: "/employer/documents?view=metadata",
      },
    ];

    return (
      <>
        <div className={styles.cardBody}>
          <h2 className={styles.stepTitle}>You&apos;re all set!</h2>
          <p className={styles.stepSubtitle}>
            Here are some things you can do right away to get started.
          </p>

          <div className={styles.quickStartCards}>
            {actions.map((action) => (
              <button
                key={action.title}
                type="button"
                onClick={() => router.push(action.href)}
                className={styles.quickStartCard}
              >
                <div
                  className={`${styles.quickStartIconWrap} ${action.iconWrap}`}
                >
                  <action.icon
                    className={`${styles.quickStartIcon} ${action.iconColor}`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className={styles.quickStartTitle}>{action.title}</div>
                  <div className={styles.quickStartText}>{action.text}</div>
                </div>
                <ArrowRight className={styles.quickStartArrow} />
              </button>
            ))}
          </div>
        </div>

        <div className={styles.footer}>
          <div />
          <button type="button" onClick={finish} className={styles.primaryButton}>
            Go to Dashboard
            <ArrowRight className="inline w-4 h-4 ml-1 -mr-1" />
          </button>
        </div>
      </>
    );
  };

  return (
    <div className={styles.container}>
      <div className={styles.wrapper}>
        {renderProgress()}
        <div className={styles.card}>
          {step === 0 && renderWelcome()}
          {step === 1 && renderCompanyInfo()}
          {step === 2 && renderQuickStart()}
        </div>
      </div>
    </div>
  );
}
