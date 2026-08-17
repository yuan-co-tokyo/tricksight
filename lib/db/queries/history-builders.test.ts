import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, expectTypeOf, it } from "vitest";

import * as schema from "../schema";

import {
  assembleDashboardSummary,
  buildActiveTricksQuery,
  buildDashboardLatestAnalysisQuery,
  buildDashboardLatestCompletedAnalysisQuery,
  buildDashboardRecentVideosQuery,
  buildDashboardTrickCountsQuery,
  buildPracticeSessionDetailQuery,
  buildPracticeSessionListQuery,
} from "./history-builders";

const database = drizzle.mock({ schema });

function compactSql(sql: string) {
  return sql.replaceAll(/\s+/g, " ").trim();
}

function expectOwnerScoped(input: {
  sql: string;
  params: unknown[];
  userId: string;
}) {
  expect(compactSql(input.sql)).toContain('"sessions"."user_id" = $');
  expect(input.params).toContain(input.userId);
}

describe("history query builders", () => {
  it("requires userId as a non-optional string on every public builder", () => {
    expectTypeOf(buildActiveTricksQuery).parameter(1).toEqualTypeOf<string>();
    expectTypeOf(buildPracticeSessionListQuery)
      .parameter(1)
      .toEqualTypeOf<string>();
    expectTypeOf(buildPracticeSessionDetailQuery)
      .parameter(1)
      .toEqualTypeOf<string>();
    expectTypeOf(buildDashboardLatestAnalysisQuery)
      .parameter(1)
      .toEqualTypeOf<string>();
    expectTypeOf(buildDashboardLatestCompletedAnalysisQuery)
      .parameter(1)
      .toEqualTypeOf<string>();
    expectTypeOf(buildDashboardRecentVideosQuery)
      .parameter(1)
      .toEqualTypeOf<string>();
    expectTypeOf(buildDashboardTrickCountsQuery)
      .parameter(1)
      .toEqualTypeOf<string>();

    expect(() => buildActiveTricksQuery(database, " ")).toThrow(
      "userId is required",
    );
  });

  it("lists only active tricks for an existing user in slug order", () => {
    const userId = "user-a";
    const query = buildActiveTricksQuery(database, userId).toSQL();
    const sql = compactSql(query.sql);

    expect(sql).toContain('where ("tricks"."is_active" = $1 and exists');
    expect(sql).toContain(
      'from "user" where "user"."id" = $2',
    );
    expect(sql).toContain('order by "tricks"."slug"');
    expect(query.params).toEqual([true, userId]);
  });

  it("scopes the session list and its latest-analysis subquery to the owner", () => {
    const userId = "user-a";
    const query = buildPracticeSessionListQuery(database, userId, {
      trickSlug: "kickflip",
    }).toSQL();
    const sql = compactSql(query.sql);

    expectOwnerScoped({ ...query, userId });
    expect(sql).toContain(
      'from "analyses" inner join "videos" on "videos"."id" = "analyses"."video_id" inner join "sessions" on "sessions"."id" = "videos"."session_id"',
    );
    expect(sql).toContain(
      'left join "videos" on "videos"."session_id" = "sessions"."id"',
    );
    expect(query.params.filter((value) => value === userId)).toHaveLength(2);
    expect(query.params).toContain("kickflip");
  });

  it("returns no row for another user's session because owner and session ID share one WHERE", () => {
    const otherUserId = "user-b";
    const sessionId = "session-owned-by-user-a";
    const query = buildPracticeSessionDetailQuery(
      database,
      otherUserId,
      sessionId,
    ).toSQL();
    const sql = compactSql(query.sql);

    expectOwnerScoped({ ...query, userId: otherUserId });
    expect(sql).toMatch(
      /where \("sessions"\."user_id" = \$\d+ and "sessions"\."id" = \$\d+\)/,
    );
    expect(query.params.filter((value) => value === otherUserId)).toHaveLength(2);
    expect(query.params).toContain(sessionId);
    expect(query.params).not.toContain("user-a");
    expect(sql).not.toContain("raw_response");
    expect(sql).not.toContain("error_message");
    expect(sql).toMatch(/limit \$\d+$/);
    expect(query.params.at(-1)).toBe(1);
  });

  it("never selects raw provider data or internal error details for history consumers", () => {
    const userId = "user-a";
    const queries = [
      buildPracticeSessionListQuery(database, userId).toSQL(),
      buildPracticeSessionDetailQuery(database, userId, "session-a").toSQL(),
      buildDashboardLatestAnalysisQuery(database, userId).toSQL(),
      buildDashboardLatestCompletedAnalysisQuery(database, userId).toSQL(),
    ];

    for (const query of queries) {
      const sql = compactSql(query.sql);
      expect(sql).not.toContain("raw_response");
      expect(sql).not.toContain("error_message");
    }
  });

  it("scopes every dashboard query and joins videos through sessions", () => {
    const userId = "dashboard-user";
    const latestAnalysis = buildDashboardLatestAnalysisQuery(
      database,
      userId,
    ).toSQL();
    const recentVideos = buildDashboardRecentVideosQuery(database, userId, {
      recentVideoLimit: 3,
    }).toSQL();
    const latestCompletedAnalysis =
      buildDashboardLatestCompletedAnalysisQuery(database, userId).toSQL();
    const trickCounts = buildDashboardTrickCountsQuery(
      database,
      userId,
    ).toSQL();

    for (const query of [
      latestAnalysis,
      latestCompletedAnalysis,
      recentVideos,
      trickCounts,
    ]) {
      expectOwnerScoped({ ...query, userId });
    }

    expect(compactSql(latestAnalysis.sql)).toContain(
      'inner join "videos" on "videos"."session_id" = "sessions"."id"',
    );
    expect(compactSql(recentVideos.sql)).toContain(
      'inner join "videos" on "videos"."session_id" = "sessions"."id"',
    );
    expect(compactSql(latestCompletedAnalysis.sql)).toContain(
      'inner join "analyses" on "analyses"."video_id" = "videos"."id"',
    );
    expect(latestCompletedAnalysis.params).toContain("COMPLETED");
    expect(compactSql(latestCompletedAnalysis.sql)).not.toContain(
      "raw_response",
    );
    expect(recentVideos.params).toContain(3);
    expect(compactSql(trickCounts.sql)).toContain(
      'group by "tricks"."id", "tricks"."slug", "tricks"."name"',
    );
  });

  it("keeps the latest completed coaching result when the latest attempt is analyzing", () => {
    const summary = assembleDashboardSummary({
      latestAnalyses: [{ id: "new-analysis", status: "ANALYZING" }],
      latestCompletedAnalyses: [
        { id: "older-completed-analysis", status: "COMPLETED" },
      ],
      recentVideos: [],
      trickCounts: [],
    });

    expect(summary.latestAnalysis).toEqual({
      id: "new-analysis",
      status: "ANALYZING",
    });
    expect(summary.latestCompletedAnalysis).toEqual({
      id: "older-completed-analysis",
      status: "COMPLETED",
    });
  });

  it("returns null when no completed dashboard analysis exists", () => {
    const summary = assembleDashboardSummary({
      latestAnalyses: [{ id: "latest-failed", status: "FAILED" }],
      latestCompletedAnalyses: [],
      recentVideos: [],
      trickCounts: [],
    });

    expect(summary.latestCompletedAnalysis).toBeNull();
  });

  it("rejects an unbounded recent-video limit", () => {
    expect(() =>
      buildDashboardRecentVideosQuery(database, "user-a", {
        recentVideoLimit: 0,
      }),
    ).toThrow("between 1 and 20");
    expect(() =>
      buildDashboardRecentVideosQuery(database, "user-a", {
        recentVideoLimit: 21,
      }),
    ).toThrow("between 1 and 20");
  });
});
