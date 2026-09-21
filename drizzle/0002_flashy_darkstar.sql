CREATE TYPE "public"."pose_measurement_status" AS ENUM('COMPLETED', 'UNASSESSABLE', 'FAILED', 'TIMED_OUT', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."video_speed" AS ENUM('NORMAL', 'SLOW_MOTION');--> statement-breakpoint
CREATE TABLE "pose_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"status" "pose_measurement_status" NOT NULL,
	"quality_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_code" text,
	"algorithm_version" text NOT NULL,
	"tasks_vision_version" text NOT NULL,
	"model_sha256" text NOT NULL,
	"sample_rate_fps" integer NOT NULL,
	"delegate" text NOT NULL,
	"runtime_family" text NOT NULL,
	"frame_count" integer,
	"pose_frame_count" integer,
	"lower_body_frame_count" integer,
	"pose_coverage" double precision,
	"lower_body_coverage" double precision,
	"minimum_mean_knee_angle_deg" double precision,
	"knee_extension_range_deg" double precision,
	"hip_vertical_range_torso_units" double precision,
	"landing_trunk_tilt_deg" double precision,
	"processing_duration_ms" integer,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pose_measurements_runtime_family_check" CHECK ("pose_measurements"."runtime_family" in ('WEBKIT', 'CHROMIUM')),
	CONSTRAINT "pose_measurements_sample_rate_fps_check" CHECK ("pose_measurements"."sample_rate_fps" > 0),
	CONSTRAINT "pose_measurements_processing_duration_check" CHECK ("pose_measurements"."processing_duration_ms" is null or "pose_measurements"."processing_duration_ms" >= 0),
	CONSTRAINT "pose_measurements_counts_check" CHECK ((
        "pose_measurements"."frame_count" is null
        and "pose_measurements"."pose_frame_count" is null
        and "pose_measurements"."lower_body_frame_count" is null
      ) or (
        "pose_measurements"."frame_count" > 0
        and "pose_measurements"."pose_frame_count" between 0 and "pose_measurements"."frame_count"
        and "pose_measurements"."lower_body_frame_count" between 0 and "pose_measurements"."pose_frame_count"
      )),
	CONSTRAINT "pose_measurements_coverage_check" CHECK ((
        "pose_measurements"."pose_coverage" is null
        and "pose_measurements"."lower_body_coverage" is null
      ) or (
        "pose_measurements"."pose_coverage" between 0 and 1
        and "pose_measurements"."lower_body_coverage" between 0 and 1
        and abs(
          "pose_measurements"."pose_coverage"
          - "pose_measurements"."pose_frame_count"::double precision / "pose_measurements"."frame_count"
        ) < 0.000000000001
        and abs(
          "pose_measurements"."lower_body_coverage"
          - "pose_measurements"."lower_body_frame_count"::double precision / "pose_measurements"."frame_count"
        ) < 0.000000000001
      )),
	CONSTRAINT "pose_measurements_metric_ranges_check" CHECK (("pose_measurements"."minimum_mean_knee_angle_deg" is null or "pose_measurements"."minimum_mean_knee_angle_deg" between 0 and 180)
        and ("pose_measurements"."knee_extension_range_deg" is null or "pose_measurements"."knee_extension_range_deg" between 0 and 180)
        and ("pose_measurements"."hip_vertical_range_torso_units" is null or "pose_measurements"."hip_vertical_range_torso_units" between 0 and 10)
        and ("pose_measurements"."landing_trunk_tilt_deg" is null or "pose_measurements"."landing_trunk_tilt_deg" between 0 and 90)),
	CONSTRAINT "pose_measurements_status_payload_check" CHECK ((
        "pose_measurements"."status" = 'COMPLETED'
        and "pose_measurements"."frame_count" is not null
        and "pose_measurements"."pose_coverage" >= 0.8
        and "pose_measurements"."lower_body_coverage" >= 0.8
        and "pose_measurements"."error_code" is null
        and "pose_measurements"."quality_reasons" = '[]'::jsonb
      ) or (
        "pose_measurements"."status" = 'UNASSESSABLE'
        and "pose_measurements"."frame_count" is not null
        and ("pose_measurements"."pose_coverage" < 0.8 or "pose_measurements"."lower_body_coverage" < 0.8)
        and "pose_measurements"."minimum_mean_knee_angle_deg" is null
        and "pose_measurements"."knee_extension_range_deg" is null
        and "pose_measurements"."hip_vertical_range_torso_units" is null
        and "pose_measurements"."landing_trunk_tilt_deg" is null
        and "pose_measurements"."error_code" is null
        and jsonb_array_length("pose_measurements"."quality_reasons") > 0
      ) or (
        "pose_measurements"."status" in ('FAILED', 'TIMED_OUT', 'CANCELED')
        and "pose_measurements"."frame_count" is null
        and "pose_measurements"."pose_frame_count" is null
        and "pose_measurements"."lower_body_frame_count" is null
        and "pose_measurements"."pose_coverage" is null
        and "pose_measurements"."lower_body_coverage" is null
        and "pose_measurements"."minimum_mean_knee_angle_deg" is null
        and "pose_measurements"."knee_extension_range_deg" is null
        and "pose_measurements"."hip_vertical_range_torso_units" is null
        and "pose_measurements"."landing_trunk_tilt_deg" is null
        and "pose_measurements"."quality_reasons" = '[]'::jsonb
        and (
          ("pose_measurements"."status" = 'FAILED' and "pose_measurements"."error_code" is not null)
          or ("pose_measurements"."status" in ('TIMED_OUT', 'CANCELED') and "pose_measurements"."error_code" is null)
        )
      ))
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "video_speed" "video_speed";--> statement-breakpoint
ALTER TABLE "pose_measurements" ADD CONSTRAINT "pose_measurements_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pose_measurements_video_id_uidx" ON "pose_measurements" USING btree ("video_id");