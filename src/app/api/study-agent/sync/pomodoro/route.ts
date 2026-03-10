/**
 * Pomodoro Sync API
 * Role: keep pomodoro timer state in sync between UI and agent tools.
 * Purpose: expose status + control endpoints wrapping the shared pomodoro tool.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { managePomodoro } from "../../agentic/tools/pomodoro-timer";
import { parseSessionId } from "../../shared";

export const runtime = "nodejs";

/**
 * GET - Get current Pomodoro session state
 */
export async function GET(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await managePomodoro({
      action: "status",
      userId,
      sessionId: parseSessionId(request),
    });

    return NextResponse.json({
      success: true,
      session: result.session,
      message: result.message,
      timeRemaining: result.timeRemaining,
    });
  } catch (error) {
    console.error("Error getting pomodoro status:", error);
    return NextResponse.json(
      { error: "Failed to get pomodoro status" },
      { status: 500 }
    );
  }
}

/**
 * POST - Update Pomodoro state (start, pause, resume, stop, skip, configure)
 */
export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      action?: "start" | "pause" | "resume" | "stop" | "skip" | "configure";
      taskId?: string;
      settings?: {
        workDuration?: number;
        shortBreakDuration?: number;
        longBreakDuration?: number;
        sessionsBeforeLongBreak?: number;
        autoStartBreaks?: boolean;
        autoStartPomodoros?: boolean;
      };
      sessionId?: number;
    };
    const { action, taskId, settings, sessionId } = body;

    if (!action) {
      return NextResponse.json({ error: "Action is required" }, { status: 400 });
    }

    const result = await managePomodoro({
      action,
      userId,
      taskId,
      settings,
      sessionId: sessionId ?? parseSessionId(request),
    });

    return NextResponse.json({
      success: result.success,
      session: result.session,
      message: result.message,
      timeRemaining: result.timeRemaining,
      encouragement: result.encouragement,
    });
  } catch (error) {
    console.error("Error updating pomodoro:", error);
    return NextResponse.json(
      { error: "Failed to update pomodoro" },
      { status: 500 }
    );
  }
}

