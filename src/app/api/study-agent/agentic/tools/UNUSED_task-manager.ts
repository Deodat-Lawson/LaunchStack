/**
 * Study Task Manager Tool
 * Create, update, delete, and manage study tasks
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import type { StudyTask, StudyTaskInput } from "../types";

// In-memory task store (in production, this would be in the database)
const taskStore = new Map<string, StudyTask>();

const TaskManagerSchema = z.object({
  action: z
    .enum(["create", "update", "delete", "list", "complete", "get"])
    .describe("The action to perform on tasks"),
  userId: z.string().describe("The user ID"),
  taskId: z.string().optional().describe("Task ID for update/delete/get/complete actions"),
  data: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      priority: z.enum(["high", "medium", "low"]).optional(),
      dueDate: z.string().optional(),
      estimatedMinutes: z.number().optional(),
      tags: z.array(z.string()).optional(),
      relatedDocuments: z.array(z.string()).optional(),
      status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
    })
    .optional()
    .describe("Task data for create/update actions"),
  filters: z
    .object({
      status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
      priority: z.enum(["high", "medium", "low"]).optional(),
      dueBefore: z.string().optional(),
      dueAfter: z.string().optional(),
    })
    .optional()
    .describe("Filters for list action"),
});

/**
 * Manage study tasks
 */
export async function manageTasks(
  input: StudyTaskInput & { userId: string }
): Promise<{
  success: boolean;
  task?: StudyTask;
  tasks?: StudyTask[];
  message: string;
}> {
  const now = new Date();

  switch (input.action) {
    case "create": {
      if (!input.data?.title) {
        return { success: false, message: "Task title is required" };
      }

      const newTask: StudyTask = {
        id: uuidv4(),
        userId: input.userId,
        title: input.data.title,
        description: input.data.description,
        status: "pending",
        priority: input.data.priority ?? "medium",
        dueDate: input.data.dueDate ? new Date(input.data.dueDate) : undefined,
        estimatedMinutes: input.data.estimatedMinutes,
        tags: input.data.tags ?? [],
        relatedDocuments: input.data.relatedDocuments ?? [],
        createdAt: now,
        updatedAt: now,
      };

      taskStore.set(newTask.id, newTask);
      console.log(`📋 [Task Manager] Created task: ${newTask.title}`);

      return {
        success: true,
        task: newTask,
        message: `Created task "${newTask.title}" with ${newTask.priority} priority`,
      };
    }

    case "update": {
      if (!input.taskId) {
        return { success: false, message: "Task ID is required for update" };
      }

      const existingTask = taskStore.get(input.taskId);
      if (!existingTask) {
        return { success: false, message: "Task not found" };
      }

      const updatedTask: StudyTask = {
        ...existingTask,
        title: input.data?.title ?? existingTask.title,
        description: input.data?.description ?? existingTask.description,
        priority: input.data?.priority ?? existingTask.priority,
        status: input.data?.status ?? existingTask.status,
        dueDate: input.data?.dueDate
          ? new Date(input.data.dueDate)
          : existingTask.dueDate,
        estimatedMinutes: input.data?.estimatedMinutes ?? existingTask.estimatedMinutes,
        tags: input.data?.tags ?? existingTask.tags,
        relatedDocuments: input.data?.relatedDocuments ?? existingTask.relatedDocuments,
        updatedAt: now,
      };

      taskStore.set(input.taskId, updatedTask);
      console.log(`📋 [Task Manager] Updated task: ${updatedTask.title}`);

      return {
        success: true,
        task: updatedTask,
        message: `Updated task "${updatedTask.title}"`,
      };
    }

    case "complete": {
      if (!input.taskId) {
        return { success: false, message: "Task ID is required" };
      }

      const task = taskStore.get(input.taskId);
      if (!task) {
        return { success: false, message: "Task not found" };
      }

      task.status = "completed";
      task.completedAt = now;
      task.updatedAt = now;
      taskStore.set(input.taskId, task);

      console.log(`✅ [Task Manager] Completed task: ${task.title}`);

      return {
        success: true,
        task,
        message: `Completed task "${task.title}"! Great job! 🎉`,
      };
    }

    case "delete": {
      if (!input.taskId) {
        return { success: false, message: "Task ID is required for delete" };
      }

      const task = taskStore.get(input.taskId);
      if (!task) {
        return { success: false, message: "Task not found" };
      }

      taskStore.delete(input.taskId);
      console.log(`🗑️ [Task Manager] Deleted task: ${task.title}`);

      return {
        success: true,
        message: `Deleted task "${task.title}"`,
      };
    }

    case "get": {
      if (!input.taskId) {
        return { success: false, message: "Task ID is required" };
      }

      const task = taskStore.get(input.taskId);
      if (!task) {
        return { success: false, message: "Task not found" };
      }

      return {
        success: true,
        task,
        message: `Found task "${task.title}"`,
      };
    }

    case "list": {
      let tasks = Array.from(taskStore.values()).filter(
        (t) => t.userId === input.userId
      );

      // Apply filters
      if (input.filters?.status) {
        tasks = tasks.filter((t) => t.status === input.filters!.status);
      }
      if (input.filters?.priority) {
        tasks = tasks.filter((t) => t.priority === input.filters!.priority);
      }
      if (input.filters?.dueBefore) {
        const before = new Date(input.filters.dueBefore);
        tasks = tasks.filter((t) => t.dueDate && t.dueDate <= before);
      }
      if (input.filters?.dueAfter) {
        const after = new Date(input.filters.dueAfter);
        tasks = tasks.filter((t) => t.dueDate && t.dueDate >= after);
      }

      // Sort by priority (high first) then by due date
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      tasks.sort((a, b) => {
        const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (pDiff !== 0) return pDiff;
        if (a.dueDate && b.dueDate) {
          return a.dueDate.getTime() - b.dueDate.getTime();
        }
        return 0;
      });

      const pendingCount = tasks.filter((t) => t.status === "pending").length;
      const inProgressCount = tasks.filter((t) => t.status === "in_progress").length;
      const completedCount = tasks.filter((t) => t.status === "completed").length;

      console.log(`📋 [Task Manager] Listed ${tasks.length} tasks`);

      return {
        success: true,
        tasks,
        message: `Found ${tasks.length} tasks: ${pendingCount} pending, ${inProgressCount} in progress, ${completedCount} completed`,
      };
    }

    default:
      return { success: false, message: "Unknown action" };
  }
}

/**
 * Task Manager Tool for LangChain
 */
export const taskManagerTool = tool(
  async (input): Promise<string> => {
    try {
      const result = await manageTasks({
        action: input.action,
        userId: input.userId,
        taskId: input.taskId,
        data: input.data,
        filters: input.filters,
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
    name: "manage_tasks",
    description: `Manage study tasks - create, update, delete, complete, or list tasks.
Use this when the user wants to:
- Create a new study task or todo item
- Mark a task as complete
- Update task details (priority, due date, etc.)
- View their task list
- Delete a task

Examples: "Add a task to review chapter 5", "Mark my calculus homework as done", "What tasks do I have?", "Set my essay task to high priority"`,
    schema: TaskManagerSchema,
  }
);

