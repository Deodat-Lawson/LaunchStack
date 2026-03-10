/**
 * Pomodoro Timer Tool
 * Role: LangChain tool to control Pomodoro focus sessions per user/session.
 * Purpose: start/pause/resume/stop/skip timers and report status with DB-backed state.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { and, eq } from "drizzle-orm";

import { studyAgentPomodoroSettings } from "~/server/db/schema";
import { db } from "~/server/db";
import { resolveSessionForUser } from "~/server/study-agent/session";
import type { PomodoroSession, PomodoroSettings, PomodoroPhase, PomodoroInput } from "../types";

const DEFAULT_SETTINGS: PomodoroSettings = {
    workDuration: 25,
    shortBreakDuration: 5,
    longBreakDuration: 15,
    sessionsBeforeLongBreak: 4,
    autoStartBreaks: false,
    autoStartWork: false,
};

type StoredPomodoroState = {
    phase: PomodoroPhase;
    isRunning: boolean;
    isPaused: boolean;
    startedAt?: string;
    pausedAt?: string;
    endsAt?: string;
    completedPomodoros: number;
    totalWorkMinutes: number;
    currentTaskId?: string;
    remainingSeconds: number;
};

const DEFAULT_STATE: StoredPomodoroState = {
    phase: "idle",
    isRunning: false,
    isPaused: false,
    completedPomodoros: 0,
    totalWorkMinutes: 0,
    remainingSeconds: 0,
};

const PomodoroSchema = z.object({
    action: z
        .enum(["start", "pause", "resume", "stop", "skip", "status", "configure"])
        .describe("The Pomodoro action to perform"),
    userId: z.string().describe("The user ID"),
    sessionId: z.string().optional().describe("Session ID to associate with the Pomodoro"),
    phase: z
        .enum(["work", "short_break", "long_break"])
        .optional()
        .describe("The timer to start, pause, resume, stop, skip, or status"),
    settings: z
        .object({
            workDuration: z.number().min(1).max(60).optional(),
            shortBreakDuration: z.number().min(1).max(30).optional(),
            longBreakDuration: z.number().min(1).max(60).optional(),
            sessionsBeforeLongBreak: z.number().min(1).max(10).optional(),
            autoStartBreaks: z.boolean().optional(),
            autoStartWork: z.boolean().optional(),
        })
        .optional()
        .describe("Pomodoro settings for configure action"),
});

/**
 * Get phase duration in minutes
 */
function getPhaseDuration(phase: PomodoroPhase, settings: PomodoroSettings): number {
    switch (phase) {
        case "work":
            return settings.workDuration;
        case "short_break":
            return settings.shortBreakDuration;
        case "long_break":
            return settings.longBreakDuration;
        default:
            return 0;
    }
}

/**
 * Get next phase after current one
 */
function getNextPhase(session: PomodoroSession): PomodoroPhase {
    if (session.phase === "work") {
        const pomodorosCompleted = session.completedPomodoros + 1;
        if (pomodorosCompleted % session.settings.sessionsBeforeLongBreak === 0) {
            return "long_break";
        }
        return "short_break";
    }
    return "work";
}

function calcRemainingSeconds(endsAt?: Date, pausedAt?: Date, isPaused?: boolean): number {
    if (!endsAt) return 0;
    const now = isPaused && pausedAt ? new Date(pausedAt) : new Date();
    const remainingMs = endsAt.getTime() - now.getTime();
    return remainingMs > 0 ? Math.floor(remainingMs / 1000) : 0;
}

/**
 * Manage Pomodoro timer
 */
export async function managePomodoro(
    input: PomodoroInput & { userId: string; sessionId?: string | number }
): Promise<{
    success: boolean;
    session?: PomodoroSession;
    message: string;
    phase?: PomodoroPhase;
    timeRemaining?: string;
    encouragement?: string;
}> {
    const parsedSessionId = input.sessionId ? Number(input.sessionId) : undefined;
    const now = new Date();
    const session = await resolveSessionForUser(
        input.userId,
        Number.isNaN(parsedSessionId) ? undefined : parsedSessionId
    );
    if (!session) {
        return {
            success: false,
            message: "Unable to find a study session for this user",
        };
    }

    const [settingsRow] = await db
        .select()
        .from(studyAgentPomodoroSettings)
        .where(
            and(
                eq(studyAgentPomodoroSettings.userId, input.userId),
                eq(studyAgentPomodoroSettings.sessionId, BigInt(session.id))
            )
        );

    const settings: PomodoroSettings = settingsRow
        ? {
              workDuration: settingsRow.focusMinutes,
              shortBreakDuration: settingsRow.shortBreakMinutes,
              longBreakDuration: settingsRow.longBreakMinutes,
              sessionsBeforeLongBreak: settingsRow.sessionsBeforeLongBreak,
              autoStartBreaks: settingsRow.autoStartBreaks,
              autoStartWork: settingsRow.autoStartPomodoros,
          }
        : DEFAULT_SETTINGS;

    const rowPhase = settingsRow?.phase as PomodoroPhase | undefined;
    const storedState: StoredPomodoroState = {
        ...DEFAULT_STATE,
        phase: rowPhase && ["work", "short_break", "long_break", "idle"].includes(rowPhase)
            ? rowPhase
            : DEFAULT_STATE.phase,
        isRunning: settingsRow?.isRunning ?? DEFAULT_STATE.isRunning,
        isPaused: settingsRow?.isPaused ?? DEFAULT_STATE.isPaused,
        startedAt: settingsRow?.startedAt ? settingsRow.startedAt.toISOString() : undefined,
        pausedAt: settingsRow?.pausedAt ? settingsRow.pausedAt.toISOString() : undefined,
        endsAt: settingsRow?.endsAt ? settingsRow.endsAt.toISOString() : undefined,
        completedPomodoros: settingsRow?.completedPomodoros ?? DEFAULT_STATE.completedPomodoros,
        totalWorkMinutes: settingsRow?.totalWorkMinutes ?? DEFAULT_STATE.totalWorkMinutes,
        currentTaskId: settingsRow?.currentTaskId ?? DEFAULT_STATE.currentTaskId,
        remainingSeconds: settingsRow?.remainingTime ?? 0,
    };

    const persistState = async (state: StoredPomodoroState, newSettings?: PomodoroSettings) => {
        const payload = {
            userId: input.userId,
            sessionId: BigInt(session.id),
            focusMinutes: newSettings?.workDuration ?? settings.workDuration,
            shortBreakMinutes: newSettings?.shortBreakDuration ?? settings.shortBreakDuration,
            longBreakMinutes: newSettings?.longBreakDuration ?? settings.longBreakDuration,
            sessionsBeforeLongBreak:
                newSettings?.sessionsBeforeLongBreak ?? settings.sessionsBeforeLongBreak,
            autoStartBreaks: newSettings?.autoStartBreaks ?? settings.autoStartBreaks,
            autoStartPomodoros: newSettings?.autoStartWork ?? settings.autoStartWork,
            remainingTime: state.remainingSeconds,
            phase: state.phase,
            isRunning: state.isRunning,
            isPaused: state.isPaused,
            startedAt: state.startedAt ? new Date(state.startedAt) : null,
            pausedAt: state.pausedAt ? new Date(state.pausedAt) : null,
            endsAt: state.endsAt ? new Date(state.endsAt) : null,
            completedPomodoros: state.completedPomodoros,
            totalWorkMinutes: state.totalWorkMinutes,
            currentTaskId: state.currentTaskId ?? null,
        };

        if (settingsRow) {
            await db
                .update(studyAgentPomodoroSettings)
                .set(payload)
                .where(
                    and(
                        eq(studyAgentPomodoroSettings.userId, input.userId),
                        eq(studyAgentPomodoroSettings.sessionId, BigInt(session.id))
                    )
                );
        } else {
            await db.insert(studyAgentPomodoroSettings).values(payload);
        }
    };

    const sessionFromState = (state: StoredPomodoroState): PomodoroSession => {
        const startedAt = state.startedAt ? new Date(state.startedAt) : undefined;
        const pausedAt = state.pausedAt ? new Date(state.pausedAt) : undefined;
        const endsAt = state.endsAt ? new Date(state.endsAt) : undefined;
        const remainingSeconds =
            state.remainingSeconds || calcRemainingSeconds(endsAt, pausedAt, state.isPaused);

        return {
            id: `${session.id}`,
            userId: input.userId,
            phase: state.phase,
            isRunning: state.isRunning,
            isPaused: state.isPaused,
            startedAt,
            pausedAt,
            endsAt,
            completedPomodoros: state.completedPomodoros,
            totalWorkMinutes: state.totalWorkMinutes,
            currentTaskId: state.currentTaskId,
            remainingSeconds,
            settings,
        };
    };

    switch (input.action) {
        case "start": {
            // Create new session or restart
            const phase: PomodoroPhase = input.phase ?? "work";
            const duration = getPhaseDuration(phase, settings);
            const endsAt = new Date(now.getTime() + duration * 60000);
            const durationSeconds = duration * 60;

            const newState: StoredPomodoroState = {
                phase,
                isRunning: true,
                isPaused: false,
                startedAt: now.toISOString(),
                endsAt: endsAt.toISOString(),
                completedPomodoros: storedState.completedPomodoros,
                totalWorkMinutes: storedState.totalWorkMinutes,
                currentTaskId: input.taskId,
                pausedAt: undefined,
                remainingSeconds: durationSeconds,
            };

            await persistState(newState, settings);
            console.log(`🍅 [Pomodoro] Started ${duration} minute work session`);

            return {
                success: true,
                session: sessionFromState(newState),
                message: `Started a ${duration} minute Pomodoro work session!`,
                timeRemaining: `${duration}:00`,
                encouragement: "Let's focus! You've got this~ 💪",
            };
        }

        case "pause": {
            if (!storedState.isRunning) {
                return { success: false, message: "No active Pomodoro session to pause" };
            }

            const remainingSeconds = calcRemainingSeconds(
                storedState.endsAt ? new Date(storedState.endsAt) : undefined,
                undefined,
                false
            );
            const updatedState: StoredPomodoroState = {
                ...storedState,
                isPaused: true,
                isRunning: false,
                pausedAt: now.toISOString(),
                remainingSeconds,
            };

            await persistState(updatedState, settings);
            const remainingLabel = `${Math.floor(remainingSeconds / 60)}:${(remainingSeconds % 60)
                .toString()
                .padStart(2, "0")}`;
            console.log(`⏸️ [Pomodoro] Paused with ${remainingLabel} remaining`);

            return {
                success: true,
                session: sessionFromState(updatedState),
                message: `Paused your Pomodoro timer with ${remainingLabel} remaining`,
                timeRemaining: remainingLabel,
                encouragement: "Take a quick breather, then let's get back to it~",
            };
        }

        case "resume": {
            if (!storedState.isPaused) {
                return { success: false, message: "No paused Pomodoro session to resume" };
            }

            const remainingSeconds = storedState.remainingSeconds ?? calcRemainingSeconds(
                storedState.endsAt ? new Date(storedState.endsAt) : undefined,
                storedState.pausedAt ? new Date(storedState.pausedAt) : undefined,
                true
            );
            const newEnd = new Date(now.getTime() + remainingSeconds * 1000).toISOString();

            const updatedState: StoredPomodoroState = {
                ...storedState,
                isPaused: false,
                isRunning: true,
                pausedAt: undefined,
                endsAt: newEnd,
                remainingSeconds,
            };

            await persistState(updatedState, settings);

            const remainingLabel = `${Math.floor(remainingSeconds / 60)}:${(remainingSeconds % 60)
                .toString()
                .padStart(2, "0")}`;
            console.log(`▶️ [Pomodoro] Resumed with ${remainingLabel} remaining`);

            return {
                success: true,
                session: sessionFromState(updatedState),
                message: `Resumed your Pomodoro timer! ${remainingLabel} remaining`,
                timeRemaining: remainingLabel,
                encouragement: "Welcome back! Let's finish strong~ 🎯",
            };
        }

        case "stop": {
            if (storedState.phase === "idle") {
                return { success: false, message: "No Pomodoro session to stop" };
            }

            // Calculate work time if we were in a work session
            let totalWorkMinutes = storedState.totalWorkMinutes;
            if (storedState.phase === "work" && storedState.startedAt) {
                const workedMs = now.getTime() - new Date(storedState.startedAt).getTime();
                const workedMinutes = Math.floor(workedMs / 60000);
                totalWorkMinutes += workedMinutes;
            }

            const completedPomodoros = storedState.completedPomodoros;
            const totalMinutes = totalWorkMinutes;

            const resetState: StoredPomodoroState = {
                phase: "idle",
                isRunning: false,
                isPaused: false,
                startedAt: undefined,
                endsAt: undefined,
                pausedAt: undefined,
                completedPomodoros,
                totalWorkMinutes,
                currentTaskId: storedState.currentTaskId,
                remainingSeconds: 0,
            };

            await persistState(resetState, settings);

            console.log(
                `🛑 [Pomodoro] Stopped. Total: ${completedPomodoros} pomodoros, ${totalMinutes} min`
            );

            return {
                success: true,
                session: sessionFromState(resetState),
                message: `Stopped Pomodoro timer. You completed ${completedPomodoros} pomodoros and worked for ${totalMinutes} minutes total!`,
                encouragement:
                    completedPomodoros > 0
                        ? "Great work today! Every pomodoro counts~ 🍅"
                        : "No worries! Ready when you are~",
            };
        }

        case "skip": {
            if (!storedState.isRunning) {
                return { success: false, message: "No active Pomodoro session to skip" };
            }

            // Complete current phase
            let completedPomodoros = storedState.completedPomodoros;
            let totalWorkMinutes = storedState.totalWorkMinutes;

            if (storedState.phase === "work") {
                completedPomodoros += 1;
                const duration = settings.workDuration;
                totalWorkMinutes += duration;
            }

            // Move to next phase
            const nextPhase = getNextPhase({
                ...sessionFromState(storedState),
                completedPomodoros,
                totalWorkMinutes,
            });
            const nextDuration = getPhaseDuration(nextPhase, settings);

            const nextState: StoredPomodoroState = {
                phase: nextPhase,
                startedAt: now.toISOString(),
                endsAt: new Date(now.getTime() + nextDuration * 60000).toISOString(),
                isRunning: true,
                isPaused: false,
                completedPomodoros,
                totalWorkMinutes,
                currentTaskId: storedState.currentTaskId,
                remainingSeconds: nextDuration * 60,
            };

            await persistState(nextState, settings);

            const phaseLabel =
                nextPhase === "work"
                    ? "work session"
                    : nextPhase === "short_break"
                      ? "short break"
                      : "long break";

            console.log(`⏭️ [Pomodoro] Skipped to ${phaseLabel}`);

            return {
                success: true,
                session: sessionFromState(nextState),
                message: `Skipped to ${phaseLabel}! ${nextDuration} minutes starting now`,
                timeRemaining: `${nextDuration}:00`,
                encouragement:
                    nextPhase === "work"
                        ? "Time to focus again! Let's do this~ 🚀"
                        : "Enjoy your break! You've earned it~ ☕",
            };
        }

        case "status": {
            if (storedState.phase === "idle" && !storedState.startedAt) {
                return {
                    success: true,
                    message: "No active Pomodoro session. Say 'start pomodoro' to begin!",
                    encouragement: "Ready to boost your productivity? Let's start a Pomodoro! 🍅",
                };
            }

            const status = storedState.isRunning
                ? "running"
                : storedState.isPaused
                  ? "paused"
                  : "idle";
            const remainingSeconds = storedState.remainingSeconds ?? calcRemainingSeconds(
                storedState.endsAt ? new Date(storedState.endsAt) : undefined,
                storedState.pausedAt ? new Date(storedState.pausedAt) : undefined,
                storedState.isPaused
            );
            const remaining =
                remainingSeconds > 0
                    ? `${Math.floor(remainingSeconds / 60)}:${(remainingSeconds % 60)
                          .toString()
                          .padStart(2, "0")}`
                    : null;
            const phaseLabel =
                storedState.phase === "work"
                    ? "work session"
                    : storedState.phase === "short_break"
                      ? "short break"
                      : storedState.phase === "long_break"
                        ? "long break"
                        : "idle";

            let message = `Pomodoro status: ${status}\n`;
            message += `Current phase: ${phaseLabel}\n`;
            if (remaining && storedState.isRunning) {
                message += `Time remaining: ${remaining}\n`;
            }
            message += `Completed pomodoros today: ${storedState.completedPomodoros}\n`;
            message += `Total focus time: ${storedState.totalWorkMinutes} minutes`;

            return {
                success: true,
                session: sessionFromState(storedState),
                message,
                timeRemaining: remaining ?? undefined,
                encouragement:
                    storedState.isRunning && storedState.phase === "work"
                        ? "Keep going! You're doing great~ 💪"
                        : storedState.phase.includes("break")
                          ? "Enjoy your break! You've earned it~"
                          : undefined,
            };
        }

        case "configure": {
            if (!input.settings) {
                return { success: false, message: "Settings are required for configure action" };
            }

            const currentSettings = settings;
            const newSettings: PomodoroSettings = {
                ...currentSettings,
                ...input.settings,
            };

            await persistState(storedState, newSettings);

            console.log(`⚙️ [Pomodoro] Updated settings:`, newSettings);

            return {
                success: true,
                session: sessionFromState(storedState),
                message: `Updated Pomodoro settings: ${newSettings.workDuration} min work, ${newSettings.shortBreakDuration} min short break, ${newSettings.longBreakDuration} min long break`,
            };
        }

        default:
            return { success: false, message: "Unknown action" };
    }
}

/**
 * Pomodoro Timer Tool for LangChain
 */
export const pomodoroTool = tool(
    async (input): Promise<string> => {
        try {
            const result = await managePomodoro({
                action: input.action,
                userId: input.userId,
                settings: input.settings,
                sessionId: input.sessionId,
            });

            return JSON.stringify(result);
        } catch (error) {
            return JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
            });
        }
    },
    {
        name: "pomodoro_timer",
        description: `Control the Pomodoro timer for focused study sessions.
    Use this when the user wants to:
    - Start a Pomodoro (focus session)
    - Pause or resume the timer
    - Stop the current session
    - Skip to the next phase (break or work)
    - Check timer status
    - Configure timer settings (work duration, break duration)

Examples: "Start a pomodoro", "Pause the timer", "How much time left?", "Set pomodoro to 30 minutes", "Skip this break"`,
        schema: PomodoroSchema,
    }
);
