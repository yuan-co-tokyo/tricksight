import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({ user:vi.fn(),session:vi.fn(),sign:vi.fn() }));
vi.mock("../current-user",()=>({getCurrentUser:mocks.user}));
vi.mock("../db/queries",()=>({getPracticeSessionDetail:mocks.session}));
vi.mock("../uploads/video-playback-url",()=>({createOwnedVideoPlaybackUrl:mocks.sign}));
vi.mock("next/navigation",()=>({notFound:()=>{throw new Error("NOT_FOUND");}}));
vi.mock("../../app/diagnostics/pose-display/[sessionId]/diagnostic-loader",()=>({default:()=>React.createElement("div",{"data-test":"diagnostic-mounted"})}));
import Page from "../../app/diagnostics/pose-display/[sessionId]/page";
import Identity from "../../app/diagnostics/identity/page";
import { PoseDisplayDiagnosticLink } from "./pose-display-link";
const sessionId="00000000-0000-4000-8000-000000000001";
const params=Promise.resolve({sessionId});
function enable(){vi.stubEnv("POSE_DISPLAY_DIAGNOSTIC_ENABLED","true");vi.stubEnv("POSE_DISPLAY_DIAGNOSTIC_USER_IDS","tester");mocks.user.mockResolvedValue({id:"tester"});mocks.session.mockResolvedValue({video:{status:"READY",s3Key:"private"}});mocks.sign.mockResolvedValue("https://private.invalid/signed");}
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
describe("actual diagnostic pages and history link",()=>{
  it("OFF direct route and link cannot render client/initialize Worker or sign",async()=>{
    vi.stubEnv("POSE_DISPLAY_DIAGNOSTIC_ENABLED",undefined);
    await expect(Page({params})).rejects.toThrow("NOT_FOUND");expect(mocks.user).not.toHaveBeenCalled();expect(mocks.sign).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(<PoseDisplayDiagnosticLink env={{}} userId="tester" sessionId={sessionId}/>)).toBe("");
    await expect(Identity()).rejects.toThrow("NOT_FOUND");
  });
  it.each([null,{id:"other"}])("ON rejects missing/excluded user at actual page",async user=>{
    enable();mocks.user.mockResolvedValue(user);await expect(Page({params})).rejects.toThrow("NOT_FOUND");expect(mocks.session).not.toHaveBeenCalled();expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("other-owner query miss is 404 without signing",async()=>{enable();mocks.session.mockResolvedValue(null);await expect(Page({params})).rejects.toThrow("NOT_FOUND");expect(mocks.session).toHaveBeenCalledWith("tester",sessionId);expect(mocks.sign).not.toHaveBeenCalled();});
  it("authorized owner renders client and non-prefetching link",async()=>{
    enable();expect(renderToStaticMarkup(await Page({params}))).toContain("diagnostic-mounted");
    const link=PoseDisplayDiagnosticLink({env:process.env,userId:"tester",sessionId});expect(link?.props.prefetch).toBe(false);
  });
  it("identity is self only and still requires authentication",async()=>{
    enable();mocks.user.mockResolvedValue(null);await expect(Identity()).rejects.toThrow("NOT_FOUND");mocks.user.mockResolvedValue({id:"self-only-id"});const html=renderToStaticMarkup(await Identity());expect(html).toContain("self-only-id");expect(mocks.session).not.toHaveBeenCalled();expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("signing failure never renders URL or diagnostic client",async()=>{enable();mocks.sign.mockRejectedValue(new Error("private URL"));const html=renderToStaticMarkup(await Page({params}));expect(html).not.toContain("private URL");expect(html).not.toContain("diagnostic-mounted");});
});
