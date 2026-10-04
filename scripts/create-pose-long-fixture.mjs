// Local load fixture only: slow existing H.264 samples without re-encoding.
// It is not evidence of camera-original 20s / MOV / HEVC compatibility.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const input = resolve("eval/input/kickflip_10.mp4");
const output = resolve("eval/input/pose-long-19.99s.mp4");
const buffer = await readFile(input);

function boxes(start, end) {
  const result = [];
  for (let offset = start; offset < end;) {
    const size32 = buffer.readUInt32BE(offset);
    const size = size32 === 1
      ? Number(buffer.readBigUInt64BE(offset + 8))
      : size32 === 0 ? end - offset : size32;
    if (size < 8 || offset + size > end) throw new Error("Unsupported MP4 box size");
    result.push({ type: buffer.toString("ascii", offset + 4, offset + 8), offset, end: offset + size });
    offset += size;
  }
  return result;
}

function child(parent, type) {
  const box = boxes(parent.offset + 8, parent.end).find((entry) => entry.type === type);
  if (!box) throw new Error(`Missing ${type}`);
  return box;
}

function timing(box) {
  if (buffer[box.offset + 8] !== 0) throw new Error("Only version 0 timing is supported");
  return {
    timescaleOffset: box.offset + 20,
    timescale: buffer.readUInt32BE(box.offset + 20),
    duration: buffer.readUInt32BE(box.offset + 24),
  };
}

const moov = boxes(0, buffer.length).find((box) => box.type === "moov");
if (!moov) throw new Error("Missing moov");
const movie = timing(child(moov, "mvhd"));
const factor = 19.99 / (movie.duration / movie.timescale);
buffer.writeUInt32BE(Math.ceil(movie.timescale / factor), movie.timescaleOffset);
for (const track of boxes(moov.offset + 8, moov.end).filter((box) => box.type === "trak")) {
  const media = child(track, "mdia");
  const handler = child(media, "hdlr");
  const kind = buffer.toString("ascii", handler.offset + 16, handler.offset + 20);
  if (kind !== "vide") {
    // Keep box/data lengths and chunk offsets intact; discard audio track metadata.
    buffer.write("free", track.offset + 4, 4, "ascii");
    continue;
  }
  const video = timing(child(media, "mdhd"));
  buffer.writeUInt32BE(Math.ceil(video.timescale / factor), video.timescaleOffset);
}
await writeFile(output, buffer, { flag: "wx" });
console.log(JSON.stringify({
  input,
  output,
  durationSeconds: movie.duration / buffer.readUInt32BE(movie.timescaleOffset),
  bytes: buffer.length,
  sha256: createHash("sha256").update(buffer).digest("hex"),
}));
