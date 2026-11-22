import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, pcmHeader } from "./audio.js";
import { ppq } from "./midi.js";
import { runProgram } from "./program.js";
import { composeScore, scoreMidi, stemNames, type Style } from "./score.js";

const worker = fileURLToPath(new URL("./score-worker.js", import.meta.url));
const rate = 48000;

async function master(dir: string, frames: number, target: number, signal: AbortSignal) {
  const ffmpeg = (args: string[]) => runProgram("ffmpeg", ["-nostdin", "-hide_banner", "-nostats", ...args], signal, dir);
  const source = ["-f", "f32le", "-ar", String(rate), "-ac", "2", "-i", "mix.f32"];
  const filter = "loudnorm=I=" + target + ":TP=-1.5:LRA=11";
  async function measure(input: string[]) {
    const { stderr } = await ffmpeg([...input, "-af", filter + ":print_format=json", "-f", "null", "-"]);
    const match = stderr.match(/\{[^{}]*"input_i"[^{}]*\}/);
    if (!match) throw new Error("FFmpeg did not return a loudness measurement");
    const data = JSON.parse(match[0]);
    const values = [data.input_i, data.input_tp, data.input_lra, data.input_thresh, data.target_offset].map(Number);
    if (!values.every(Number.isFinite)) throw new Error("Non-finite loudness measurement");
    const [integrated, peak, range, threshold, offset] = values;
    return { integrated, peak, range, threshold, offset };
  }

  const input = await measure(source);
  const settings = filter + ":measured_I=" + input.integrated + ":measured_TP=" + input.peak +
    ":measured_LRA=" + input.range + ":measured_thresh=" + input.threshold + ":offset=" + input.offset + ":linear=true";
  // Loudnorm may oversample internally. Fix the delivery rate and bar-aligned frame count afterwards.
  await ffmpeg([...source, "-af", settings + ",aresample=48000,apad=whole_len=" + frames + ",atrim=end_sample=" + frames,
    "-c:a", "pcm_s24le", "-f", "s24le", "master.pcm"]);
  const pcm = await readFile(join(dir, "master.pcm"));
  if (pcm.length !== frames * 6) throw new Error("Master frame count differs from the score");
  const wav = Buffer.concat([pcmHeader(frames, rate, 2, 24), pcm]);
  const analysis = analyze(wav);
  await writeFile(join(dir, "master.wav"), wav, { mode: 0o600 });
  const output = await measure(["-i", "master.wav"]);
  if (analysis.silent || Math.abs(output.integrated - target) > 1 || output.peak > -1) {
    throw new Error("Master outside delivery limits: " + output.integrated + " LUFS, " + output.peak + " dBTP");
  }
  return { ...analysis, bit_depth: 24, target_lufs: target, integrated_lufs: output.integrated, true_peak_dbtp: output.peak };
}

export type MusicRequest = { style: Style; bars: number; seed: number; bpm?: number; include_stems: boolean };

export async function produceMusic(root: string, request: MusicRequest, signal: AbortSignal) {
  const { style, bars, seed, include_stems } = request;
  const bpm = request.bpm ?? (style === "night_drive" ? 112 : 86);
  const score = composeScore(style, bars, seed, bpm);
  const frames = Math.round(score.ticks / ppq * score.tempo * rate / 1e6);
  const dir = await mkdtemp(join(root, ".produce-"));
  const published: string[] = [];
  try {
    await writeFile(join(dir, "score.json"), JSON.stringify(score), { mode: 0o600 });
    await writeFile(join(dir, "score.mid"), scoreMidi(score), { mode: 0o600 });
    await runProgram(process.execPath, [worker, dir, include_stems ? "stems" : "mix"], signal, dir);
    const validation = await master(dir, frames, style === "night_drive" ? -14 : -16, signal);
    const roles = include_stems ? ["master", "score", ...stemNames] : ["master", "score"];
    const assets = [];
    for (const role of roles) {
      signal.throwIfAborted();
      const extension = role === "score" ? ".mid" : ".wav";
      const asset_id = randomUUID();
      const path = join(root, asset_id + extension);
      await rename(join(dir, role + extension), path);
      published.push(path);
      assets.push({ role, asset_id, path, type: role === "score" ? "midi" : "wav" });
    }
    signal.throwIfAborted();
    return { status: "completed", style, bars, bpm, seed, sections: score.sections, assets, validation };
  } catch (error) {
    await Promise.all(published.map(path => rm(path, { force: true })));
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
