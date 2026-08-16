import { describe, expect, it, vi } from "vitest";

import {
  DirectUploadError,
  uploadVideoDirectlyToS3,
} from "./browser-direct-upload";

function createMockRequest() {
  let progressListener: (event: {
    lengthComputable: boolean;
    loaded: number;
    total: number;
  }) => void = () => {};
  const eventListeners = {
    load: () => {},
    error: () => {},
    abort: () => {},
  };
  const request = {
    status: 0,
    upload: {
      addEventListener(
        _event: "progress",
        listener: typeof progressListener,
      ) {
        progressListener = listener;
      },
    },
    open: vi.fn(),
    addEventListener(
      event: "load" | "error" | "abort",
      listener: () => void,
    ) {
      eventListeners[event] = listener;
    },
    send: vi.fn(),
  };

  return {
    request,
    progress(event: Parameters<typeof progressListener>[0]) {
      progressListener(event);
    },
    dispatch(event: keyof typeof eventListeners) {
      eventListeners[event]();
    },
  };
}

describe("browser direct upload", () => {
  it("posts every signed field and reports progress without a network call", async () => {
    const mock = createMockRequest();
    const progress = vi.fn();
    const file = new File(["video-bytes"], "practice.mp4", {
      type: "video/mp4",
    });
    const upload = uploadVideoDirectlyToS3({
      url: "https://bucket.s3.example.com",
      fields: {
        key: "private/user/session/video/original.mp4",
        "Content-Type": "video/mp4",
        Policy: "signed-policy",
      },
      file,
      onProgress: progress,
      createRequest: () => mock.request,
    });

    expect(mock.request.open).toHaveBeenCalledWith(
      "POST",
      "https://bucket.s3.example.com",
    );
    const body = mock.request.send.mock.calls[0]?.[0] as FormData;
    expect([...body.keys()]).toEqual([
      "key",
      "Content-Type",
      "Policy",
      "file",
    ]);
    expect(body.get("file")).toBe(file);

    mock.progress({ lengthComputable: true, loaded: 25, total: 100 });
    expect(progress).toHaveBeenLastCalledWith(25);

    mock.request.status = 204;
    mock.dispatch("load");
    await expect(upload).resolves.toBeUndefined();
    expect(progress).toHaveBeenLastCalledWith(100);
  });

  it("surfaces only the S3 status when a signed policy is rejected", async () => {
    const mock = createMockRequest();
    const upload = uploadVideoDirectlyToS3({
      url: "https://bucket.s3.example.com",
      fields: {},
      file: new File(["video-bytes"], "practice.mp4"),
      onProgress: vi.fn(),
      createRequest: () => mock.request,
    });

    mock.request.status = 403;
    mock.dispatch("load");

    await expect(upload).rejects.toMatchObject({
      name: "DirectUploadError",
      status: 403,
    } satisfies Partial<DirectUploadError>);
  });
});
