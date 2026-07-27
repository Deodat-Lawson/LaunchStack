"use client";

import { useState, type ReactNode } from "react";

import { RefreshCw } from "lucide-react";

import {
  Button,
  Card,
  PageHeader,
  PageShell,
  Section,
} from "~/app/employer/_components/primitives";

function ReviewCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <Section title={title}>
        {children}
      </Section>
    </Card>
  );
}

type DateRange = {
  start: Date;
  end: Date;
};

function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function parseDate(value: string) {
  const [year, month, day] = value
    .split("-")
    .map((part) => Number.parseInt(part, 10));

  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Invalid date value: ${value}`);
  }

  return new Date(year, month - 1, day);
}

function getPreviousWeekRange(): DateRange {
  const today = new Date();

  const day = today.getDay(); // 0 (Sunday) to 6 (Saturday)
  const daysSinceMonday = day === 0 ? 6 : day - 1;

  const start = new Date(today);
  start.setDate(today.getDate() - daysSinceMonday - 7);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  return { start, end };
}

function getCurrentWeekRange() {
  const today = new Date();

  const day = today.getDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;

  const start = new Date(today);
  start.setDate(today.getDate() - daysSinceMonday);

  return {
    start,
    end: today,
  };
}

function getToday() {
  const today = new Date();

  return new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
}

function getPeriodMode(period: DateRange): "previous" | "current" | "custom" {
  const previous = getPreviousWeekRange();
  const current = getCurrentWeekRange();

  if (
    period.start.toDateString() === previous.start.toDateString() &&
    period.end.toDateString() === previous.end.toDateString()
  ) {
    return "previous";
  }

  if (
    period.start.toDateString() === current.start.toDateString() &&
    period.end.toDateString() === current.end.toDateString()
  ) {
    return "current";
  }

  return "custom";
}

export interface FounderWeeklyReviewViewProps {
  embedded?: boolean;
}

type ReviewItem = {
  text: string;
  confidence: "High" | "Medium" | "Low";
  source: string;
};

type WeeklyReview = {
  "What Changed": ReviewItem[];
  "What Shipped": ReviewItem[];
  "What Customers Said": ReviewItem[];
  "Current Blockers": ReviewItem[];
  "Next Priorities": ReviewItem[];
};

const mockReview: WeeklyReview = {
  "What Changed": [
    {
      text: "Added the Founder Weekly Review workspace and routing.",
      confidence: "High",
      source: "GitHub PR #42",
    },
    {
      text: "Implemented reporting period controls.",
      confidence: "Medium",
      source: "review.tsx",
    },
  ],

  "What Shipped": [
    {
      text: "Founder review dashboard embedded into Studio.",
      confidence: "High",
      source: "Commit 8cf2d",
    },
  ],

  "What Customers Said": [
    {
      text: "Users requested an easier way to review weekly progress.",
      confidence: "Medium",
      source: "Customer Feedback #18",
    },
  ],

  "Current Blockers": [
    {
      text: "Slack integration has not been connected.",
      confidence: "High",
      source: "Workspace Settings",
    },
  ],

  "Next Priorities": [
    {
      text: "Implement persistence and publishing.",
      confidence: "High",
      source: "Sprint Planning",
    },
  ],
  };


export function FounderWeeklyReviewView({ embedded = false }: FounderWeeklyReviewViewProps) {
  const [status, setStatus] = useState<
    "draft" | "queued" | "generating" | "published" | "failed"
  >("draft");

  const defaultRange = getPreviousWeekRange();

  const [reportingPeriod, setReportingPeriod] = useState<DateRange>(
    defaultRange
  );

  const [periodMode, setPeriodMode] = useState<
    "previous" | "current" | "custom"
    >("previous");

  const changePeriodMode = (
    mode: "previous" | "current" | "custom"
    ) => {
    setPeriodMode(mode);

    if (mode === "previous") {
    setReportingPeriod(getPreviousWeekRange());
    }

    if (mode === "current") {
    setReportingPeriod(getCurrentWeekRange());
    }
  };

  const updateStartDate = (value: string) => {
    const newStart = parseDate(value);

    if (newStart > reportingPeriod.end) {
      alert("Start date cannot be after end date.");
      return;
    }

    setReportingPeriod({
      ...reportingPeriod,
      start: newStart,
    });
  };

  const updateEndDate = (value: string) => {
    const newEnd = parseDate(value);

    if (newEnd < reportingPeriod.start) {
      alert("End date cannot be before start date.");
      return;
    }

    setReportingPeriod({
      ...reportingPeriod,
      end: newEnd,
    });
  };

  type ReviewHistoryItem = {
    date: string;
    review: WeeklyReview;
    context: string;
    period: DateRange;
  };

  const [draft, setDraft] = useState<Draft | null>(null);

  const [selectedReview, setSelectedReview] =
    useState<WeeklyReview  | null>(null);

  const displayedReview =
    selectedReview ?? draft?.review ?? null;

  const [isViewingHistory, setIsViewingHistory] = useState(false);
  
  const isGenerating =
  status === "queued" || status === "generating";

  const generateReview = async () => {
    try {
      console.log({
        startDate: reportingPeriod.start,
        endDate: reportingPeriod.end,
      });

      setStatus("queued");
      await new Promise((r) => setTimeout(r, 600));

      setStatus("generating");
      await new Promise((r) => setTimeout(r, 2000));

      setDraft((prev) => ({
        review: mockReview,
        context: founderContext,
        period: reportingPeriod,
        }));

      setStatus("draft");
    } catch {
      setStatus("failed");
    }
  };

  const generateButtonLabel =
  status === "failed"
    ? "Retry"
    : status === "queued"
      ? "Queued…"
      : status === "generating"
        ? "Generating…"
        : draft?.review
          ? "Regenerate Review"
          : "Generate Review";

  const [history, setHistory] = useState<ReviewHistoryItem[]>([]);

  const [saved, setSaved] = useState(false);

  const [published, setPublished] = useState(false);

  const [founderContext, setFounderContext] = useState(""); 

  type Draft = {
    review: WeeklyReview | null;
    context: string;
    period: DateRange;
    };

  const saveDraft = () => {
    setDraft((prev) => ({
        review: prev?.review || null,
        context: founderContext,
        period: reportingPeriod,
    }));

    setSaved(true);

    setTimeout(() => {
        setSaved(false);
    }, 2000);
    };

  const hasDraft =
    draft !== null &&
    (
        draft.review !== null ||
        draft.context.trim().length > 0
    );

  const publishReview = () => {
    const reviewToPublish = draft?.review;

    if (!reviewToPublish || !draft) return;

    setHistory((prev) => [
    {
        date: new Date().toLocaleDateString(),
        review: reviewToPublish,
        context: draft.context,
        period: draft.period,
    },
    ...prev,
    ]);

    setPublished(true);

    setTimeout(() => {
        setPublished(false);
    }, 2000);

    setStatus("published");
    setDraft(null);
    setSelectedReview(null);
};

  const reviewSections : (keyof WeeklyReview)[] =  [
    "What Changed",
    "What Shipped",
    "What Customers Said",
    "Current Blockers",
    "Next Priorities",
  ];


  return (
    <PageShell wide embedded={embedded}>
      <PageHeader
        eyebrow="Review"
        title="Founder Weekly Review"
        description="A weekly AI-generated summary of company progress, blockers, and priorities."
        actions={
        <div
          style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          }}
        >
          <span
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              background: "var(--line-2)",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {status.toUpperCase()}
          </span>

          {isViewingHistory && (
            <span
                style={{
                padding: "6px 12px",
                borderRadius: 999,
                background: "var(--line-2)",
                fontSize: 12,
                fontWeight: 600,
                }}
            >
                READ ONLY
            </span>
            )}

            {isViewingHistory ? (
            <Button
                onClick={() => {
                setSelectedReview(null);
                setIsViewingHistory(false);
                setStatus("draft");

                if (hasDraft) {
                    setFounderContext(draft.context);
                    setReportingPeriod(draft.period);
                    setPeriodMode(getPeriodMode(draft.period));
                } else {
                    setFounderContext("");
                    setReportingPeriod(getPreviousWeekRange());
                    setPeriodMode("previous");
                }
                }}
            >
                {hasDraft ? "Back to Draft" : "Create New Draft"}
            </Button>
            ) : (
            <Button
                onClick={() => void generateReview()}
                disabled={
                status === "queued" ||
                status === "generating"
                }
            >
                {generateButtonLabel}
            </Button>
            )}

        </div>
        }
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 300px",
          gap: 24,
          alignItems: "start",
        }}
      >
        <div>
          <Card>
            <Section
              title="Reporting Period"
              description="Select the reporting window."
            >
              <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                }}
                >
                <select
                    disabled={isViewingHistory || isGenerating}
                    value={periodMode}
                    onChange={(e) =>
                    changePeriodMode(
                        e.target.value as "previous" | "current" | "custom"
                    )
                    }
                    style={{
                    width: "fit-content",
                    padding: "8px 12px",
                    borderRadius: 8,
                    }}
                >
                    <option value="previous">
                    Previous Week
                    </option>

                    <option value="current">
                    Current Week
                    </option>

                    <option value="custom">
                    Custom Range
                    </option>
                </select>


                {periodMode === "custom" && (
                    <div
                    style={{
                        display: "flex",
                        gap: 12,
                        alignItems: "center",
                    }}
                    >
                    <input
                      type="date"
                      value={reportingPeriod.start.toLocaleDateString("en-CA")}
                      max={getToday().toLocaleDateString("en-CA")}
                      onChange={(e) => updateStartDate(e.target.value)}
                      disabled={isViewingHistory}
                    />

                    <span>→</span>

                    <input
                      type="date"
                      value={reportingPeriod.end.toLocaleDateString("en-CA")}
                      min={reportingPeriod.start.toLocaleDateString("en-CA")}
                      max={getToday().toLocaleDateString("en-CA")}
                      onChange={(e) => updateEndDate(e.target.value)}
                      disabled={isViewingHistory}
                    />
                    </div>
                )}


                <div>
                    {formatDate(reportingPeriod.start)} →{" "}
                    {formatDate(reportingPeriod.end)}
                </div>
                </div>
            </Section>
          </Card>
      
          <Card>
            <Section
              title="Source Readiness"
              description="Connected sources used for this review."
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span>GitHub</span>

                  <span style={{ color: "green", fontWeight: 600 }}>
                    ✅ Connected
                  </span>
                </div>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span>Customer Feedback</span>

                  <span style={{ color: "orange", fontWeight: 600 }}>
                    ⚠ Missing
                  </span>
                </div>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span>Workspace Documents</span>

                  <span style={{ color: "green", fontWeight: 600 }}>
                    ✅ Ready
                  </span>
                </div>
              </div> 
            </Section>
          </Card>
      
          <Card>
            <Section
              title="Founder Context"
              description={
                isViewingHistory
                    ? "Context provided when this review was created."
                    : "Anything you'd like the AI to keep in mind?"
                }
            >
              <textarea
              disabled={isViewingHistory}
              rows={5}
              value={founderContext}
              onChange={(e) => setFounderContext(e.target.value)}
              placeholder="Add context for this week's review..."
              style={{
                width: "100%",
                padding: 12,
                borderRadius: 8,
              }}
              />
            </Section>
          </Card>
      
          {reviewSections.map((title) => (
            <ReviewCard key={title} title={title}>
              {displayedReview ? (
                <div>
                  {displayedReview?.[title]?.map((item, idx) => (
                    <div key={idx} style={{ marginBottom: 12 }}>
                      <p>{item.text}</p>
                      <small style={{ color: "var(--ink-2)" }}>
                        {item.source} • {item.confidence}
                      </small>
                    </div>
                  ))}
                </div>
              ) : (
                <div
                    style={{
                        padding: 36,
                        textAlign: "center",
                        color: "var(--ink-3)",
                    }}
                >
                    No review has been generated yet.

                    <div
                        style={{
                            marginTop: 8,
                            fontSize: 13,
                        }}
                    >
                        Click <strong>Generate Review</strong> to create this week's founder summary.
                    </div>
                </div>
              )}
            </ReviewCard>
          ))}

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 12,
              marginTop: 24,
            }}
          >
            <Button
                disabled = {isViewingHistory}
                variant="secondary"
                onClick= {saveDraft}
            >
                {saved ? "Saved ✓" : "Save Draft"}
                </Button>

            <Button 
              onClick={publishReview}
              disabled={!draft?.review || isViewingHistory}
            >
              {published ? "Published ✓" : "Publish Review"}
            </Button>
          </div>
        </div>

        <Card
        style={{
            position: "sticky",
            top: 24,
        }}
        >
        {/* {hasDraft && (
            <Section
            title="Current Draft"
            description="Continue editing your saved review"
            >
            <button
                onClick={() => {
                  setSelectedReview(null);
                  if (draft) {
                    setFounderContext(draft.context);
                    setReportingPeriod(draft.period);
                    setPeriodMode(getPeriodMode(draft.period));
                  }
                  setIsViewingHistory(false);
                }}
                style={{
                width: "100%",
                padding: "12px",
                borderRadius: 8,
                border: "1px solid var(--line-2)",
                background: "transparent",
                cursor: "pointer",
                textAlign: "center",
                }}
            >

            {formatDate(draft.period.start)} →{" "}
            {formatDate(draft.period.end)}

            </button>
            </Section>
        )} */}

        <Section
            title="Previous Reviews"
            description="History of published founder reviews"
        >
            <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
            }}
            >
            {history.map((item, idx) => (
                <button
                key={idx}
                onClick={() => {
                    setSelectedReview(item.review);
                    setFounderContext(item.context);
                    setReportingPeriod(item.period);
                    setPeriodMode(getPeriodMode(item.period));
                    setIsViewingHistory(true);
                    setStatus("published");
                }}
                style={{
                    width: "100%",
                    padding: "12px",
                    borderRadius: 8,
                    border: "1px solid var(--line-2)",
                    background: "transparent",
                    cursor: "pointer",
                    textAlign: "center",
                }}
                >
                {formatDate(item.period.start)} →{" "}
                {formatDate(item.period.end)}
                </button>
            ))}
            </div>
        </Section>
        </Card>
      </div>

    </PageShell>
  );
}