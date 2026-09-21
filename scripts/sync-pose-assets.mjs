import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const expectedVersion = "1.0.1";
const packageRoot = resolve("node_modules/@mediapipe/tasks-vision");
const packageJson = JSON.parse(
  await readFile(resolve(packageRoot, "package.json"), "utf8"),
);

if (packageJson.version !== expectedVersion) {
  throw new Error(
    `Expected @mediapipe/tasks-vision ${expectedVersion}, received ${packageJson.version}.`,
  );
}

const outputRoot = resolve(
  `public/pose-assets/tasks-vision-${expectedVersion}`,
);
const assets = [
  "vision_bundle.mjs",
  "wasm/vision_wasm_internal.js",
  "wasm/vision_wasm_internal.wasm",
  "wasm/vision_wasm_nosimd_internal.js",
  "wasm/vision_wasm_nosimd_internal.wasm",
];

await rm(outputRoot, { recursive: true, force: true });
for (const asset of assets) {
  const output = resolve(outputRoot, asset);
  await mkdir(dirname(output), { recursive: true });
  await copyFile(resolve(packageRoot, asset), output);
}

console.log(
  `Synced ${assets.length} MediaPipe assets for tasks-vision ${expectedVersion}.`,
);
