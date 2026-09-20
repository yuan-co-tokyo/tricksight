import {
  GetObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";

import { createAwsClientConfig } from "../aws/client-config";

import { VideoAnalysisError } from "./provider";

export type BedrockVideoFormat = "mp4" | "mov";

export type VideoFormatResolver = {
  resolve(bucket: string, key: string): Promise<BedrockVideoFormat>;
};

const VIDEO_HEADER_RANGE = "bytes=0-4095";
const VIDEO_HEADER_TIMEOUT_MS = 10_000;
const QUICKTIME_MAJOR_BRAND = "qt  ";
const MP4_MAJOR_BRANDS = new Set([
  "isom",
  "iso2",
  "iso3",
  "iso4",
  "iso5",
  "iso6",
  "iso7",
  "iso8",
  "iso9",
  "mp41",
  "mp42",
  "avc1",
  "M4V ",
  "M4A ",
  "F4V ",
  "dash",
  "MSNV",
]);

type S3VideoHeaderClient = {
  send(
    command: GetObjectCommand,
    options?: { abortSignal?: AbortSignal },
  ): Promise<Pick<GetObjectCommandOutput, "Body">>;
};

function readUint32(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset]! * 0x1000000 +
    bytes[offset + 1]! * 0x10000 +
    bytes[offset + 2]! * 0x100 +
    bytes[offset + 3]!
  );
}

function readAscii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function findFtypMajorBrand(bytes: Uint8Array): string | undefined {
  let offset = 0;

  while (offset + 8 <= bytes.length) {
    const boxSize = readUint32(bytes, offset);
    const boxType = readAscii(bytes, offset + 4, 4);
    const headerSize = boxSize === 1 ? 16 : 8;

    if (boxType === "ftyp") {
      const majorBrandOffset = offset + headerSize;
      if (majorBrandOffset + 4 > bytes.length) return undefined;
      return readAscii(bytes, majorBrandOffset, 4);
    }

    if (boxSize === 0 || boxSize < headerSize) return undefined;
    if (boxSize === 1) {
      // ftypより前に64bitサイズのboxがある入力は、先頭4KiBだけでは
      // 安全に次の位置を計算できないため判定不能とする。
      return undefined;
    }

    offset += boxSize;
  }

  return undefined;
}

export function detectIsoBmffVideoFormat(
  bytes: Uint8Array,
): BedrockVideoFormat {
  const majorBrand = findFtypMajorBrand(bytes);

  if (!majorBrand) {
    throw new VideoAnalysisError(
      "UNSUPPORTED_VIDEO_FORMAT",
      "動画の先頭からISO BMFFのftypボックスを検出できませんでした。",
    );
  }
  if (majorBrand === QUICKTIME_MAJOR_BRAND) return "mov";
  if (MP4_MAJOR_BRANDS.has(majorBrand)) return "mp4";

  throw new VideoAnalysisError(
    "UNSUPPORTED_VIDEO_FORMAT",
    `未対応のISO BMFF major brandです: ${JSON.stringify(majorBrand)}`,
  );
}

export class S3VideoFormatResolver implements VideoFormatResolver {
  private readonly client: S3VideoHeaderClient;
  private readonly awsAccountId: string;

  constructor(
    config: { awsRegion: string; awsAccountId: string },
    dependencies: { client?: S3VideoHeaderClient } = {},
  ) {
    this.awsAccountId = config.awsAccountId;
    this.client =
      dependencies.client ??
      new S3Client(createAwsClientConfig({ region: config.awsRegion }));
  }

  async resolve(bucket: string, key: string): Promise<BedrockVideoFormat> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          Range: VIDEO_HEADER_RANGE,
          ExpectedBucketOwner: this.awsAccountId,
        }),
        { abortSignal: AbortSignal.timeout(VIDEO_HEADER_TIMEOUT_MS) },
      );
      if (!response.Body) {
        throw new Error("S3 GetObject response body is missing.");
      }

      return detectIsoBmffVideoFormat(
        await response.Body.transformToByteArray(),
      );
    } catch (cause) {
      if (cause instanceof VideoAnalysisError) throw cause;

      throw new VideoAnalysisError(
        "VIDEO_FORMAT_READ_FAILED",
        "動画の実ファイル形式をS3から判定できませんでした。",
        { cause },
      );
    }
  }
}
