import { relations, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    boolean,
    foreignKey,
    index,
    integer,
    jsonb,
    primaryKey,
    text,
    timestamp,
    unique,
    varchar,
} from "drizzle-orm/pg-core";

import { pgVector } from "../pgVector";
import { users } from "./base";
import { pgTable } from "./helpers";

export const agentAiChatbotChat = pgTable("agent_ai_chatbot_chat", {
    id: varchar("id", { length: 256 }).primaryKey().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
        .default(sql`CURRENT_TIMESTAMP`)
        .notNull(),
    title: text("title").notNull(),
    userId: varchar("user_id", { length: 256 }).notNull(),
    visibility: varchar("visibility", { length: 20, enum: ["public", "private"] })
        .notNull()
        .default("private"),
    agentMode: varchar("agent_mode", {
        length: 50,
        enum: ["autonomous", "interactive", "assisted"],
    })
        .notNull()
        .default("interactive"),
    status: varchar("status", {
        length: 50,
        enum: ["active", "completed", "paused", "failed"],
    })
        .notNull()
        .default("active"),
    aiStyle: varchar("ai_style", {
        length: 50,
        enum: ["concise", "detailed", "academic", "bullet-points"],
    }).default("concise"),
    aiPersona: varchar("ai_persona", {
        length: 50,
        enum: ["general", "learning-coach", "financial-expert", "legal-expert", "math-reasoning"],
    }).default("general"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
        () => new Date()
    ),
});

export const agentAiChatbotMessage = pgTable("agent_ai_chatbot_message", {
    id: varchar("id", { length: 256 }).primaryKey().notNull(),
    chatId: varchar("chat_id", { length: 256 })
        .notNull()
        .references(() => agentAiChatbotChat.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 50, enum: ["user", "assistant", "system", "tool"] }).notNull(),
    content: jsonb("content").notNull(),
    messageType: varchar("message_type", {
        length: 50,
        enum: ["text", "tool_call", "tool_result", "thinking"],
    })
        .notNull()
        .default("text"),
    parentMessageId: varchar("parent_message_id", { length: 256 }),
    createdAt: timestamp("created_at", { withTimezone: true })
        .default(sql`CURRENT_TIMESTAMP`)
        .notNull(),
});

export const agentAiChatbotTask = pgTable("agent_ai_chatbot_task", {
    id: varchar("id", { length: 256 }).primaryKey().notNull(),
    chatId: varchar("chat_id", { length: 256 })
        .notNull()
        .references(() => agentAiChatbotChat.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    objective: text("objective").notNull(),
    status: varchar("status", {
        length: 50,
        enum: ["pending", "in_progress", "completed", "failed", "cancelled"],
    })
        .notNull()
        .default("pending"),
    priority: integer("priority").notNull().default(0),
    result: jsonb("result"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
        .default(sql`CURRENT_TIMESTAMP`)
        .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
        () => new Date()
    ),
});

export const agentAiChatbotToolCall = pgTable("agent_ai_chatbot_tool_call", {
    id: varchar("id", { length: 256 }).primaryKey().notNull(),
    messageId: varchar("message_id", { length: 256 })
        .notNull()
        .references(() => agentAiChatbotMessage.id, { onDelete: "cascade" }),
    taskId: varchar("task_id", { length: 256 }).references(() => agentAiChatbotTask.id, {
        onDelete: "cascade",
    }),
    toolName: varchar("tool_name", { length: 256 }).notNull(),
    toolInput: jsonb("tool_input").notNull(),
    toolOutput: jsonb("tool_output"),
    status: varchar("status", { length: 50, enum: ["pending", "running", "completed", "failed"] })
        .notNull()
        .default("pending"),
    errorMessage: text("error_message"),
    executionTimeMs: integer("execution_time_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
        .default(sql`CURRENT_TIMESTAMP`)
        .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const agentAiChatbotExecutionStep = pgTable(
    "agent_ai_chatbot_execution_step",
    {
        id: varchar("id", { length: 256 }).primaryKey().notNull(),
        taskId: varchar("task_id", { length: 256 })
            .notNull()
            .references(() => agentAiChatbotTask.id, { onDelete: "cascade" }),
        stepNumber: integer("step_number").notNull(),
        stepType: varchar("step_type", {
            length: 50,
            enum: ["reasoning", "planning", "execution", "evaluation", "decision"],
        }).notNull(),
        description: text("description").notNull(),
        reasoning: text("reasoning"),
        input: jsonb("input"),
        output: jsonb("output"),
        status: varchar("status", {
            length: 50,
            enum: ["pending", "in_progress", "completed", "failed", "skipped"],
        })
            .notNull()
            .default("pending"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        completedAt: timestamp("completed_at", { withTimezone: true }),
    },
    (table) => ({
        taskStepIdx: index("agent_execution_step_task_step_idx").on(
            table.taskId,
            table.stepNumber
        ),
    })
);

export const agentAiChatbotMemory = pgTable(
    "agent_ai_chatbot_memory",
    {
        id: varchar("id", { length: 256 }).primaryKey().notNull(),
        chatId: varchar("chat_id", { length: 256 })
            .notNull()
            .references(() => agentAiChatbotChat.id, { onDelete: "cascade" }),
        memoryType: varchar("memory_type", {
            length: 50,
            enum: ["short_term", "long_term", "working", "episodic"],
        }).notNull(),
        key: varchar("key", { length: 256 }).notNull(),
        value: jsonb("value").notNull(),
        importance: integer("importance").notNull().default(5),
        embedding: pgVector({ dimension: 1536 })("embedding"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        accessedAt: timestamp("accessed_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        expiresAt: timestamp("expires_at", { withTimezone: true }),
    },
    (table) => ({
        chatMemoryIdx: index("agent_memory_chat_idx").on(table.chatId),
        chatMemoryTypeIdx: index("agent_memory_chat_type_idx").on(
            table.chatId,
            table.memoryType
        ),
    })
);

export const agentAiChatbotVote = pgTable(
    "agent_ai_chatbot_vote",
    {
        chatId: varchar("chat_id", { length: 256 })
            .notNull()
            .references(() => agentAiChatbotChat.id, { onDelete: "cascade" }),
        messageId: varchar("message_id", { length: 256 })
            .notNull()
            .references(() => agentAiChatbotMessage.id, { onDelete: "cascade" }),
        isUpvoted: boolean("is_upvoted").notNull(),
        feedback: text("feedback"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    (table) => ({
        pk: primaryKey({ columns: [table.chatId, table.messageId] }),
    })
);

export const agentAiChatbotDocument = pgTable(
    "agent_ai_chatbot_document",
    {
        id: varchar("id", { length: 256 }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        title: text("title").notNull(),
        content: text("content"),
        kind: varchar("kind", {
            length: 20,
            enum: ["text", "code", "image", "sheet", "json", "markdown"],
        })
            .notNull()
            .default("text"),
        userId: varchar("user_id", { length: 256 }).notNull(),
        chatId: varchar("chat_id", { length: 256 }).references(() => agentAiChatbotChat.id, {
            onDelete: "cascade",
        }),
        taskId: varchar("task_id", { length: 256 }).references(() => agentAiChatbotTask.id, {
            onDelete: "set null",
        }),
    },
    (table) => ({
        pk: primaryKey({ columns: [table.id, table.createdAt] }),
    })
);

export const agentAiChatbotSuggestion = pgTable(
    "agent_ai_chatbot_suggestion",
    {
        id: varchar("id", { length: 256 }).primaryKey().notNull(),
        documentId: varchar("document_id", { length: 256 }).notNull(),
        documentCreatedAt: timestamp("document_created_at", { withTimezone: true }).notNull(),
        originalText: text("original_text").notNull(),
        suggestedText: text("suggested_text").notNull(),
        description: text("description"),
        isResolved: boolean("is_resolved").notNull().default(false),
        userId: varchar("user_id", { length: 256 }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    (table) => ({
        documentRef: foreignKey({
            columns: [table.documentId, table.documentCreatedAt],
            foreignColumns: [agentAiChatbotDocument.id, agentAiChatbotDocument.createdAt],
        }),
    })
);

export const agentAiChatbotToolRegistry = pgTable(
    "agent_ai_chatbot_tool_registry",
    {
        id: varchar("id", { length: 256 }).primaryKey().notNull(),
        name: varchar("name", { length: 256 }).notNull(),
        description: text("description").notNull(),
        category: varchar("category", { length: 100 }).notNull(),
        schema: jsonb("schema").notNull(),
        isEnabled: boolean("is_enabled").notNull().default(true),
        requiredPermissions: jsonb("required_permissions"),
        rateLimit: integer("rate_limit"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
            () => new Date()
        ),
    },
    (table) => ({
        nameUnique: unique().on(table.name),
    })
);

export const agentAiChatbotUserRelations = relations(users, ({ many }) => ({
    agentChats: many(agentAiChatbotChat),
    agentDocuments: many(agentAiChatbotDocument),
    agentSuggestions: many(agentAiChatbotSuggestion),
}));

export const agentAiChatbotChatRelations = relations(agentAiChatbotChat, ({ one, many }) => ({
    user: one(users, {
        fields: [agentAiChatbotChat.userId],
        references: [users.userId],
    }),
    messages: many(agentAiChatbotMessage),
    tasks: many(agentAiChatbotTask),
    memory: many(agentAiChatbotMemory),
    votes: many(agentAiChatbotVote),
    documents: many(agentAiChatbotDocument),
}));

export const agentAiChatbotMessageRelations = relations(agentAiChatbotMessage, ({ one, many }) => ({
    chat: one(agentAiChatbotChat, {
        fields: [agentAiChatbotMessage.chatId],
        references: [agentAiChatbotChat.id],
    }),
    parentMessage: one(agentAiChatbotMessage, {
        fields: [agentAiChatbotMessage.parentMessageId],
        references: [agentAiChatbotMessage.id],
    }),
    toolCalls: many(agentAiChatbotToolCall),
    votes: many(agentAiChatbotVote),
}));

export const agentAiChatbotTaskRelations = relations(agentAiChatbotTask, ({ one, many }) => ({
    chat: one(agentAiChatbotChat, {
        fields: [agentAiChatbotTask.chatId],
        references: [agentAiChatbotChat.id],
    }),
    executionSteps: many(agentAiChatbotExecutionStep),
    toolCalls: many(agentAiChatbotToolCall),
    documents: many(agentAiChatbotDocument),
}));

export const agentAiChatbotToolCallRelations = relations(agentAiChatbotToolCall, ({ one }) => ({
    message: one(agentAiChatbotMessage, {
        fields: [agentAiChatbotToolCall.messageId],
        references: [agentAiChatbotMessage.id],
    }),
    task: one(agentAiChatbotTask, {
        fields: [agentAiChatbotToolCall.taskId],
        references: [agentAiChatbotTask.id],
    }),
}));

export const agentAiChatbotExecutionStepRelations = relations(agentAiChatbotExecutionStep, ({ one }) => ({
    task: one(agentAiChatbotTask, {
        fields: [agentAiChatbotExecutionStep.taskId],
        references: [agentAiChatbotTask.id],
    }),
}));

export const agentAiChatbotMemoryRelations = relations(agentAiChatbotMemory, ({ one }) => ({
    chat: one(agentAiChatbotChat, {
        fields: [agentAiChatbotMemory.chatId],
        references: [agentAiChatbotChat.id],
    }),
}));

export const agentAiChatbotVoteRelations = relations(agentAiChatbotVote, ({ one }) => ({
    chat: one(agentAiChatbotChat, {
        fields: [agentAiChatbotVote.chatId],
        references: [agentAiChatbotChat.id],
    }),
    message: one(agentAiChatbotMessage, {
        fields: [agentAiChatbotVote.messageId],
        references: [agentAiChatbotMessage.id],
    }),
}));

export const agentAiChatbotDocumentRelations = relations(agentAiChatbotDocument, ({ one, many }) => ({
    user: one(users, {
        fields: [agentAiChatbotDocument.userId],
        references: [users.userId],
    }),
    chat: one(agentAiChatbotChat, {
        fields: [agentAiChatbotDocument.chatId],
        references: [agentAiChatbotChat.id],
    }),
    task: one(agentAiChatbotTask, {
        fields: [agentAiChatbotDocument.taskId],
        references: [agentAiChatbotTask.id],
    }),
    suggestions: many(agentAiChatbotSuggestion),
}));

export const agentAiChatbotSuggestionRelations = relations(agentAiChatbotSuggestion, ({ one }) => ({
    user: one(users, {
        fields: [agentAiChatbotSuggestion.userId],
        references: [users.userId],
    }),
    document: one(agentAiChatbotDocument, {
        fields: [agentAiChatbotSuggestion.documentId, agentAiChatbotSuggestion.documentCreatedAt],
        references: [agentAiChatbotDocument.id, agentAiChatbotDocument.createdAt],
    }),
}));

export type AgentAiChatbotChat = InferSelectModel<typeof agentAiChatbotChat>;
export type AgentAiChatbotMessage = InferSelectModel<typeof agentAiChatbotMessage>;
export type AgentAiChatbotTask = InferSelectModel<typeof agentAiChatbotTask>;
export type AgentAiChatbotToolCall = InferSelectModel<typeof agentAiChatbotToolCall>;
export type AgentAiChatbotExecutionStep = InferSelectModel<typeof agentAiChatbotExecutionStep>;
export type AgentAiChatbotMemory = InferSelectModel<typeof agentAiChatbotMemory>;
export type AgentAiChatbotDocument = InferSelectModel<typeof agentAiChatbotDocument>;
export type AgentAiChatbotSuggestion = InferSelectModel<typeof agentAiChatbotSuggestion>;
export type AgentAiChatbotToolRegistry = InferSelectModel<typeof agentAiChatbotToolRegistry>;
