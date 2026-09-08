import { signal, z } from "station-browser";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const report = signal("local-report")
  .input(z.object({ text: z.string().min(1) }))
  .timeout(6_000).retries(3)
  .step("Read text", async ({ text }) => {
    await delay(1_200);
    return { text, words: text.trim().split(/\s+/).length };
  })
  .step("Count characters", async (data) => {
    await delay(1_200);
    return { ...data, characters: data.text.length };
  })
  .step("Build report", async ({ words, characters }) => {
    await delay(1_200);
    return { words, characters, readingSeconds: Math.max(1, Math.ceil(words / 200 * 60)) };
  }).build();

// The first step's saved timestamp makes the retry deterministic across worker restarts.
export const retryDemo = signal("retry-demo")
  .input(z.object({})).timeout(2_000).retries(4)
  .step("Save checkpoint", async () => ({ readyAt: Date.now() + 1_000 }))
  .step("Wait for resource", async ({ readyAt }) => {
    if (Date.now() < readyAt) throw new Error("Resource is warming up; retrying from the checkpoint");
    return { message: "Recovered from a temporary failure", checkpointReused: true };
  }).build();

export const signals = [report, retryDemo];
export const database = "station-browser-demo-v1";
