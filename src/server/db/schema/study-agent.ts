
import { relations, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { boolean, index, integer, serial, text, timestamp, varchar, bigint } from "drizzle-orm/pg-core";

import { pgTable } from "./helpers";

export const studyAgentSessions = pgTable(
    "study_agent_sessions",
    {
        id: serial("id").primaryKey(),
        userId: varchar("user_id", { length: 256 }).notNull(),
        name: text("name").notNull().default("Default Session"),
        mode: varchar("mode", { length: 32 }).notNull().default("teacher"), // "teacher" | "study-buddy"
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
            () => new Date()
        ),
    },
    (table) => ({
        sessionsUserIdx: index("study_agent_sessions_user_idx").on(table.userId),
    })
);

export const studyAgentProfile = pgTable(
    "study_agent_profile",
    {
        id: serial("id").primaryKey(),
        userId: varchar("user_id", { length: 256 }).notNull(),
        sessionId: bigint("session_id", { mode: "bigint" })
            .notNull()
            .references(() => studyAgentSessions.id, { onDelete: "cascade" }),
        aiName: text("ai_name"),
        aiGender: text("ai_gender"),
        aiAvatarUrl: text("ai_avatar_url"),
        aiExtroversion: integer("ai_extroversion"),
        aiIntuition: integer("ai_intuition"),
        aiThinking: integer("ai_thinking"),
        aiJudging: integer("ai_judging"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
            () => new Date()
        ),
    },
    (table) => ({
        userIdx: index("study_agent_profile_user_idx").on(table.userId),
        sessionIdx: index("study_agent_profile_session_idx").on(table.sessionId),
    })
);

export const studyAgentPreferences = pgTable(
    "study_agent_preferences",
    {
        id: serial("id").primaryKey(),
        userId: varchar("user_id", { length: 256 }).notNull(),
        sessionId: bigint("session_id", { mode: "bigint" })
            .notNull()
            .references(() => studyAgentSessions.id, { onDelete: "cascade" }),
        selectedDocuments: text("selected_documents").array().notNull().default([]),
        userName: text("user_name"),
        userGrade: text("user_grade"),
        userGender: text("user_gender"),
        fieldOfStudy: text("field_of_study"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
            () => new Date()
        ),
    },
    (table) => ({
        preferencesUserIdx: index("study_agent_preferences_user_idx").on(table.userId),
        preferencesSessionIdx: index("study_agent_preferences_session_idx").on(
            table.sessionId
        ),
    })
);

export const studyAgentGoals = pgTable(
    "study_agent_goals",
    {
        id: serial("id").primaryKey(),
        userId: varchar("user_id", { length: 256 }).notNull(),
        sessionId: bigint("session_id", { mode: "bigint" })
            .notNull()
            .references(() => studyAgentSessions.id, { onDelete: "cascade" }),
        title: text("title").notNull(),
        description: text("description"),
        materials: text("materials").array().default([]),
        completed: boolean("completed").notNull().default(false),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
            () => new Date()
        ),
    },
    (table) => ({
        goalsUserIdx: index("study_agent_goals_user_idx").on(table.userId),
        goalsSessionIdx: index("study_agent_goals_session_idx").on(table.sessionId),
    })
);

export const studyAgentPomodoroSettings = pgTable(
    "study_agent_pomodoro_settings",
    {
        id: serial("id").primaryKey(),
        userId: varchar("user_id", { length: 256 }).notNull(),
        sessionId: bigint("session_id", { mode: "bigint" })
            .notNull()
            .references(() => studyAgentSessions.id, { onDelete: "cascade" }),
        focusMinutes: integer("focus_minutes").notNull().default(25),
        shortBreakMinutes: integer("short_break_minutes").notNull().default(5),
        longBreakMinutes: integer("long_break_minutes").notNull().default(15),
        remainingTime: integer("remaining_time").notNull().default(0),
        sessionsBeforeLongBreak: integer("sessions_before_long_break")
            .notNull()
            .default(4),
        autoStartBreaks: boolean("auto_start_breaks").notNull().default(false),
        autoStartPomodoros: boolean("auto_start_pomodoros").notNull().default(false),
        phase: text("phase").notNull().default("idle"),
        isRunning: boolean("is_running").notNull().default(false),
        isPaused: boolean("is_paused").notNull().default(false),
        startedAt: timestamp("started_at", { withTimezone: true }),
        pausedAt: timestamp("paused_at", { withTimezone: true }),
        endsAt: timestamp("ends_at", { withTimezone: true }),
        completedPomodoros: integer("completed_pomodoros").notNull().default(0),
        totalWorkMinutes: integer("total_work_minutes").notNull().default(0),
        currentTaskId: text("current_task_id"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
            () => new Date()
        ),
    },
    (table) => ({
        pomodoroUserIdx: index("study_agent_pomodoro_settings_user_idx").on(
            table.userId
        ),
        pomodoroSessionIdx: index("study_agent_pomodoro_settings_session_idx").on(
            table.sessionId
        ),
    })
);

export const studyAgentNotes = pgTable(
    "study_agent_notes",
    {
        id: serial("id").primaryKey(),
        userId: varchar("user_id", { length: 256 }).notNull(),
        sessionId: bigint("session_id", { mode: "bigint" })
            .notNull()
            .references(() => studyAgentSessions.id, { onDelete: "cascade" }),
        title: text("title"),
        content: text("content"),
        tags: text("tags").array().default([]),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
            () => new Date()
        ),
    },
    (table) => ({
        notesUserIdx: index("study_agent_notes_user_idx").on(table.userId),
        notesSessionIdx: index("study_agent_notes_session_idx").on(table.sessionId),
    })
);

export const studyAgentMessages = pgTable(
    "study_agent_messages",
    {
        id: serial("id").primaryKey(),
        odlId: varchar("original_id", { length: 64 }), // store original frontend ID for dedup
        userId: varchar("user_id", { length: 256 }).notNull(),
        sessionId: bigint("session_id", { mode: "bigint" })
            .notNull()
            .references(() => studyAgentSessions.id, { onDelete: "cascade" }),
        role: varchar("role", { length: 32 }).notNull(), // "user" | "teacher" | "buddy"
        content: text("content").notNull(),
        ttsContent: text("tts_content"), // text with emotion tags for TTS
        attachedDocument: text("attached_document"),
        attachedDocumentId: text("attached_document_id"),
        attachedDocumentUrl: text("attached_document_url"),
        isVoice: boolean("is_voice").default(false),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    (table) => ({
        messagesUserIdIdx: index("study_agent_messages_user_id_idx").on(table.userId),
        messagesSessionIdIdx: index("study_agent_messages_session_id_idx").on(table.sessionId)
    })
);

export const studyAgentSessionRelations = relations(studyAgentSessions, ({ many }) => ({
    profiles: many(studyAgentProfile),
    preferences: many(studyAgentPreferences),
    goals: many(studyAgentGoals),
    pomodoroSettings: many(studyAgentPomodoroSettings),
    notes: many(studyAgentNotes),
    messages: many(studyAgentMessages),
}));

export const studyAgentProfileRelations = relations(studyAgentProfile, ({ one }) => ({
    session: one(studyAgentSessions, {
        fields: [studyAgentProfile.sessionId],
        references: [studyAgentSessions.id],
    }),
}));

export const studyAgentPreferencesRelations = relations(
    studyAgentPreferences,
    ({ one }) => ({
        session: one(studyAgentSessions, {
            fields: [studyAgentPreferences.sessionId],
            references: [studyAgentSessions.id],
        }),
    })
);

export const studyAgentGoalsRelations = relations(studyAgentGoals, ({ one }) => ({
    session: one(studyAgentSessions, {
        fields: [studyAgentGoals.sessionId],
        references: [studyAgentSessions.id],
    }),
}));

export const studyAgentPomodoroRelations = relations(
    studyAgentPomodoroSettings,
    ({ one }) => ({
        session: one(studyAgentSessions, {
            fields: [studyAgentPomodoroSettings.sessionId],
            references: [studyAgentSessions.id],
        }),
    })
);

export const studyAgentNotesRelations = relations(studyAgentNotes, ({ one }) => ({
    session: one(studyAgentSessions, {
        fields: [studyAgentNotes.sessionId],
        references: [studyAgentSessions.id],
    }),
}));

export const studyAgentMessagesRelations = relations(studyAgentMessages, ({ one }) => ({
    session: one(studyAgentSessions, {
        fields: [studyAgentMessages.sessionId],
        references: [studyAgentSessions.id],
    }),
}));

export type StudyAgentSession = InferSelectModel<typeof studyAgentSessions>;
export type StudyAgentGoal = InferSelectModel<typeof studyAgentGoals>;
export type StudyAgentProfile = InferSelectModel<typeof studyAgentProfile>;
export type StudyAgentPreferences = InferSelectModel<typeof studyAgentPreferences>;
export type StudyAgentPomodoroSettings = InferSelectModel<typeof studyAgentPomodoroSettings>;
export type StudyAgentNote = InferSelectModel<typeof studyAgentNotes>;
export type StudyAgentMessage = InferSelectModel<typeof studyAgentMessages>;