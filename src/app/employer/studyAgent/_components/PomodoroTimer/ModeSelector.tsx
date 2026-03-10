"use client";

import React from "react";
import { Brain, Coffee } from "lucide-react";
import { Button } from "../ui/button";
import type { TimerMode } from "./types";

interface ModeSelectorProps {
  isDark: boolean;
  mode: TimerMode;
  isRunning: boolean;
  onSwitchMode: (mode: TimerMode) => void;
}

export const ModeSelector: React.FC<ModeSelectorProps> = ({
  isDark,
  mode,
  isRunning,
  onSwitchMode,
}) => {
  return (
    <div className="flex gap-1 mb-3">
      <Button
        variant={mode === "focus" ? "default" : "outline"}
        size="sm"
        onClick={() => onSwitchMode("focus")}
        disabled={isRunning}
        className={`flex-1 h-8 text-xs ${
          mode === "focus"
            ? "bg-purple-600 hover:bg-purple-700 text-white"
            : isDark
            ? "text-gray-300"
            : ""
        }`}
      >
        <Brain className="w-3 h-3 mr-1" />
        Focus
      </Button>
      <Button
        variant={mode === "shortBreak" ? "default" : "outline"}
        size="sm"
        onClick={() => onSwitchMode("shortBreak")}
        disabled={isRunning}
        className={`flex-1 h-8 text-xs ${
          mode === "shortBreak"
            ? "bg-green-600 hover:bg-green-700 text-white"
            : isDark
            ? "text-gray-300"
            : ""
        }`}
      >
        <Coffee className="w-3 h-3 mr-1" />
        Break
      </Button>
      <Button
        variant={mode === "longBreak" ? "default" : "outline"}
        size="sm"
        onClick={() => onSwitchMode("longBreak")}
        disabled={isRunning}
        className={`flex-1 h-8 text-xs ${
          mode === "longBreak"
            ? "bg-blue-600 hover:bg-blue-700 text-white"
            : isDark
            ? "text-gray-300"
            : ""
        }`}
      >
        <Coffee className="w-3 h-3 mr-1" />
        Long
      </Button>
    </div>
  );
};

