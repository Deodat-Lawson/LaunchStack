export type TimerMode = "focus" | "shortBreak" | "longBreak" | "idle";

export interface PomodoroSession {
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

export interface PomodoroTimerProps {
  isDark?: boolean;
  onTimerUpdate?: (isRunning: boolean, phase: string, timeLeft: number) => void;
  sessionId?: number | null;
}

