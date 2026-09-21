import type { PoseAssetUrls } from "./config";
import type { PoseFailureCode, PoseMeasurementResult } from "./types";

export type PoseWorkerRequest =
  | {
      id: number;
      type: "initialize";
      assetUrls: PoseAssetUrls;
    }
  | {
      id: number;
      type: "detect";
      bitmap: ImageBitmap;
      timestampMs: number;
    }
  | {
      id: number;
      type: "finish";
      durationMs: number;
      videoWidth: number;
      videoHeight: number;
    }
  | {
      id: number;
      type: "close";
    };

export type PoseWorkerResponse =
  | {
      id: number;
      result:
        | { type: "initialized"; initializationMs: number }
        | { type: "progress"; processedFrames: number; inferenceMs: number }
        | { type: "finished"; measurement: PoseMeasurementResult }
        | { type: "closed" };
    }
  | {
      id: number;
      error: {
        code: PoseFailureCode;
        message: string;
      };
    };
