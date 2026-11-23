import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseMidi } from "midi-file";
import { analyze } from "../dist/audio.js";
import { masterMusicMix, produceMusic } from "../dist/produce.js";
import { runProgram } from "../dist/program.js";
import { stemNames } from "../dist/score.js";

const sampleRate = 48_000;
const bpm = 128;
const framesPerBar = sampleRate * 4 * 60 / bpm;
const cutBars = [[5, 8], [11, 12], [15, 16]];
const weights = { drums: 0.75, bass: 0.85, keys: 0.50 };
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

function cutdownFilter() {
  // Borrow 5 ms of the incoming bar's pre-roll for each splice. The incoming
  // downbeat stays on its original sample and the last bar keeps its full tail.
  const blend = 240;
  const filters = ["amix=inputs=4:normalize=0,asplit=3[source0][source1][source2]"];
  for (const [i, [first, last]] of cutBars.entries()) {
    const start = (first - 1) * framesPerBar - (i === 0 ? 0 : blend);
    const end = last * framesPerBar;
    const entrance = i === 0 ? ",afade=t=in:ss=0:ns=96" : "";
    filters.push(`[source${i}]atrim=start_sample=${start}:end_sample=${end},asetpts=PTS-STARTPTS${entrance}[part${i}]`);
  }
  const splice = "acrossfade=ns=" + blend + ":c1=tri:c2=tri";
  filters.push(`[part0][part1]${splice}[joined]`, `[joined][part2]${splice}[out]`);
  return filters.join(";");
}

async function mixVariant(scratch, stems, filter, seconds, target, signal) {
  const inputs = stems.flatMap(path => ["-i", path]);
  await runProgram("ffmpeg", ["-nostdin", "-loglevel", "error", ...inputs,
    "-filter_complex_threads", "1", "-filter_complex", filter, "-map", "[out]",
    "-ar", String(sampleRate), "-ac", "2", "-f", "f32le", "mix.f32"], signal, scratch);
  const frames = seconds * sampleRate;
  if ((await stat(join(scratch, "mix.f32"))).size !== frames * 2 * 4) {
    throw new Error("Edited performance has an unexpected frame count");
  }
  return masterMusicMix(scratch, frames, target, signal);
}

async function makePack(destination, seed, signal) {
  const parent = dirname(destination);
  await mkdir(parent, { recursive: true });
  try {
    await lstat(destination);
    throw new Error("Choose a new output directory. Already exists: " + destination);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const work = await mkdtemp(join(parent, ".editor-pack-"));
  const pack = join(work, "pack");
  try {
    await mkdir(pack);
    const stemsDir = join(pack, "stems");
    await mkdir(stemsDir);
    const request = { style: "night_drive", bars: 16, seed, bpm, include_stems: true };
    const full = await produceMusic(work, request, signal);
    const files = [];
    for (const asset of full.assets) {
      const name = asset.role === "master" ? "main-30s.wav" :
        asset.role === "score" ? "score.mid" : `stems/${asset.role}.wav`;
      await rename(asset.path, join(pack, name));
      files.push({ name, role: asset.role });
    }
    const cut = join(work, "cutdown");
    const bed = join(work, "underscore");
    await mkdir(cut);
    await mkdir(bed);
    const stemPath = role => join(stemsDir, role + ".wav");
    const cutValidation = await mixVariant(cut, stemNames.map(stemPath), cutdownFilter(), 15, -14, signal);
    const bedFilter = `amix=inputs=3:normalize=0:weights='${Object.values(weights).join(" ")}'[out]`;
    const bedValidation = await mixVariant(bed, Object.keys(weights).map(stemPath), bedFilter, 30, -20, signal);
    await rename(join(cut, "master.wav"), join(pack, "cutdown-15s.wav"));
    await rename(join(bed, "master.wav"), join(pack, "underscore-30s.wav"));
    files.push({ name: "cutdown-15s.wav", role: "cutdown" }, { name: "underscore-30s.wav", role: "underscore" });

    const levels = { master: full.validation, cutdown: cutValidation, underscore: bedValidation };
    for (const file of files) {
      const bytes = await readFile(join(pack, file.name));
      file.sha256 = sha256(bytes);
      if (file.role === "score") {
        const midi = parseMidi(bytes);
        const names = midi.tracks.slice(1).map(track => track[0].text);
        const ticks = midi.tracks[0].reduce((sum, event) => sum + event.deltaTime, 0);
        if (names.join(",") !== stemNames.join(",") || ticks !== 64 * midi.header.ticksPerBeat) {
          throw new Error("Unexpected score tracks or duration");
        }
        file.tracks = names;
        continue;
      }
      const analysis = analyze(bytes);
      const expected = file.role === "cutdown" ? 15 : 30;
      if (analysis.silent || analysis.duration_seconds !== expected || analysis.channels !== 2 ||
          analysis.sample_rate_hz !== sampleRate || bytes.readUInt16LE(34) !== 24) {
        throw new Error("Invalid delivery WAV: " + file.name);
      }
      file.frames = expected * sampleRate;
      if (levels[file.role]) {
        const { integrated_lufs, target_lufs, true_peak_dbtp } = levels[file.role];
        Object.assign(file, { integrated_lufs, target_lufs, true_peak_dbtp });
      }
    }

    // Binary hashes identify the actual build, including local changes outside Git.
    const build = {};
    for (const file of ["audio", "midi", "score", "score-worker", "acoustic-drums", "sample-bank", "produce", "program"]) {
      build[file] = sha256(await readFile(new URL(`../dist/${file}.js`, import.meta.url)));
    }
    const ffmpeg = await runProgram("ffmpeg", ["-version"], signal);
    const manifest = {
      format_version: 1, request, sample_rate_hz: sampleRate, bit_depth: 24, channels: 2,
      stems: "Pre-master. Import all four main-mix stems at sample zero.",
      cutdown_source_bars: cutBars, underscore_stem_gains: { ...weights, lead: 0 },
      sync_seconds: {
        main: { theme: 7.5, reveal: 15, logo: 28.125, end: 30 },
        cutdown: { theme: 0, reveal: 7.5, logo: 13.125, end: 15 },
      },
      build: { node: process.version, platform: process.platform, arch: process.arch,
        ffmpeg: ffmpeg.stdout.split("\n")[0], ffmpeg_build_sha256: sha256(ffmpeg.stdout),
        package_lock_sha256: sha256(await readFile(new URL("../package-lock.json", import.meta.url))),
        script_sha256: sha256(await readFile(new URL(import.meta.url))), module_sha256: build },
      files,
    };
    await writeFile(join(pack, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    signal.throwIfAborted();
    await rename(pack, destination);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

const [output, seedText = "42", ...extra] = process.argv.slice(2);
if (!output || output === "--help" || extra.length || !/^\d+$/.test(seedText) || Number(seedText) > 0xffffffff) {
  console.error("Usage: node scripts/render-editor-pack.mjs <new-output-directory> [seed 0..4294967295]");
  process.exitCode = output === "--help" ? 0 : 2;
} else {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    await makePack(resolve(output), Number(seedText), controller.signal);
    console.log(resolve(output));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }
}
