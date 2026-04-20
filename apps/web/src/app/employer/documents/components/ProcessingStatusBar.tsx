"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Loader2,
  Clock,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  FileText,
} from "lucide-react";
import { Progress } from "~/app/employer/documents/components/ui/progress";
import { cn } from "~/lib/utils";

interface ProcessingJob {
  id: string;
  documentName: string;
  status: "queued" | "processing" | "completed" | "failed";
  startedAt: string | null;
  completedAt: string | null;
  pageCount: number | null;
  createdAt: string;
}

interface ProcessingSummary {
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
}

interface ProcessingStatusBarProps {
  initialProcessingCount: number;
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  queued: <Clock className="w-3.5 h-3.5 text-muted-foreground" />,
  processing: <Loader2 className="w-3.5 h-3.5 text-purple-500 animate-spin" />,
  completed: <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />,
  failed: <XCircle className="w-3.5 h-3.5 text-red-500" />,
};

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
};

export function ProcessingStatusBar({ initialProcessingCount }: ProcessingStatusBarProps) {
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);
  const [summary, setSummary] = useState<ProcessingSummary | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [allDone, setAllDone] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollActive = useRef(initialProcessingCount > 0);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/documents/processing-status");
      if (!res.ok) return;

      const data = (await res.json()) as { jobs: ProcessingJob[]; summary: ProcessingSummary };
      setJobs(data.jobs);
      setSummary(data.summary);

      const activeCount = data.summary.queued + data.summary.processing;
      if (activeCount === 0 && data.summary.total > 0) {
        setAllDone(true);
        pollActive.current = false;
      } else if (activeCount === 0 && data.summary.total === 0) {
        pollActive.current = false;
      }
    } catch {
      // Silently handle fetch errors
    }
  }, []);

  useEffect(() => {
    if (initialProcessingCount > 0) {
      void fetchStatus();
    }
  }, [initialProcessingCount, fetchStatus]);

  useEffect(() => {
    if (!pollActive.current) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      if (pollActive.current) {
        void fetchStatus();
      } else if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }, 8000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [fetchStatus]);

  // Auto-dismiss "all done" message after 10 seconds
  useEffect(() => {
    if (allDone) {
      const timer = setTimeout(() => setDismissed(true), 10000);
      return () => clearTimeout(timer);
    }
  }, [allDone]);

  // Nothing to show
  if (dismissed) return null;
  if (!summary && initialProcessingCount === 0) return null;

  const activeCount = summary ? summary.queued + summary.processing : initialProcessingCount;
  const totalCount = summary?.total ?? initialProcessingCount;
  const completedCount = summary?.completed ?? 0;
  const failedCount = summary?.failed ?? 0;
  const progressPercent = totalCount > 0 ? Math.round(((completedCount + failedCount) / totalCount) * 100) : 0;

  // All done state
  if (allDone && activeCount === 0) {
    return (
      <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/60 rounded-xl p-4 transition-all">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-green-800 dark:text-green-300">
              All documents processed
            </p>
            <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">
              {completedCount} completed{failedCount > 0 ? `, ${failedCount} failed` : ""}. Documents are ready for AI queries.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Active processing state
  return (
    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/60 rounded-xl p-4 transition-all">
      <div className="flex items-start gap-3">
        <Loader2 className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0 animate-spin" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              Processing {activeCount} of {totalCount} document{totalCount !== 1 ? "s" : ""}
            </p>
            {jobs.length > 0 && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 flex items-center gap-1 transition-colors"
              >
                {expanded ? "Hide" : "Details"}
                {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            )}
          </div>

          {/* Progress bar */}
          <div className="mt-2">
            <Progress
              value={progressPercent}
              className="h-1.5 bg-amber-200 dark:bg-amber-800/40"
            />
            <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
              {progressPercent}% complete
              {summary && summary.queued > 0 && ` \u2022 ${summary.queued} queued`}
              {summary && summary.processing > 0 && ` \u2022 ${summary.processing} in progress`}
            </p>
          </div>

          {/* Per-document list */}
          {expanded && jobs.length > 0 && (
            <div className="mt-3 space-y-1.5 max-h-[200px] overflow-y-auto">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center gap-2 text-xs py-1 px-2 rounded-lg bg-amber-100/50 dark:bg-amber-900/30"
                >
                  {STATUS_ICON[job.status]}
                  <FileText className="w-3 h-3 text-amber-700 dark:text-amber-400 flex-shrink-0" />
                  <span className="flex-1 truncate text-amber-800 dark:text-amber-300">
                    {job.documentName}
                  </span>
                  <span className={cn(
                    "text-[10px] font-medium px-1.5 py-0.5 rounded",
                    job.status === "completed" && "text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30",
                    job.status === "failed" && "text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/30",
                    job.status === "processing" && "text-purple-700 dark:text-purple-400 bg-purple-100 dark:bg-purple-900/30",
                    job.status === "queued" && "text-muted-foreground bg-muted",
                  )}>
                    {STATUS_LABEL[job.status]}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
