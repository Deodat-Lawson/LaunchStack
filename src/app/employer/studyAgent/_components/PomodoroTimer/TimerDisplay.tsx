"use client";

import React from "react";
import type { TimerMode } from "./types";

interface TimerDisplayProps {
  isDark: boolean;
  mode: TimerMode;
  timeLeft: number;
  progress: number;
  lastSyncTime: Date | null;
}

export const TimerDisplay: React.FC<TimerDisplayProps> = ({
  isDark,
  mode,
  timeLeft,
  progress,
  lastSyncTime,
}) => {
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="relative mb-3">
      {/* Progress Circle */}
      <svg className="w-full h-auto max-w-[180px] mx-auto" viewBox="0 0 200 200">
        <circle
          cx="100"
          cy="100"
          r="85"
          fill="none"
          stroke={isDark ? "#374151" : "#e5e7eb"}
          strokeWidth="8"
        />
        <circle
          cx="100"
          cy="100"
          r="85"
          fill="none"
          stroke={
            mode === "focus"
              ? "#9333ea"
              : mode === "shortBreak"
              ? "#16a34a"
              : "#2563eb"
          }
          strokeWidth="8"
          strokeDasharray={`${2 * Math.PI * 85}`}
          strokeDashoffset={`${2 * Math.PI * 85 * (1 - progress / 100)}`}
          strokeLinecap="round"
          transform="rotate(-90 100 100)"
          style={{ transition: "stroke-dashoffset 1s linear" }}
        />
      </svg>

      {/* Time Text */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div
          className={`text-3xl mb-1 ${
            isDark ? "text-white" : "text-gray-900"
          }`}
        >
          {formatTime(timeLeft)}
        </div>
        <div
          className={`text-xs uppercase tracking-wide ${
            isDark ? "text-gray-400" : "text-gray-600"
          }`}
        >
          {mode === "focus"
            ? "Focus Time"
            : mode === "shortBreak"
            ? "Short Break"
            : mode === "longBreak"
            ? "Long Break"
            : "Ready"}
        </div>
        {lastSyncTime && (
          <div className={`text-[10px] mt-1 ${isDark ? "text-gray-500" : "text-gray-400"}`}>
            Synced with buddy
          </div>
        )}
      </div>
    </div>
  );
};

