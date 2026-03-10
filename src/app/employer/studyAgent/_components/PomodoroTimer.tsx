"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Play, Pause, RotateCcw, Clock, Coffee, Brain, Settings, SkipForward, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

interface PomodoroTimerProps {
  isDark?: boolean;
  onTimerUpdate?: (isRunning: boolean, phase: string, timeLeft: number) => void;
  sessionId?: number | null;
}

type TimerMode = "focus" | "shortBreak" | "longBreak" | "idle";

interface PomodoroSession {
  id: string;
  phase: "work" | "short_break" | "long_break" | "idle";
  isRunning: boolean;
  isPaused: boolean;
  endsAt?: string;
  completedPomodoros: number;
  totalWorkMinutes: number;
  settings: {
    workDuration: number;
    shortBreakDuration: number;
    longBreakDuration: number;
    sessionsBeforeLongBreak: number;
    autoStartBreaks: boolean;
    autoStartWork: boolean;
  };
}

export function PomodoroTimer({ isDark = false, sessionId }: PomodoroTimerProps) {
  const [mode, setMode] = useState<TimerMode>("focus");
  const [focusDuration, setFocusDuration] = useState(25);
  const [shortBreakDuration, setShortBreakDuration] = useState(5);
  const [longBreakDuration, setLongBreakDuration] = useState(15);
  const [sessionsBeforeLongBreak, setSessionsBeforeLongBreak] = useState(4);
  const [showSettings, setShowSettings] = useState(false);
  const [timeLeft, setTimeLeft] = useState(25 * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [completedSessions, setCompletedSessions] = useState(0);
  const [autoStartBreaks, setAutoStartBreaks] = useState(false);
  const [autoStartPomodoros, setAutoStartPomodoros] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const hasLoadedSettings = useRef(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const parseTimeString = (time?: string | null) => {
    if (!time) return undefined;
    const [mins, secs] = time.split(":").map((value) => Number(value));
    if (Number.isNaN(mins) || Number.isNaN(secs)) return undefined;
    return (mins ?? 0) * 60 + (secs ?? 0);
    };

  const syncWithBackend = useCallback(async () => {
    try {
      const url = new URL("/api/study-agent/sync/pomodoro", window.location.origin);
      if (sessionId) {
        url.searchParams.set("sessionId", String(sessionId));
      }

      const response = await fetch(url.toString());
      if (!response.ok) return;

      const data = (await response.json()) as {
        session?: Partial<PomodoroSession>;
        timeRemaining?: string | null;
      };
      const session: Partial<PomodoroSession> | null = data.session ?? null;

      if (session?.settings) {
        setFocusDuration(session.settings.workDuration ?? focusDuration);
        setShortBreakDuration(session.settings.shortBreakDuration ?? shortBreakDuration);
        setLongBreakDuration(session.settings.longBreakDuration ?? longBreakDuration);
        setSessionsBeforeLongBreak(
          session.settings.sessionsBeforeLongBreak ?? sessionsBeforeLongBreak
        );
        setAutoStartBreaks(Boolean(session.settings.autoStartBreaks));
        setAutoStartPomodoros(Boolean(session.settings.autoStartWork));
      }

      if (session?.phase) {
        if (session.phase === "short_break") setMode("shortBreak");
        else if (session.phase === "long_break") setMode("longBreak");
        else setMode("focus");
      }

      if (typeof session?.completedPomodoros === "number") {
        setCompletedSessions(session.completedPomodoros);
      }

      if (typeof session?.isRunning === "boolean") {
        setIsRunning(session.isRunning);
      }

      const durationSeconds =
        mode === "shortBreak"
          ? shortBreakDuration * 60
          : mode === "longBreak"
          ? longBreakDuration * 60
          : focusDuration * 60;
      const remainingFromStatus = data.timeRemaining ? parseTimeString(data.timeRemaining) : null;
      if (session?.endsAt) {
        const endsAt = new Date(session.endsAt);
        const remainingSeconds = Math.max(
          0,
          Math.floor((endsAt.getTime() - Date.now()) / 1000)
        );
        setTimeLeft(remainingSeconds || durationSeconds);
      } else if (remainingFromStatus !== undefined && remainingFromStatus !== null) {
        setTimeLeft(remainingFromStatus);
      }

      setLastSyncTime(new Date());
    } catch (error) {
      console.error("Error syncing Pomodoro state", error);
    }
  }, [
    focusDuration,
    shortBreakDuration,
    longBreakDuration,
    sessionsBeforeLongBreak,
    mode,
    sessionId,
  ]);

  const getCurrentDuration = () => {
    switch (mode) {
      case "focus":
        return focusDuration * 60;
      case "shortBreak":
        return shortBreakDuration * 60;
      case "longBreak":
        return longBreakDuration * 60;
      default:
        return focusDuration * 60;
    }
  };

  // Local countdown timer
  useEffect(() => {
    if (isRunning && timeLeft > 0) {
      intervalRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            void handleTimerComplete();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, timeLeft]);

  // Listen for external sync events (e.g., when AI uses pomodoro_timer tool)
  useEffect(() => {
    const handlePomodoroSync = () => {
      console.log("🍅 [Pomodoro] External sync event received, syncing with backend...");
      void syncWithBackend();
    };

    window.addEventListener("pomodoro-sync", handlePomodoroSync);
    return () => {
      window.removeEventListener("pomodoro-sync", handlePomodoroSync);
    };
  }, [syncWithBackend]);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settingsUrl = new URL(
          "/api/study-agent/me/pomodoro-settings",
          window.location.origin
        );
        if (sessionId) {
          settingsUrl.searchParams.set("sessionId", String(sessionId));
        }

        const response = await fetch(settingsUrl.toString());
        if (!response.ok) {
          throw new Error("Failed to fetch settings");
        }

        const data = (await response.json()) as {
          pomodoroSettings?: {
            focusMinutes?: number;
            shortBreakMinutes?: number;
            longBreakMinutes?: number;
            sessionsBeforeLongBreak?: number;
            autoStartBreaks?: boolean;
            autoStartPomodoros?: boolean;
          };
        };
        const settings = data.pomodoroSettings ?? {};
        setFocusDuration(settings.focusMinutes ?? 25);
        setShortBreakDuration(settings.shortBreakMinutes ?? 5);
        setLongBreakDuration(settings.longBreakMinutes ?? 15);
        setSessionsBeforeLongBreak(settings.sessionsBeforeLongBreak ?? 4);
        setAutoStartBreaks(Boolean(settings.autoStartBreaks));
        setAutoStartPomodoros(Boolean(settings.autoStartPomodoros));
        setTimeLeft((settings.focusMinutes ?? 25) * 60);
        setSettingsError(null);
      } catch (error) {
        console.error("Error loading Pomodoro settings", error);
        setSettingsError("Unable to load saved settings. Using defaults.");
      } finally {
        hasLoadedSettings.current = true;
        await syncWithBackend();
      }
    };

    hasLoadedSettings.current = false;
    void loadSettings();
  }, [sessionId, syncWithBackend]);

  useEffect(() => {
    if (!hasLoadedSettings.current) return;
    const controller = new AbortController();

    const persistSettings = async () => {
      try {
        const response = await fetch("/api/study-agent/me/pomodoro-settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            focusMinutes: focusDuration,
            shortBreakMinutes: shortBreakDuration,
            longBreakMinutes: longBreakDuration,
            sessionsBeforeLongBreak,
            autoStartBreaks,
            autoStartPomodoros,
            sessionId,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("Failed to save settings");
        }

        setSettingsError(null);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("Error saving Pomodoro settings", error);
        setSettingsError("We couldn't save your settings. They'll stay local for now.");
      }
    };

    void persistSettings();

    return () => controller.abort();
  }, [
    focusDuration,
    shortBreakDuration,
    longBreakDuration,
    sessionsBeforeLongBreak,
    autoStartBreaks,
    autoStartPomodoros,
    sessionId,
  ]);

  const handleTimerComplete = async () => {
    setIsRunning(false);
    // Sync with backend to move to next phase
    await syncAction("skip");
  };

  // Sync action with backend
  const syncAction = async (action: "start" | "pause" | "resume" | "stop" | "skip" | "configure", settings?: object) => {
    setIsSyncing(true);
    try {
      const response = await fetch("/api/study-agent/sync/pomodoro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, settings, sessionId: sessionId ?? undefined }),
      });

      if (response.ok) {
        // Re-sync state from backend
        await syncWithBackend();
      }
    } catch (error) {
      console.error("Error syncing action:", error);
    } finally {
      setIsSyncing(false);
    }
  };

  const switchMode = (newMode: TimerMode) => {
    setMode(newMode);
    let duration = focusDuration;
    if (newMode === "shortBreak") duration = shortBreakDuration;
    if (newMode === "longBreak") duration = longBreakDuration;
    setTimeLeft(duration * 60);
    setIsRunning(false);
  };

  const handlePlayPause = async () => {
    if (isRunning) {
      await syncAction("pause");
    } else {
      await syncAction(timeLeft < getCurrentDuration() ? "resume" : "start");
    }
  };

  const handleReset = async () => {
    await syncAction("stop");
    setTimeLeft(getCurrentDuration());
  };

  const handleSkip = async () => {
    await syncAction("skip");
  };

  const handleSaveSettings = async () => {
    await syncAction("configure", {
      workDuration: focusDuration,
      shortBreakDuration,
      longBreakDuration,
      sessionsBeforeLongBreak,
      autoStartBreaks,
      autoStartWork: autoStartPomodoros,
    });
    setShowSettings(false);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const progress = ((getCurrentDuration() - timeLeft) / getCurrentDuration()) * 100;

  return (
    <div
      className={`rounded-lg border p-3 ${
        isDark
          ? "bg-gray-800 border-gray-700"
          : "bg-gradient-to-br from-purple-50 to-blue-50 border-purple-200"
      }`}
    >
      {settingsError && (
        <p className="mb-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
          {settingsError}
        </p>
      )}
      {/* Mode Selector */}
      <div className="flex gap-1 mb-3">
        <Button
          variant={mode === "focus" ? "default" : "outline"}
          size="sm"
          onClick={() => switchMode("focus")}
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
          onClick={() => switchMode("shortBreak")}
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
          onClick={() => switchMode("longBreak")}
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

      {/* Timer Display */}
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

      {/* Controls */}
      <div className="flex gap-2 mb-3">
        <Button
          variant="default"
          size="sm"
          onClick={() => void handlePlayPause()}
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
          onClick={() => void handleSkip()}
          disabled={isSyncing || !isRunning}
          className={`h-9 w-9 p-0 ${isDark ? "text-gray-300" : ""}`}
          title="Skip to next phase"
        >
          <SkipForward className="w-4 h-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleReset()}
          disabled={isSyncing}
          className={`h-9 w-9 p-0 ${isDark ? "text-gray-300" : ""}`}
        >
          <RotateCcw className="w-4 h-4" />
        </Button>
      </div>

      {/* Session Counter and Settings Button */}
      <div className="flex items-center justify-between">
        <div
          className={`flex items-center gap-2 text-xs ${
            isDark ? "text-gray-400" : "text-gray-600"
          }`}
        >
          <Clock className="w-3 h-3" />
          <span>
            {completedSessions} session{completedSessions !== 1 ? "s" : ""} completed
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowSettings(!showSettings)}
          className={`h-8 w-8 p-0 ${isDark ? "text-gray-300 hover:bg-gray-700" : "hover:bg-purple-100"}`}
        >
          <Settings className="w-4 h-4" />
        </Button>
      </div>

      {/* Settings Panel */}
      {showSettings && (
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
              onClick={() => void handleSaveSettings()}
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
      )}
    </div>
  );
}
