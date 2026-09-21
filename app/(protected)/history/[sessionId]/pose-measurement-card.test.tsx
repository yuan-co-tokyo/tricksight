import { renderToStaticMarkup } from "react-dom/server";
import type { HTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";

import type { PoseHistoryComparisonState } from "../../../../lib/pose/history-comparison";

vi.mock("../../../../components/ui/button", () => ({
  buttonVariants: () => "button",
}));

vi.mock("../../../../components/ui/card", () => {
  function Element({
    children,
    ...props
  }: HTMLAttributes<HTMLDivElement>) {
    return <div {...props}>{children}</div>;
  }

  return {
    Card: Element,
    CardContent: Element,
    CardDescription: Element,
    CardHeader: Element,
    CardTitle: Element,
  };
});

import { PoseMeasurementCard } from "./pose-measurement-card";

function render(state: PoseHistoryComparisonState) {
  return renderToStaticMarkup(<PoseMeasurementCard state={state} />);
}

describe("PoseMeasurementCard", () => {
  it("shows current, previous, date link, and neutral deltas when comparable", () => {
    const html = render({
      kind: "comparison",
      current: {
        minimumMeanKneeAngleDeg: 84.8,
        hipVerticalRangeTorsoUnits: 0.54,
      },
      previous: {
        sessionId: "11111111-1111-4111-8111-111111111111",
        practicedAt: new Date("2026-09-20T03:00:00.000Z"),
        videoSpeed: "NORMAL",
        cameraAngle: "SIDE",
        algorithmVersion: "pose-v1",
        modelSha256: "model-sha",
        sampleRateFps: 10,
        delegate: "CPU",
        runtimeFamily: "CHROMIUM",
        minimumMeanKneeAngleDeg: 90,
        hipVerticalRangeTorsoUnits: 0.5,
      },
    });

    expect(html).toContain("膝の曲がり");
    expect(html).toContain("腰の上下動");
    expect(html).toContain("84.8°");
    expect(html).toContain("前回 90.0°");
    expect(html).toContain("5.2°深く曲がった");
    expect(html).toContain("上下動が0.04胴長大きくなった");
    expect(html).toContain(
      'href="/history/11111111-1111-4111-8111-111111111111"',
    );
    expect(html).toContain("絶対的な跳躍高ではありません");
    expect(html).not.toContain("膝伸展");
    expect(html).not.toContain("体幹傾斜");
  });

  it("shows a baseline and capture guidance only for a capture-condition mismatch", () => {
    const speedHtml = render({
      kind: "baseline",
      current: {
        minimumMeanKneeAngleDeg: 84.8,
        hipVerticalRangeTorsoUnits: 0.54,
      },
      reason: "VIDEO_SPEED",
      currentVideoSpeed: "SLOW_MOTION",
      currentCameraAngle: "SIDE",
    });
    const processHtml = render({
      kind: "baseline",
      current: {
        minimumMeanKneeAngleDeg: 84.8,
        hipVerticalRangeTorsoUnits: 0.54,
      },
      reason: "PROCESS_OR_RUNTIME",
      currentVideoSpeed: "SLOW_MOTION",
      currentCameraAngle: "SIDE",
    });

    expect(speedHtml).toContain("次回比較の基準値");
    expect(speedHtml).toContain("撮影速度が異なる");
    expect(speedHtml).toContain("スローモーション");
    expect(processHtml).toContain("処理版またはブラウザ系統");
    expect(processHtml).not.toContain("次回も撮影速度");
    expect(processHtml).not.toContain("次回も撮影方向");
  });

  it("keeps AI analysis as the primary action when measurement is unassessable", () => {
    const html = render({
      kind: "unassessable",
      status: "UNASSESSABLE",
      qualityReasons: ["POSE_COVERAGE_BELOW_THRESHOLD"],
    });

    expect(html).toContain("border-warning/40");
    expect(html).toContain("人物または足元を十分な時間検出できませんでした");
    expect(html).toContain("全身と足先を画角に入れ");
    expect(html).toContain('href="#ai-analysis"');
    expect(html).toContain("AI分析を見る");
    expect(html).toContain("別の動画で撮り直す（任意）");
    expect(html.indexOf("AI分析を見る")).toBeLessThan(
      html.indexOf("別の動画で撮り直す（任意）"),
    );
  });
});
