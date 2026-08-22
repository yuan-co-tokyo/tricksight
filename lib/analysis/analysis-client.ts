import type {
  AnalysisErrorAction,
  PublicAnalysisError,
} from "./analysis-public-error";

export type AnalysisStatus =
  | "QUEUED"
  | "ANALYZING"
  | "COMPLETED"
  | "FAILED";

export type AnalysisStartResponse = {
  analysisId: string;
  status: Extract<AnalysisStatus, "QUEUED" | "ANALYZING">;
};

export type AnalysisStatusResponse = {
  analysisId: string;
  status: AnalysisStatus;
  error: PublicAnalysisError | null;
};

export type AnalysisRequestErrorDetail = PublicAnalysisError & {
  limit?: number;
  resetAt?: string;
};

type RequestOptions = {
  fetcher?: typeof fetch;
  signal?: AbortSignal;
};

const analysisErrorActions = new Set<AnalysisErrorAction>([
  "CHECK_INPUT",
  "SIGN_IN",
  "SELECT_VIDEO",
  "WAIT_FOR_UPLOAD",
  "SET_STANCE",
  "RETRY_ANALYSIS",
  "RECORD_AGAIN",
  "TRY_LATER",
  "WAIT_FOR_RESET",
]);

const fallbackError: AnalysisRequestErrorDetail = {
  code: "ANALYSIS_UNAVAILABLE",
  message:
    "現在、分析を利用できません。時間をおいてからもう一度お試しください。",
  action: "TRY_LATER",
};

const resetAtFormatter = new Intl.DateTimeFormat("ja-JP", {
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Tokyo",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isAnalysisStatus(value: unknown): value is AnalysisStatus {
  return (
    value === "QUEUED" ||
    value === "ANALYZING" ||
    value === "COMPLETED" ||
    value === "FAILED"
  );
}

function parsePublicError(value: unknown): AnalysisRequestErrorDetail | null {
  if (!isRecord(value)) return null;

  const { code, message, action, limit, resetAt } = value;
  if (
    typeof code !== "string" ||
    typeof message !== "string" ||
    typeof action !== "string" ||
    !analysisErrorActions.has(action as AnalysisErrorAction)
  ) {
    return null;
  }

  return {
    code,
    message,
    action: action as AnalysisErrorAction,
    ...(typeof limit === "number" ? { limit } : {}),
    ...(typeof resetAt === "string" ? { resetAt } : {}),
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export class AnalysisRequestError extends Error {
  readonly status: number;
  readonly detail: AnalysisRequestErrorDetail;

  constructor(status: number, detail: AnalysisRequestErrorDetail) {
    super(detail.message);
    this.name = "AnalysisRequestError";
    this.status = status;
    this.detail = detail;
  }
}

export function formatAnalysisResetAt(resetAt: string | undefined) {
  if (!resetAt) return null;

  const date = new Date(resetAt);
  return Number.isNaN(date.getTime()) ? null : resetAtFormatter.format(date);
}

export async function requestAnalysisStart(
  videoId: string,
  options: RequestOptions = {},
): Promise<AnalysisStartResponse> {
  const response = await (options.fetcher ?? fetch)("/api/analyses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoId }),
    signal: options.signal,
  });
  const body = await readJson(response);

  if (!response.ok) {
    const detail = isRecord(body) ? parsePublicError(body.error) : null;
    throw new AnalysisRequestError(response.status, detail ?? fallbackError);
  }

  if (!isRecord(body)) {
    throw new AnalysisRequestError(502, fallbackError);
  }

  const { analysisId, status } = body;
  if (
    typeof analysisId !== "string" ||
    (status !== "QUEUED" && status !== "ANALYZING")
  ) {
    throw new AnalysisRequestError(502, fallbackError);
  }

  return { analysisId, status };
}

export async function requestAnalysisStatus(
  analysisId: string,
  options: RequestOptions = {},
): Promise<AnalysisStatusResponse> {
  const response = await (options.fetcher ?? fetch)(
    `/api/analyses/${encodeURIComponent(analysisId)}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: options.signal,
    },
  );
  const body = await readJson(response);

  if (!response.ok) {
    const detail = isRecord(body) ? parsePublicError(body.error) : null;
    throw new AnalysisRequestError(response.status, detail ?? fallbackError);
  }

  if (!isRecord(body)) {
    throw new AnalysisRequestError(502, fallbackError);
  }

  const { analysisId: responseAnalysisId, status, error } = body;
  const publicError = error === null ? null : parsePublicError(error);
  if (
    typeof responseAnalysisId !== "string" ||
    !isAnalysisStatus(status) ||
    (error !== null && publicError === null)
  ) {
    throw new AnalysisRequestError(502, fallbackError);
  }

  return {
    analysisId: responseAnalysisId,
    status,
    error: publicError,
  };
}

type AnalysisStatusPollerOptions = {
  analysisId: string;
  intervalMs?: number;
  fetchStatus?: (
    analysisId: string,
    signal: AbortSignal,
  ) => Promise<AnalysisStatusResponse>;
  onStatus(result: AnalysisStatusResponse): void;
  onTerminal(result: AnalysisStatusResponse): void;
  onError?(error: unknown): void;
};

export function startAnalysisStatusPolling({
  analysisId,
  intervalMs = 3_000,
  fetchStatus = (id, signal) => requestAnalysisStatus(id, { signal }),
  onStatus,
  onTerminal,
  onError,
}: AnalysisStatusPollerOptions): () => void {
  let stopped = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let activeRequest: AbortController | null = null;

  const scheduleNext = () => {
    if (stopped) return;
    timeoutId = setTimeout(run, intervalMs);
  };

  const run = async () => {
    if (stopped) return;

    activeRequest = new AbortController();

    try {
      const result = await fetchStatus(analysisId, activeRequest.signal);
      activeRequest = null;

      if (stopped) return;
      onStatus(result);

      if (result.status === "COMPLETED" || result.status === "FAILED") {
        stopped = true;
        onTerminal(result);
        return;
      }
    } catch (error) {
      activeRequest = null;
      if (stopped) return;
      onError?.(error);
    }

    scheduleNext();
  };

  scheduleNext();

  return () => {
    stopped = true;
    if (timeoutId !== null) clearTimeout(timeoutId);
    activeRequest?.abort();
    activeRequest = null;
  };
}
