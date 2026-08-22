import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AnalysisRequestError,
  requestAnalysisStart,
  requestAnalysisStatus,
  startAnalysisStatusPolling,
  type AnalysisStatusResponse,
} from "./analysis-client";

const analysisId = "00000000-0000-4000-8000-000000000001";

function statusResult(
  status: AnalysisStatusResponse["status"],
): AnalysisStatusResponse {
  return { analysisId, status, error: null };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("analysis client requests", () => {
  it("starts analysis with the uploaded video id and accepts an existing in-progress analysis", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ analysisId, status: "ANALYZING" }, { status: 202 }),
    );

    await expect(
      requestAnalysisStart("video-id", { fetcher }),
    ).resolves.toEqual({ analysisId, status: "ANALYZING" });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/analyses",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ videoId: "video-id" }),
      }),
    );
  });

  it("preserves the stance action returned by the public API", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "STANCE_REQUIRED",
            message: "プロフィールでスタンスを設定してください。",
            action: "SET_STANCE",
          },
        },
        { status: 422 },
      ),
    );

    const error = await requestAnalysisStart("video-id", { fetcher }).catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(AnalysisRequestError);
    expect(error).toMatchObject({
      status: 422,
      detail: { code: "STANCE_REQUIRED", action: "SET_STANCE" },
    });
  });

  it("preserves the daily reset time returned by the public API", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "ANALYSIS_DAILY_LIMIT_REACHED",
            message: "本日の分析上限に達しました。",
            action: "WAIT_FOR_RESET",
            limit: 10,
            resetAt: "2026-08-23T15:00:00.000Z",
          },
        },
        { status: 429 },
      ),
    );

    const error = await requestAnalysisStart("video-id", { fetcher }).catch(
      (reason: unknown) => reason,
    );

    expect(error).toMatchObject({
      status: 429,
      detail: {
        code: "ANALYSIS_DAILY_LIMIT_REACHED",
        action: "WAIT_FOR_RESET",
        limit: 10,
        resetAt: "2026-08-23T15:00:00.000Z",
      },
    });
  });

  it("reads status without cache and validates the response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(statusResult("ANALYZING")),
    );

    await expect(
      requestAnalysisStatus(analysisId, { fetcher }),
    ).resolves.toEqual(statusResult("ANALYZING"));
    expect(fetcher).toHaveBeenCalledWith(
      `/api/analyses/${analysisId}`,
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
  });
});

describe("analysis status polling", () => {
  it("polls sequentially until a terminal status and then stops", async () => {
    vi.useFakeTimers();
    const fetchStatus = vi
      .fn()
      .mockResolvedValueOnce(statusResult("QUEUED"))
      .mockResolvedValueOnce(statusResult("ANALYZING"))
      .mockResolvedValueOnce(statusResult("COMPLETED"));
    const onStatus = vi.fn();
    const onTerminal = vi.fn();

    startAnalysisStatusPolling({
      analysisId,
      intervalMs: 100,
      fetchStatus,
      onStatus,
      onTerminal,
    });

    await vi.advanceTimersByTimeAsync(300);

    expect(fetchStatus).toHaveBeenCalledTimes(3);
    expect(onStatus.mock.calls.map(([result]) => result.status)).toEqual([
      "QUEUED",
      "ANALYZING",
      "COMPLETED",
    ]);
    expect(onTerminal).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(500);
    expect(fetchStatus).toHaveBeenCalledTimes(3);
  });

  it("aborts an in-flight request and suppresses callbacks when stopped", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const fetchStatus = vi.fn(
      (_id: string, signal: AbortSignal) =>
        new Promise<AnalysisStatusResponse>((_resolve, reject) => {
          requestSignal = signal;
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const onStatus = vi.fn();
    const onTerminal = vi.fn();
    const onError = vi.fn();
    const stop = startAnalysisStatusPolling({
      analysisId,
      intervalMs: 100,
      fetchStatus,
      onStatus,
      onTerminal,
      onError,
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(requestSignal?.aborted).toBe(false);

    stop();
    await Promise.resolve();

    expect(requestSignal?.aborted).toBe(true);
    expect(onStatus).not.toHaveBeenCalled();
    expect(onTerminal).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports a temporary polling error and retries", async () => {
    vi.useFakeTimers();
    const fetchStatus = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(statusResult("ANALYZING"));
    const onError = vi.fn();
    const stop = startAnalysisStatusPolling({
      analysisId,
      intervalMs: 100,
      fetchStatus,
      onStatus: vi.fn(),
      onTerminal: vi.fn(),
      onError,
    });

    await vi.advanceTimersByTimeAsync(200);

    expect(onError).toHaveBeenCalledOnce();
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    stop();
  });
});
