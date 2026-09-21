import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, expectTypeOf, it } from "vitest";

import * as schema from "../schema";
import {
  buildLatestPreviousPoseMeasurementQuery,
  buildPoseMeasurementByVideoQuery,
  buildPreviousMatchingPoseMeasurementQuery,
} from "./pose-measurement-builders";

const database = drizzle.mock({ schema });

describe("pose measurement query builder", () => {
  it("requires userId and scopes video reads through sessions", () => {
    expectTypeOf(buildPoseMeasurementByVideoQuery)
      .parameter(1)
      .toEqualTypeOf<string>();

    const query = buildPoseMeasurementByVideoQuery(
      database,
      "non-owner-user",
      "11111111-1111-4111-8111-111111111111",
    ).toSQL();
    const sql = query.sql.replaceAll(/\s+/g, " ").trim();

    expect(sql).toContain(
      'from "pose_measurements" inner join "videos" on "videos"."id" = "pose_measurements"."video_id" inner join "sessions" on "sessions"."id" = "videos"."session_id"',
    );
    expect(sql).toMatch(
      /where \("pose_measurements"\."video_id" = \$\d+ and "sessions"\."user_id" = \$\d+\)/,
    );
    expect(query.params).toContain("non-owner-user");
    expect(query.params).toContain(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("rejects a blank owner ID before executing a query", () => {
    expect(() =>
      buildPoseMeasurementByVideoQuery(
        database,
        " ",
        "11111111-1111-4111-8111-111111111111",
      ),
    ).toThrow("userId is required");
  });

  it("finds the latest earlier measurement only with all nine comparison conditions", () => {
    const userId = "comparison-owner";
    const query = buildPreviousMatchingPoseMeasurementQuery(
      database,
      userId,
      {
        currentPracticedAt: new Date("2026-09-21T03:00:00.000Z"),
        currentCreatedAt: new Date("2026-09-21T04:00:00.000Z"),
        trickId: "22222222-2222-4222-8222-222222222222",
        videoSpeed: "SLOW_MOTION",
        cameraAngle: "SIDE",
        algorithmVersion: "pose-v1",
        modelSha256: "model-sha",
        sampleRateFps: 10,
        delegate: "CPU",
        runtimeFamily: "WEBKIT",
      },
    ).toSQL();
    const sql = query.sql.replaceAll(/\s+/g, " ").trim();

    expect(sql).toContain(
      'from "pose_measurements" inner join "videos" on "videos"."id" = "pose_measurements"."video_id" inner join "sessions" on "sessions"."id" = "videos"."session_id"',
    );
    expect(sql).toContain('"sessions"."user_id" = $');
    expect(sql).toContain('"sessions"."trick_id" = $');
    expect(sql).toContain('"sessions"."video_speed" = $');
    expect(sql).toContain('"sessions"."camera_angle" = $');
    expect(sql).toContain('"pose_measurements"."algorithm_version" = $');
    expect(sql).toContain('"pose_measurements"."model_sha256" = $');
    expect(sql).toContain('"pose_measurements"."sample_rate_fps" = $');
    expect(sql).toContain('"pose_measurements"."delegate" = $');
    expect(sql).toContain('"pose_measurements"."runtime_family" = $');
    expect(sql).toContain('"sessions"."practiced_at" < $');
    expect(sql).toContain('"sessions"."created_at" < $');
    expect(sql).toContain(
      'order by "sessions"."practiced_at" desc, "sessions"."created_at" desc, "sessions"."id" desc',
    );
    expect(sql).toMatch(/limit \$\d+$/);
    expect(sql).not.toContain("user_outcome");
    expect(sql).not.toContain("tasks_vision_version");
    expect(query.params).toEqual(
      expect.arrayContaining([
        userId,
        "22222222-2222-4222-8222-222222222222",
        "SLOW_MOTION",
        "SIDE",
        "pose-v1",
        "model-sha",
        10,
        "CPU",
        "WEBKIT",
      ]),
    );
  });

  it("owner-scopes the explanatory same-trick candidate without treating it as a comparison", () => {
    const userId = "comparison-owner";
    const query = buildLatestPreviousPoseMeasurementQuery(
      database,
      userId,
      {
        currentPracticedAt: new Date("2026-09-21T03:00:00.000Z"),
        currentCreatedAt: new Date("2026-09-21T04:00:00.000Z"),
        trickId: "22222222-2222-4222-8222-222222222222",
      },
    ).toSQL();
    const sql = query.sql.replaceAll(/\s+/g, " ").trim();

    expect(sql).toContain('"sessions"."user_id" = $');
    expect(sql).toContain('"sessions"."trick_id" = $');
    expect(sql).not.toContain('"sessions"."video_speed" = $');
    expect(sql).not.toContain('"sessions"."camera_angle" = $');
    expect(query.params).toContain(userId);
  });
});
