import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("./pose-video-player",()=>({default:({savedStatus}:{savedStatus:string})=><div data-player={savedStatus}/> }));
import { HistoryVideoPlayback } from "./history-video-playback";
const base={video:{id:"video",status:"READY",originalFilename:"clip.mp4"},playbackUrl:"https://example.invalid/owned",playbackUrlFailed:false,savedStatus:"COMPLETED" as const,userId:"owner",env:{}};
const html=(props:Partial<Parameters<typeof HistoryVideoPlayback>[0]>={})=>renderToStaticMarkup(<HistoryVideoPlayback {...base} {...props}/>);
const enabled={POSE_VIEWER_ENABLED:"true",POSE_VIEWER_USER_IDS:"owner"};
describe("actual history playback server boundary",()=>{
  it("OFF and excluded users retain identical native playback markup without product UI",()=>{
    const before=html();expect(before).toContain('<video');expect(before).not.toContain('data-player');
    expect(html({env:{...enabled,POSE_VIEWER_USER_IDS:"another"}})).toBe(before);
    expect(html({env:{...enabled,POSE_VIEWER_ENABLED:"false"}})).toBe(before);
  });
  it.each(["COMPLETED","UNASSESSABLE","FAILED","TIMED_OUT","CANCELED","MISSING"] as const)("forwards saved %s without changing saved state",savedStatus=>{
    expect(html({savedStatus,env:enabled})).toContain(`data-player="${savedStatus}"`);
  });
  it.each(["PENDING_UPLOAD","FAILED"])("unplayable %s has no overlay entry",status=>{
    const output=html({env:enabled,video:{...base.video,status},playbackUrl:null});expect(output).not.toContain('data-player');expect(output).not.toContain('<video');
  });
  it("deleted/missing and signing failures retain their existing explanations",()=>{
    expect(html({env:enabled,video:null,playbackUrl:null})).toContain("この練習に動画はありません");
    expect(html({env:enabled,playbackUrl:null,playbackUrlFailed:true})).toContain("動画を読み込めませんでした");
  });
});
