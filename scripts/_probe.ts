import { loadEnv } from "./loadEnv"; loadEnv();
import { mkdirSync, writeFileSync } from "node:fs";
const KEY = process.env.UNSPLASH_ACCESS_KEY!;
const DIR = "/private/tmp/claude-501/-Users-federicomencuccini-projects-app-ai-finder/988419fb-cf10-4065-aac1-83874a68cbf5/scratchpad/cand";
const IDS: Array<[string, string]> = [
  ["QHOp95V_zqQ", "s1"], ["VoTf3NtDQig", "s2"],
  ["bvHLQVnh3A4", "s3"], ["87luO7iL1mM", "s4"],
];
async function main() {
  mkdirSync(DIR, { recursive: true });
  for (const [id, label] of IDS) {
    const r = await fetch(`https://api.unsplash.com/photos/${id}`, { headers: { Authorization: `Client-ID ${KEY}` } });
    const p = (await r.json()) as {
      urls: { raw: string };
      width: number;
      height: number;
      user?: { name?: string };
      alt_description?: string | null;
    };
    const img = await fetch(`${p.urls.raw}&fm=jpg&q=85&w=1200&fit=max`);
    writeFileSync(`${DIR}/${label}.jpg`, Buffer.from(await img.arrayBuffer()));
    console.log(`${label} ${id}: ${p.width}x${p.height} · ${p.user?.name} · ${(p.alt_description||"").slice(0,46)}`);
  }
}
main().catch(e => { console.error(e.message); process.exit(1); });
