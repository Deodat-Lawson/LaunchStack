"use client";

import React from "react";
import { Play, Pause, RotateCcw, SkipForward, Loader2 } from "lucide-react";
import { Button } from "../ui/button";
import type { TimerMode } from "./types";

interface TimerControlsProps {
  isDark: boolean;
  mode: TimerMode;
  isRunning: boolean;
  isSyncing: boolean;
  onPlayPause: () => void;
  onSkip: () => void;
  onReset: () => void;
}

export const TimerControls: React.FC<TimerControlsProps> = ({
  isDark,
  mode,
  isRunning,
  isSyncing,
  onPlayPause,
  onSkip,
  onReset,
}) => {
  return (
    <div className="flex gap-2 mb-3">
      <Button
        variant="default"
        size="sm"
        onClick={onPlayPause}
        disabled={isSyncing}
        className={`flex-1 h-9 ${
          mode === "focus"
            ? "bg-purple-600 hover:bg-purple-700"
            : mode === "shortBreak"
            ? "bg-green-600 hover:bg-green-700"
            : "bg-blue-600 hover:bg-blue-700"
        } text-white`}
      >
        {isSyncing ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : isRunning ? (
          <>
            <Pause className="w-4 h-4 mr-2" />
            Pause
          </>
        ) : (
          <>
            <Play className="w-4 h-4 mr-2" />
            Start
          </>
        )}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onSkip}
        disabled={isSyncing || !isRunning}
        className={`h-9 w-9 p-0 ${isDark ? "text-gray-300" : ""}`}
        title="Skip to next phase"
      >
        <SkipForward className="w-4 h-4" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onReset}
        disabled={isSyncing}
        className={`h-9 w-9 p-0 ${isDark ? "text-gray-300" : ""}`}
      >
        <RotateCcw className="w-4 h-4" />
      </Button>
    </div>
  );
};

