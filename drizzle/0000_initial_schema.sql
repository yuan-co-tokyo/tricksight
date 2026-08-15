CREATE TYPE "public"."analysis_status" AS ENUM('QUEUED', 'ANALYZING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."camera_angle" AS ENUM('SIDE', 'FRONT', 'REAR', 'DIAGONAL');--> statement-breakpoint
CREATE TYPE "public"."user_outcome" AS ENUM('LANDED', 'BAILED', 'UNCLEAR');--> statement-breakpoint
CREATE TYPE "public"."video_status" AS ENUM('PENDING_UPLOAD', 'UPLOADED', 'READY', 'FAILED');--> statement-breakpoint
CREATE TABLE "analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"prompt_version" text NOT NULL,
	"status" "analysis_status" DEFAULT 'QUEUED' NOT NULL,
	"result_json" jsonb,
	"raw_response" jsonb,
	"error_code" text,
	"error_message" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analyses_attempt_count_check" CHECK ("analyses"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"trick_id" uuid NOT NULL,
	"practiced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"camera_angle" "camera_angle" NOT NULL,
	"user_outcome" "user_outcome" NOT NULL,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tricks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"s3_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"content_type" text NOT NULL,
	"file_size" bigint NOT NULL,
	"duration_ms" integer,
	"width" integer,
	"height" integer,
	"status" "video_status" DEFAULT 'PENDING_UPLOAD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "videos_file_size_check" CHECK ("videos"."file_size" > 0),
	CONSTRAINT "videos_duration_ms_check" CHECK ("videos"."duration_ms" is null or "videos"."duration_ms" > 0),
	CONSTRAINT "videos_width_check" CHECK ("videos"."width" is null or "videos"."width" > 0),
	CONSTRAINT "videos_height_check" CHECK ("videos"."height" is null or "videos"."height" > 0)
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"stance" text,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_trick_id_tricks_id_fk" FOREIGN KEY ("trick_id") REFERENCES "public"."tricks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analyses_video_created_at_idx" ON "analyses" USING btree ("video_id","created_at");--> statement-breakpoint
CREATE INDEX "analyses_status_created_at_idx" ON "analyses" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_practiced_at_idx" ON "sessions" USING btree ("user_id","practiced_at");--> statement-breakpoint
CREATE INDEX "sessions_trick_id_idx" ON "sessions" USING btree ("trick_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tricks_slug_uidx" ON "tricks" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "videos_session_id_uidx" ON "videos" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "videos_s3_key_uidx" ON "videos" USING btree ("s3_key");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");