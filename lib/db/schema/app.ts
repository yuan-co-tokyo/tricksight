import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
};

export const cameraAngleEnum = pgEnum("camera_angle", [
  "SIDE",
  "FRONT",
  "REAR",
  "DIAGONAL",
]);

export const userOutcomeEnum = pgEnum("user_outcome", [
  "LANDED",
  "BAILED",
  "UNCLEAR",
]);

export const videoStatusEnum = pgEnum("video_status", [
  "PENDING_UPLOAD",
  "UPLOADED",
  "READY",
  "FAILED",
]);

export const analysisStatusEnum = pgEnum("analysis_status", [
  "QUEUED",
  "ANALYZING",
  "COMPLETED",
  "FAILED",
]);

export const tricks = pgTable(
  "tricks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    isActive: boolean("is_active").default(true).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("tricks_slug_uidx").on(table.slug),
  ],
);

export const practiceSessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    trickId: uuid("trick_id")
      .notNull()
      .references(() => tricks.id, { onDelete: "restrict" }),
    practicedAt: timestamp("practiced_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    cameraAngle: cameraAngleEnum("camera_angle").notNull(),
    userOutcome: userOutcomeEnum("user_outcome").notNull(),
    memo: text("memo"),
    ...timestamps,
  },
  (table) => [
    index("sessions_user_practiced_at_idx").on(
      table.userId,
      table.practicedAt,
    ),
    index("sessions_trick_id_idx").on(table.trickId),
  ],
);

export const videos = pgTable(
  "videos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => practiceSessions.id, { onDelete: "cascade" }),
    s3Key: text("s3_key").notNull(),
    originalFilename: text("original_filename").notNull(),
    contentType: text("content_type").notNull(),
    fileSize: bigint("file_size", { mode: "number" }).notNull(),
    durationMs: integer("duration_ms"),
    width: integer("width"),
    height: integer("height"),
    status: videoStatusEnum("status").default("PENDING_UPLOAD").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("videos_session_id_uidx").on(table.sessionId),
    uniqueIndex("videos_s3_key_uidx").on(table.s3Key),
    check("videos_file_size_check", sql`${table.fileSize} > 0`),
    check(
      "videos_duration_ms_check",
      sql`${table.durationMs} is null or ${table.durationMs} > 0`,
    ),
    check("videos_width_check", sql`${table.width} is null or ${table.width} > 0`),
    check("videos_height_check", sql`${table.height} is null or ${table.height} > 0`),
  ],
);

export const analyses = pgTable(
  "analyses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    modelId: text("model_id").notNull(),
    promptVersion: text("prompt_version").notNull(),
    status: analysisStatusEnum("status").default("QUEUED").notNull(),
    resultJson: jsonb("result_json"),
    rawResponse: jsonb("raw_response"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    attemptCount: integer("attempt_count").default(0).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("analyses_video_created_at_idx").on(table.videoId, table.createdAt),
    index("analyses_status_created_at_idx").on(table.status, table.createdAt),
    check("analyses_attempt_count_check", sql`${table.attemptCount} >= 0`),
  ],
);

export const trickRelations = relations(tricks, ({ many }) => ({
  sessions: many(practiceSessions),
}));

export const practiceSessionRelations = relations(
  practiceSessions,
  ({ one }) => ({
    user: one(user, {
      fields: [practiceSessions.userId],
      references: [user.id],
    }),
    trick: one(tricks, {
      fields: [practiceSessions.trickId],
      references: [tricks.id],
    }),
    video: one(videos),
  }),
);

export const videoRelations = relations(videos, ({ one, many }) => ({
  session: one(practiceSessions, {
    fields: [videos.sessionId],
    references: [practiceSessions.id],
  }),
  analyses: many(analyses),
}));

export const analysisRelations = relations(analyses, ({ one }) => ({
  video: one(videos, {
    fields: [analyses.videoId],
    references: [videos.id],
  }),
}));
