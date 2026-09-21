import { chromium } from "@playwright/test";
import { resolve } from "node:path";

const origin = "http://localhost:3000";
const suffix = Date.now();
const email = `pose-diag-${suffix}@example.com`;
const password = "PoseDiag123!";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.addInitScript({
    content: `
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(...args) {
          super(...args);
          this.addEventListener("message", (event) => {
            if (event.data && event.data.error) {
              console.error("POSE_WORKER_RESPONSE:" + JSON.stringify(event.data));
            }
          });
          this.addEventListener("error", (event) => {
            console.error("POSE_WORKER_EVENT:" + event.message + ":" + event.filename + ":" + event.lineno);
          });
        }
      };
    `,
  });
  page.on("console", (message) => console.log(`console:${message.type()}:${message.text()}`));
  page.on("pageerror", (error) => console.log(`pageerror:${error.message}`));
  page.on("requestfailed", (request) => {
    if (!request.url().includes("?_rsc=")) {
      console.log(`requestfailed:${request.url()}:${request.failure()?.errorText}`);
    }
  });
  page.on("response", (response) => {
    const url = response.url();
    if (
      url.includes("pose-landmarker") ||
      url.includes("turbopack-worker") ||
      url.includes("mediapipe") ||
      url.includes("vision_bundle")
    ) {
      console.log(`response:${response.status()}:${url}`);
    }
  });

  await page.goto(`${origin}/register`);
  await page.locator("#name").fill("Pose Diagnostic");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.locator("#passwordConfirmation").fill(password);
  await page.getByRole("button", { name: "アカウントを作成" }).click();
  await page.waitForURL(`${origin}/`);

  await page.goto(`${origin}/profile`);
  await page.getByRole("button", { name: /Regular/ }).click();
  await page.getByRole("button", { name: "保存する" }).click();
  await page.getByText("プロフィールを保存しました。").waitFor();

  await page.goto(`${origin}/videos/new`);
  await page.locator("#cameraAngle").selectOption("SIDE");
  await page.locator("#userOutcome").selectOption("LANDED");
  await page.locator("#videoSpeed").selectOption("SLOW_MOTION");
  await page.locator("#video").setInputFiles(resolve("eval/input/kickflip_10.mp4"));
  await page.getByText(/フォーム計測を完了できませんでした|フォーム計測が完了しました|フォームを十分に計測できませんでした/).waitFor({
    timeout: 30_000,
  });
  const poseRequestPromise = page.waitForRequest(
    (request) =>
      request.url() === `${origin}/api/pose-measurements` &&
      request.method() === "POST",
    { timeout: 120_000 },
  );
  const poseResponsePromise = page.waitForResponse(
    (response) => response.url() === `${origin}/api/pose-measurements`,
    { timeout: 120_000 },
  );
  await page.getByRole("button", { name: "S3へ動画をアップロード" }).click();
  await page.getByText(/アップロードが完了し、AI分析を開始しました/).waitFor({
    timeout: 120_000,
  });
  const poseRequest = await poseRequestPromise;
  const poseResponse = await poseResponsePromise;
  const poseRequestBody = poseRequest.postDataJSON();
  const poseResponseBody = await poseResponse.json();
  await page.getByRole("button", { name: /結果画面へ進む/ }).click();
  await page.waitForURL(/\/history\/[0-9a-f-]+$/);
  await page.getByText("AI総評").waitFor({ timeout: 180_000 });
  console.log(`email:${email}`);
  console.log(`history-url:${page.url()}`);
  console.log(`pose-request:${JSON.stringify(poseRequestBody)}`);
  console.log(`pose-response:${poseResponse.status()}:${JSON.stringify(poseResponseBody)}`);
  console.log(`analysis:COMPLETED`);
  await browser.close();
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
