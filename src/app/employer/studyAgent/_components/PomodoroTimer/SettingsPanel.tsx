"use client";

import React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import type { TimerMode } from "./types";

interface SettingsPanelProps {
  isDark: boolean;
  focusDuration: number;
  setFocusDuration: (value: number) => void;
  shortBreakDuration: number;
  setShortBreakDuration: (value: number) => void;
  longBreakDuration: number;
  setLongBreakDuration: (value: number) => void;
  sessionsBeforeLongBreak: number;
  setSessionsBeforeLongBreak: (value: number) => void;
  autoStartBreaks: boolean;
  setAutoStartBreaks: (value: boolean) => void;
  autoStartPomodoros: boolean;
  setAutoStartPomodoros: (value: boolean) => void;
  mode: TimerMode;
  isRunning: boolean;
  setTimeLeft: (value: number) => void;
  isSyncing: boolean;
  onSaveSettings: () => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  isDark,
  focusDuration,
  setFocusDuration,
  shortBreakDuration,
  setShortBreakDuration,
  longBreakDuration,
  setLongBreakDuration,
  sessionsBeforeLongBreak,
  setSessionsBeforeLongBreak,
  autoStartBreaks,
  setAutoStartBreaks,
  autoStartPomodoros,
  setAutoStartPomodoros,
  mode,
  isRunning,
  setTimeLeft,
  isSyncing,
  onSaveSettings,
}) => {
  return (
    <div className={`mt-3 p-2.5 rounded-lg border space-y-2 ${
      isDark ? "bg-gray-900 border-gray-700" : "bg-white border-gray-200"
    }`}>
      <h4 className={`text-xs mb-1.5 ${isDark ? "text-white" : "text-gray-900"}`}>Timer Settings</h4>
      
      <div className="space-y-2">
        {/* Duration settings in 2 columns */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="focusDuration" className={`text-xs ${isDark ? "text-gray-300" : ""}`}>
              Focus (min)
            </Label>
            <Input
              type="number"
              id="focusDuration"
              value={focusDuration}
              onChange={(e) => {
                const val = Math.max(1, Math.min(60, Number(e.target.value)));
                setFocusDuration(val);
                if (mode === "focus" && !isRunning) {
                  setTimeLeft(val * 60);
                }
              }}
              min="1"
              max="60"
              className={`mt-0.5 h-8 text-xs ${isDark ? "bg-gray-800 border-gray-700 text-white" : ""}`}
            />
          </div>

          <div>
            <Label htmlFor="shortBreakDuration" className={`text-xs ${isDark ? "text-gray-300" : ""}`}>
              Short (min)
            </Label>
            <Input
              type="number"
              id="shortBreakDuration"
              value={shortBreakDuration}
              onChange={(e) => {
                const val = Math.max(1, Math.min(30, Number(e.target.value)));
                setShortBreakDuration(val);
                if (mode === "shortBreak" && !isRunning) {
                  setTimeLeft(val * 60);
                }
              }}
              min="1"
              max="30"
              className={`mt-0.5 h-8 text-xs ${isDark ? "bg-gray-800 border-gray-700 text-white" : ""}`}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="longBreakDuration" className={`text-xs ${isDark ? "text-gray-300" : ""}`}>
              Long (min)
            </Label>
            <Input
              type="number"
              id="longBreakDuration"
              value={longBreakDuration}
              onChange={(e) => {
                const val = Math.max(1, Math.min(60, Number(e.target.value)));
                setLongBreakDuration(val);
                if (mode === "longBreak" && !isRunning) {
                  setTimeLeft(val * 60);
                }
              }}
              min="1"
              max="60"
              className={`mt-0.5 h-8 text-xs ${isDark ? "bg-gray-800 border-gray-700 text-white" : ""}`}
            />
          </div>

          <div>
            <Label htmlFor="sessionsBeforeLongBreak" className={`text-xs ${isDark ? "text-gray-300" : ""}`}>
              Cycles
            </Label>
            <Input
              type="number"
              id="sessionsBeforeLongBreak"
              value={sessionsBeforeLongBreak}
              onChange={(e) => setSessionsBeforeLongBreak(Math.max(1, Math.min(10, Number(e.target.value))))}
              min="1"
              max="10"
              className={`mt-0.5 h-8 text-xs ${isDark ? "bg-gray-800 border-gray-700 text-white" : ""}`}
            />
          </div>
        </div>

        <div className={`pt-2 border-t space-y-1.5 ${isDark ? "border-gray-700" : "border-gray-200"}`}>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoStartBreaks}
              onChange={(e) => setAutoStartBreaks(e.target.checked)}
              className="w-3.5 h-3.5 rounded"
            />
            <span className={`text-xs ${isDark ? "text-gray-300" : "text-gray-700"}`}>
              Auto-start breaks
            </span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoStartPomodoros}
              onChange={(e) => setAutoStartPomodoros(e.target.checked)}
              className="w-3.5 h-3.5 rounded"
            />
            <span className={`text-xs ${isDark ? "text-gray-300" : "text-gray-700"}`}>
              Auto-start focus sessions
            </span>
          </label>
        </div>

        {/* Save Settings Button */}
        <Button
          variant="default"
          size="sm"
          onClick={onSaveSettings}
          disabled={isSyncing}
          className="w-full h-8 text-xs bg-purple-600 hover:bg-purple-700 text-white mt-2"
        >
          {isSyncing ? (
            <Loader2 className="w-3 h-3 animate-spin mr-1" />
          ) : null}
          Save Settings
        </Button>
      </div>
    </div>
  );
};

