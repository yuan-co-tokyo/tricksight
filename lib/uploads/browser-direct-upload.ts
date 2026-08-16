type UploadProgress = {
  lengthComputable: boolean;
  loaded: number;
  total: number;
};

type BrowserUploadRequest = {
  status: number;
  upload: {
    addEventListener(
      event: "progress",
      listener: (progress: UploadProgress) => void,
    ): void;
  };
  open(method: "POST", url: string): void;
  addEventListener(
    event: "load" | "error" | "abort",
    listener: () => void,
  ): void;
  send(body: FormData): void;
};

export class DirectUploadError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "DirectUploadError";
    this.status = status;
  }
}

export function uploadVideoDirectlyToS3(input: {
  url: string;
  fields: Record<string, string>;
  file: File;
  onProgress(progressPercent: number): void;
  createRequest?: () => BrowserUploadRequest;
}) {
  const createRequest =
    input.createRequest ?? (() => new XMLHttpRequest() as BrowserUploadRequest);

  return new Promise<void>((resolve, reject) => {
    const request = createRequest();
    const formData = new FormData();

    for (const [name, value] of Object.entries(input.fields)) {
      formData.append(name, value);
    }

    // S3 POSTではファイルを最後のフォームフィールドにする。
    formData.append("file", input.file);

    request.open("POST", input.url);
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable || event.total <= 0) return;

      input.onProgress(
        Math.min(99, Math.round((event.loaded / event.total) * 100)),
      );
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        input.onProgress(100);
        resolve();
        return;
      }

      reject(
        new DirectUploadError(
          "S3 rejected the direct upload.",
          request.status,
        ),
      );
    });
    request.addEventListener("error", () => {
      reject(new DirectUploadError("The direct upload could not connect."));
    });
    request.addEventListener("abort", () => {
      reject(new DirectUploadError("The direct upload was aborted."));
    });
    request.send(formData);
  });
}
