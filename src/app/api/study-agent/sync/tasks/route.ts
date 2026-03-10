/**
 * Tasks Sync API
 * Syncs study tasks between the agentic workflow and the UI
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { manageTasks } from "../../agentic/tools/UNUSED_task-manager";

export const runtime = "nodejs";

/**
 * GET - Get all tasks for the user
 */
export async function GET(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") as "pending" | "in_progress" | "completed" | "cancelled" | null;
    const priority = searchParams.get("priority") as "high" | "medium" | "low" | null;

    const result = await manageTasks({
      action: "list",
      userId,
      filters: {
        status: status ?? undefined,
        priority: priority ?? undefined,
      },
    });

    return NextResponse.json({
      success: result.success,
      tasks: result.tasks ?? [],
      message: result.message,
    });
  } catch (error) {
    console.error("Error getting tasks:", error);
    return NextResponse.json(
      { error: "Failed to get tasks" },
      { status: 500 }
    );
  }
}

/**
 * POST - Create, update, delete, or complete a task
 */
export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      action?: "create" | "update" | "delete" | "complete";
      taskId?: string;
      data?: {
        title?: string;
        description?: string;
        priority?: "high" | "medium" | "low";
        dueDate?: string;
        estimatedMinutes?: number;
        tags?: string[];
        relatedDocuments?: string[];
        status?: "pending" | "in_progress" | "completed" | "cancelled";
      };
    };
    const { action, taskId, data } = body;

    if (!action) {
      return NextResponse.json({ error: "Action is required" }, { status: 400 });
    }

    const result = await manageTasks({
      action,
      userId,
      taskId,
      data,
    });

    return NextResponse.json({
      success: result.success,
      task: result.task,
      tasks: result.tasks,
      message: result.message,
    });
  } catch (error) {
    console.error("Error managing task:", error);
    return NextResponse.json(
      { error: "Failed to manage task" },
      { status: 500 }
    );
  }
}

