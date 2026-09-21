import { startPoseVideoAnalysis } from "../pose/browser-analysis";
import { POSE_LANDMARKER_CONFIG } from "../pose/config";
import type {
  PoseAnalysisProgress,
  PoseAnalysisTask,
  PoseMeasurementResult,
} from "../pose/types";
import type { PoseRuntimeFamily } from "../pose/pose-measurement-client";

type StartPoseAnalysis = (
  video: Blob,
  options: {
    timeoutMs: number;
    onProgress(progress: PoseAnalysisProgress): void;
  },
) => PoseAnalysisTask;

export type PoseSelectionHandle = {
  result: Promise<PoseMeasurementResult>;
  cancel(): void;
};

export function createPoseSelectionCoordinator(
  startAnalysis: StartPoseAnalysis = startPoseVideoAnalysis,
  timeoutMs = POSE_LANDMARKER_CONFIG.defaultTimeoutMs,
) {
  let generation = 0;
  let currentTask: PoseAnalysisTask | null = null;

  const clear = () => {
    generation += 1;
    currentTask?.cancel();
    currentTask = null;
  };

  return {
    select(
      video: Blob,
      callbacks: {
        onProgress(progress: PoseAnalysisProgress): void;
        onTerminal(result: PoseMeasurementResult): void;
      },
    ): PoseSelectionHandle {
      clear();
      const selectedGeneration = generation;
      const task = startAnalysis(video, {
        timeoutMs,
        onProgress(progress) {
          if (selectedGeneration === generation) {
            callbacks.onProgress(progress);
          }
        },
      });
      currentTask = task;
      const result = task.result.then((measurement) => {
        if (selectedGeneration === generation) {
          callbacks.onTerminal(measurement);
        }
        return measurement;
      });

      return {
        result,
        cancel() {
          if (selectedGeneration === generation) task.cancel();
        },
      };
    },
    clear,
    dispose: clear,
  };
}

type PostUploadTasksInput<AnalysisResult, SaveResult> = {
  videoId: string;
  runtimeFamily: PoseRuntimeFamily;
  poseResult: Promise<PoseMeasurementResult>;
  startAnalysis(videoId: string): Promise<AnalysisResult>;
  savePoseMeasurement(input: {
    videoId: string;
    runtimeFamily: PoseRuntimeFamily;
    measurement: PoseMeasurementResult;
  }): Promise<SaveResult>;
};

export type PosePersistenceOutcome<SaveResult> =
  | { status: "SAVED"; result: SaveResult }
  | { status: "FAILED"; error: unknown };

/**
 * Starts the product's primary LLM path before observing the optional pose
 * result. Neither pose terminal status nor persistence failure can block,
 * cancel, or reject analysisStart.
 */
export function startIndependentPostUploadTasks<AnalysisResult, SaveResult>(
  input: PostUploadTasksInput<AnalysisResult, SaveResult>,
) {
  let analysisStart: Promise<AnalysisResult>;
  try {
    analysisStart = Promise.resolve(input.startAnalysis(input.videoId));
  } catch (error) {
    analysisStart = Promise.reject(error);
  }

  const posePersistence: Promise<PosePersistenceOutcome<SaveResult>> =
    input.poseResult
      .then((measurement) =>
        input.savePoseMeasurement({
          videoId: input.videoId,
          runtimeFamily: input.runtimeFamily,
          measurement,
        }),
      )
      .then((result) => ({ status: "SAVED" as const, result }))
      .catch((error: unknown) => ({ status: "FAILED" as const, error }));

  return { analysisStart, posePersistence };
}
