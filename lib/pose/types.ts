export type PoseQualityReason =
  | "POSE_COVERAGE_BELOW_THRESHOLD"
  | "LOWER_BODY_COVERAGE_BELOW_THRESHOLD";

export type PoseMeasurementMetrics = {
  minimumMeanKneeAngleDeg: number | null;
  /**
   * Collected because T11-1 found a distribution difference. It is persisted
   * for later evaluation, while the first MVP UI deliberately stays at two
   * displayed metrics.
   */
  kneeExtensionRangeDeg: number | null;
  hipVerticalRangeTorsoUnits: number | null;
  /**
   * Collected for future evaluation and persistence, but intentionally hidden
   * from the MVP UI because T11-1 did not establish a user-explainable
   * interpretation and the observed direction contradicted the hypothesis.
   */
  landingTrunkTiltDeg: number | null;
};

export type PoseMeasurementMetadata = {
  algorithmVersion: string;
  tasksVisionVersion: string;
  modelName: string;
  modelSha256: string;
  sampleRateFps: number;
  delegate: "CPU";
};

export type PoseMeasurementQuality = {
  frameCount: number;
  poseFrameCount: number;
  lowerBodyFrameCount: number;
  poseCoverage: number | null;
  lowerBodyCoverage: number | null;
  reasons: PoseQualityReason[];
};

type PoseMeasurementBase = {
  metadata: PoseMeasurementMetadata;
  processingDurationMs: number | null;
};

export type PoseMeasurementResult =
  | (PoseMeasurementBase & {
      status: "COMPLETED";
      quality: PoseMeasurementQuality;
      metrics: PoseMeasurementMetrics;
    })
  | (PoseMeasurementBase & {
      status: "UNASSESSABLE";
      quality: PoseMeasurementQuality;
      metrics: null;
    })
  | (PoseMeasurementBase & {
      status: "FAILED";
      quality: null;
      metrics: null;
      errorCode: string;
    })
  | (PoseMeasurementBase & {
      status: "TIMED_OUT" | "CANCELED";
      quality: null;
      metrics: null;
    });

export type PoseAnalysisProgress = {
  phase: "INITIALIZING" | "PROCESSING" | "FINALIZING";
  processedFrames: number;
  totalFrames: number;
  percent: number;
};

export type PoseAnalysisTask = {
  result: Promise<PoseMeasurementResult>;
  cancel(): void;
};
