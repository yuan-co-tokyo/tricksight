import { describe, expect, it } from "vitest";
import { canUsePoseViewer, viewerOffer, viewerMessages, type SavedPoseStatus } from "./policy";
describe("server-only rollout and stored/display state separation", () => {
  it("defaults OFF and requires exact allowlist matches; public mode still requires a user", () => {
    expect(canUsePoseViewer({}, "owner")).toBe(false);
    expect(canUsePoseViewer({POSE_VIEWER_ENABLED:"TRUE",POSE_VIEWER_AUDIENCE:"all"},"owner")).toBe(false);
    expect(canUsePoseViewer({POSE_VIEWER_ENABLED:"true"},"owner")).toBe(false);
    const limited={POSE_VIEWER_ENABLED:"true",POSE_VIEWER_USER_IDS:" owner, other "};
    expect(canUsePoseViewer(limited,"owner")).toBe(true);expect(canUsePoseViewer(limited,"own")).toBe(false);
    expect(canUsePoseViewer({...limited,POSE_VIEWER_AUDIENCE:"wrong"},"owner")).toBe(false);
    expect(canUsePoseViewer({POSE_VIEWER_ENABLED:"true",POSE_VIEWER_AUDIENCE:"all"},"owner")).toBe(true);
    expect(canUsePoseViewer({POSE_VIEWER_ENABLED:"true",POSE_VIEWER_AUDIENCE:"all"},"")).toBe(false);
    expect(canUsePoseViewer({POSE_VIEWER_ENABLED:"false",POSE_VIEWER_AUDIENCE:"all"},"owner")).toBe(false);
  });
  it.each<SavedPoseStatus>(["COMPLETED","UNASSESSABLE","FAILED","TIMED_OUT","CANCELED","MISSING"])("stored %s permits optional replay processing only for a playable video", status => {
    expect(viewerOffer(true,status).available).toBe(true);expect(viewerOffer(false,status).available).toBe(false);
    expect(viewerOffer(true,status).label).toBe(status==="UNASSESSABLE"?"検出できた部分を見る":"骨格と数値を表示");
  });
  it("every display state has a user-facing explanation without status identifiers",()=>{
    for(const [key,description] of Object.entries(viewerMessages)) { expect(description.length).toBeGreaterThan(10);expect(description).not.toContain(key); }
  });
});
