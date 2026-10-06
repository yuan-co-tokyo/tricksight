import { describe, it, expect, vi } from "vitest";
import { canUsePoseDisplayDiagnostic, resolvePoseDisplayDiagnostic } from "./pose-display-gate";
const sessionId = "00000000-0000-4000-8000-000000000001";
const env = { POSE_DISPLAY_DIAGNOSTIC_ENABLED: "true", POSE_DISPLAY_DIAGNOSTIC_USER_IDS: "tester" };
function dependencies() {
  return { env, sessionId, getUser: vi.fn().mockResolvedValue({ id: "tester" }),
    getSession: vi.fn().mockResolvedValue({ video: { status: "READY", s3Key: "private" } }),
    sign: vi.fn().mockResolvedValue("https://private.invalid/signed") };
}
describe("diagnostic authorization before signing/client mount", () => {
  it.each([undefined,"false","TRUE","1",""])("fails closed for flag %s", async flag => {
    const d = dependencies();d.env={ ...env, POSE_DISPLAY_DIAGNOSTIC_ENABLED: flag as string };
    expect(await resolvePoseDisplayDiagnostic(d)).toEqual({kind:"denied"});
    expect(d.getUser).not.toHaveBeenCalled();expect(d.getSession).not.toHaveBeenCalled();expect(d.sign).not.toHaveBeenCalled();
  });
  it.each([null,{id:"other"}])("rejects unauthenticated/excluded callers",async user=>{
    const d=dependencies();d.getUser.mockResolvedValue(user);
    expect(await resolvePoseDisplayDiagnostic(d)).toEqual({kind:"denied"});expect(d.getSession).not.toHaveBeenCalled();expect(d.sign).not.toHaveBeenCalled();
  });
  it("empty allowlist denies all; matching is exact",()=>{
    expect(canUsePoseDisplayDiagnostic({...env,POSE_DISPLAY_DIAGNOSTIC_USER_IDS:""},"tester")).toBe(false);
    expect(canUsePoseDisplayDiagnostic(env,"test")).toBe(false);
    expect(canUsePoseDisplayDiagnostic({...env,POSE_DISPLAY_DIAGNOSTIC_USER_IDS:" tester , second "},"tester")).toBe(true);
  });
  it.each([null,{video:null},{video:{status:"FAILED",s3Key:"private"}},{video:{status:"PENDING_UPLOAD",s3Key:"private"}}])("never signs missing/other-owner/unplayable session",async session=>{
    const d=dependencies();d.getSession.mockResolvedValue(session);
    expect(await resolvePoseDisplayDiagnostic(d)).toEqual({kind:"denied"});expect(d.getSession).toHaveBeenCalledWith("tester",sessionId);expect(d.sign).not.toHaveBeenCalled();
  });
  it("rejects invalid identifiers before queries",async()=>{
    const d=dependencies();d.sessionId="arbitrary-s3-key";expect(await resolvePoseDisplayDiagnostic(d)).toEqual({kind:"denied"});expect(d.getSession).not.toHaveBeenCalled();
  });
  it("signs only the owner-scoped row",async()=>{
    const d=dependencies();expect((await resolvePoseDisplayDiagnostic(d)).kind).toBe("ready");expect(d.sign).toHaveBeenCalledWith(await d.getSession.mock.results[0].value);
  });
  it("redacts errors and does not log URLs",async()=>{
    const log=vi.spyOn(console,"error").mockImplementation(()=>{});const d=dependencies();d.sign.mockRejectedValue(new Error("https://private.invalid/?signature=secret"));
    expect(await resolvePoseDisplayDiagnostic(d)).toEqual({kind:"unavailable"});expect(log).not.toHaveBeenCalled();log.mockRestore();
  });
});
