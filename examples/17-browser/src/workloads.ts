import { beacon, broadcast, signal, sleepOrAbort, z } from "station-browser";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const textInput = z.object({ text: z.string().min(1), failBranch: z.boolean().default(false) });
const prepare = signal("prepare-text").input(textInput).output(textInput).timeout(4_000).retries(3)
  .run(async (input) => { await wait(600); return { ...input, text: input.text.trim() }; });
const words = signal("count-words").input(textInput).output(z.object({ words: z.number() })).timeout(4_000).retries(3)
  .run(async ({ text }) => { await wait(1_200); return { words: text.split(/\s+/).length }; });
const characters = signal("count-characters").input(textInput).output(z.object({ characters: z.number() })).timeout(4_000).retries(1)
  .run(async ({ text, failBranch }) => {
    await wait(1_200);
    if (failBranch) throw new Error("Intentional branch failure: the word count can still finish");
    return { characters: text.length };
  });
const combinedSchema = z.object({ words: z.number(), characters: z.number() });
const combine = signal("combine-report").input(combinedSchema).output(combinedSchema).timeout(4_000).retries(3)
  .run(async (input) => { await wait(600); return input; });
const highlight = signal("long-text-highlight").input(combinedSchema).output(z.object({ message: z.string() })).timeout(4_000).retries(3)
  .run(async ({ words }) => { await wait(600); return { message: `${words} words: this text qualifies for a highlight.` }; });

export const analysis = broadcast("text-analysis").input(prepare)
  .then(words, characters)
  .then(combine, { map: (upstream) => ({ ...upstream[words.name] as object, ...upstream[characters.name] as object }) })
  .then(highlight, { when: (upstream) => (upstream[combine.name] as { words: number }).words >= 12 })
  .onFailure("skip-downstream").timeout(60_000).build();

export const pulse = beacon("local-pulse").manualStart().heartbeat(300, { timeout: 1_500 })
  .stopTimeout(500).poll(300, (ctx) => {
    ctx.heartbeat();
    ctx.log(`Pulse · incarnation ${ctx.incarnation} · ${new Date().toLocaleTimeString()}`);
  });

export const recovering = beacon("recovering-client").manualStart()
  .heartbeat(300, { timeout: 1_500 }).startupTimeout(1_000).stopTimeout(500)
  .backoff(600, { max: 3_000 }).restart("on-failure")
  .run(async (ctx) => {
    ctx.ready();
    let ticks = 0;
    while (!ctx.signal.aborted) {
      ctx.heartbeat();
      ctx.log(`Client connected · incarnation ${ctx.incarnation} · tick ${++ticks}`);
      if (ctx.incarnation === 1 && ticks === 3) throw new Error("Simulated disconnect; supervisor will restart this client");
      await sleepOrAbort(300, ctx.signal);
    }
  });

export const broadcasts = [analysis];
export const beacons = [pulse, recovering];
