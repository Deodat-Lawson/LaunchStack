"use client";

import React, { useState, useEffect } from "react";
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
  Cpu,
} from "lucide-react";
import styles from "~/styles/Employer/Onboarding.module.css";
import {
  SUPPORTED_EMBEDDING_MODELS,
  DEFAULT_EMBEDDING_CONFIG,
} from "~/lib/ai/embedding-config";

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
  const [companyType, setCompanyType] = useState<"company" | "personal">("company");
  const [selectedEmbeddingModel, setSelectedEmbeddingModel] = useState(
    DEFAULT_EMBEDDING_CONFIG.model,
  );

  useEffect(() => {
    fetch("/api/company/onboarding")
      .then((res) => res.json())
      .then((data: { type?: string }) => {
        if (data.type === "personal") {
          setCompanyType("personal");
        }
      })
      .catch(() => {});
  }, []);

  const skip = () => {
    router.replace("/employer/documents");
  };

  const saveAndContinue = async () => {
    setIsSaving(true);
    try {
      // Save company info (for company type)
      if (companyType === "company" && (description.trim() || industry)) {
        await fetch("/api/company/onboarding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: description.trim() || undefined,
            industry: industry || undefined,
          }),
        });
      }

      // Save embedding config if not the default
      const chosenModel = SUPPORTED_EMBEDDING_MODELS.find(
        (m) => m.model === selectedEmbeddingModel,
      );
      if (chosenModel && chosenModel.model !== DEFAULT_EMBEDDING_CONFIG.model) {
        await fetch("/api/company/embedding-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: chosenModel.provider,
            model: chosenModel.model,
            dimensions: chosenModel.dimensions,
          }),
        });
      }
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
          {companyType === "personal"
            ? "Turn your documents into a personal knowledge base that powers smarter decisions, content creation, and AI-driven insights."
            : "Turn your company\u2019s documents into a living knowledge base that powers smarter decisions, automated marketing, and team-wide insights."}
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
        <h2 className={styles.stepTitle}>
          {companyType === "personal"
            ? "Configure your workspace"
            : "Tell us about your company"}
        </h2>
        <p className={styles.stepSubtitle}>
          {companyType === "personal"
            ? "Choose your preferred embedding model for document analysis. You can change this later in Settings."
            : "Your description feeds directly into your company knowledge base — powering smarter document analysis, more relevant marketing campaigns, and better AI answers across the platform."}
        </p>

        {companyType === "company" && (
          <>
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
          </>
        )}

        {/* Embedding model picker */}
        <div className={styles.formGroup}>
          <label className={styles.label}>
            <Cpu className="inline w-4 h-4 mr-1" />
            Embedding Model{" "}
            <span className={styles.labelHint}>(optional)</span>
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {SUPPORTED_EMBEDDING_MODELS.map((model) => (
              <label
                key={model.model}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "0.75rem",
                  padding: "0.75rem 1rem",
                  borderRadius: "0.5rem",
                  border: selectedEmbeddingModel === model.model
                    ? "2px solid var(--color-purple-500, #8b5cf6)"
                    : "1px solid var(--color-gray-300, #d1d5db)",
                  cursor: "pointer",
                  transition: "border-color 0.15s",
                }}
              >
                <input
                  type="radio"
                  name="embeddingModel"
                  value={model.model}
                  checked={selectedEmbeddingModel === model.model}
                  onChange={() => setSelectedEmbeddingModel(model.model)}
                  style={{ marginTop: "0.2rem" }}
                />
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{model.label}</div>
                  <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>
                    {model.description} &middot; {model.costPer1MTokens}/1M tokens
                  </div>
                </div>
              </label>
            ))}
          </div>
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
        text: companyType === "personal"
          ? "Every upload enriches your workspace and powers AI features"
          : "Every upload enriches your company profile and powers AI features",
        iconWrap: styles.quickStartIconPurple,
        iconColor: styles.quickStartIconColorPurple,
        href: "/employer/documents?view=upload",
      },
      {
        icon: Megaphone,
        title: "Create a marketing campaign",
        text: companyType === "personal"
          ? "Generate platform-ready posts using your knowledge base"
          : "Generate platform-ready posts using your company knowledge",
        iconWrap: styles.quickStartIconIndigo,
        iconColor: styles.quickStartIconColorIndigo,
        href: "/employer/documents?view=marketing-pipeline",
      },
      {
        icon: Building2,
        title: companyType === "personal"
          ? "View your workspace metadata"
          : "View your company metadata",
        text: "See AI-extracted facts about your documents and topics",
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
