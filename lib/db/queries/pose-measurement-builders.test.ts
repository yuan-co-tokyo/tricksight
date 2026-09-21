import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, expectTypeOf, it } from "vitest";

import * as schema from "../schema";
import { buildPoseMeasurementByVideoQuery } from "./pose-measurement-builders";

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
});
