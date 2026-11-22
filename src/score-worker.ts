import { readFile, writeFile } from "node:fs/promises";
import { endianness } from "node:os";
import { join } from "node:path";
import { pcmHeader } from "./audio.js";
import { ppq } from "./midi.js";
import { stemNames, type Note, type Score, type Stem } from "./score.js";

const rate = 48000;
const tableSize = 4096;
const sineTable = Float32Array.from({ length: tableSize }, (_, i) => Math.sin(2 * Math.PI * i / tableSize));
function sine(phase: number) {
  return sineTable[Math.floor(phase * tableSize) & (tableSize - 1)];
}

function playNote(buffer: Float32Array, part: Stem, note: Note, score: Score, voiceSeed: number) {
  const secondsPerTick = score.tempo / (1e6 * ppq);
  const start = Math.round(note.tick * secondsPerTick * rate);
  const held = Math.round(note.length * secondsPerTick * rate);
  const drive = score.style === "night_drive";
  const frequency = 440 * 2 ** ((note.pitch - 69) / 12);
  const step = frequency / rate;
  const level = (note.velocity / 100) ** 1.6;
  const left = Math.sqrt((1 - note.pan) / 2) * level;
  const right = Math.sqrt((1 + note.pan) / 2) * level;
  const attack = rate * ({ keys: 0.009, lead: 0.025, bass: 0.006, drums: 0.0013 }[part]);
  const releaseSeconds = { keys: 0.52, lead: 0.28, bass: 0.10, drums: 0.32 }[part];
  const openHat = note.pitch === 46;
  const keyDecay = Math.exp(-1 / (rate * (drive ? 0.75 : 1.5)));
  const transientDecay = Math.exp(-1 / (rate * 0.095));
  const drumDecay = Math.exp(-1 / (rate * (note.pitch === 36 ? 0.080 : note.pitch === 38 ? 0.064 : openHat ? 0.090 : 0.025)));
  const releaseDecay = Math.exp(-6.5 / (rate * releaseSeconds));
  const end = Math.min(held + Math.round(releaseSeconds * rate), buffer.length / 2 - start);
  let phase = 0, kickPhase = 0, body = 1, transient = 1, release = 1, drumLevel = 1;
  let noiseState = voiceSeed >>> 0, previousNoise = 0, noiseBand = 0;
  for (let i = 0; i < end; i++) {
    let sample: number;
    if (part === "drums") {
      noiseState = (Math.imul(1664525, noiseState) + 1013904223) >>> 0;
      const noise = noiseState / 2 ** 31 - 1;
      const high = noise - previousNoise;
      previousNoise = noise;
      noiseBand += 0.53 * (high - noiseBand);
      if (note.pitch === 36) {
        kickPhase += (47 + 113 * transient ** 4) / rate;
        sample = 0.58 * sine(kickPhase) + 0.025 * high * transient ** 8;
      } else if (note.pitch === 38) {
        sample = 0.31 * noiseBand + 0.18 * sine(i * 183 / rate) * transient;
      } else {
        const metal = sine(i * 4177 / rate) * sine(i * 6371 / rate);
        sample = 0.16 * high + 0.07 * metal;
      }
      sample *= drumLevel;
      drumLevel *= drumDecay;
    } else if (part === "bass") {
      sample = 0.32 * (sine(phase) + (drive ? 0.32 : 0.17) * sine(2 * phase) + 0.10 * transient * sine(3 * phase));
    } else if (part === "keys") {
      const tine = sine(phase + (drive ? 0.11 : 0.17) * transient * sine(2 * phase));
      sample = 0.145 * body * (tine + 0.24 * sine(phase * 1.002) + 0.16 * transient * sine(phase * 4.01));
    } else {
      const vibrato = 0.035 * (1 - transient) * sine(i * 4.8 / rate);
      const p = phase + vibrato;
      sample = drive
        ? 0.145 * (sine(p) + 0.35 * sine(2 * p) + 0.18 * sine(3 * p) + 0.09 * sine(4.006 * p))
        : 0.16 * (sine(p + 0.12 * transient * sine(3 * p)) + 0.16 * sine(2.003 * p));
    }
    if (i >= held) release *= releaseDecay;
    const amplitude = Math.min(1, i / attack) * release * sample;
    const pos = (start + i) * 2;
    buffer[pos] += left * amplitude;
    buffer[pos + 1] += right * amplitude;
    phase += step;
    transient *= transientDecay;
    body *= keyDecay;
  }
}

// Each stem receives its own stereo space so the exported stems retain the mix's effects.
function finishStem(buffer: Float32Array, part: Stem, beat: number) {
  const echo = part === "lead";
  const delayL = Math.round(rate * (echo ? beat * 0.75 : 0.037));
  const delayR = Math.round(rate * (echo ? beat * 0.50 : 0.053));
  const feedback = { lead: 0.26, keys: 0.21, drums: 0.074, bass: 0 }[part];
  const frames = buffer.length / 2;
  for (let i = 0; i < frames; i++) {
    const pos = 2 * i;
    if (i >= delayL) buffer[pos] += feedback * buffer[2 * (i - delayL) + 1];
    if (i >= delayR) buffer[pos + 1] += feedback * buffer[2 * (i - delayR)];
    const fade = Math.min(1, (frames - i - 1) / (rate * 0.08));
    buffer[pos] *= fade;
    buffer[pos + 1] *= fade;
  }
}

function stemWav(samples: Float32Array) {
  const wav = Buffer.allocUnsafe(44 + samples.length * 3);
  pcmHeader(samples.length / 2, rate, 2, 24).copy(wav);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.round(samples[i] * 8388607);
    if (Math.abs(value) > 8388607) throw new Error("Stem exceeded available headroom");
    wav.writeIntLE(value, 44 + i * 3, 3);
  }
  return wav;
}

const [dir, exportStems] = process.argv.slice(2);
const score: Score = JSON.parse(await readFile(join(dir, "score.json"), "utf8"));
const frames = Math.round(score.ticks / ppq * score.tempo * rate / 1e6);
const mix = new Float32Array(frames * 2);
const stem = new Float32Array(mix.length);
for (const part of stemNames) {
  stem.fill(0);
  score.parts[part].forEach((note, index) => playNote(stem, part, note, score, score.seed + index));
  finishStem(stem, part, score.tempo / 1e6);
  for (let i = 0; i < mix.length; i++) mix[i] += stem[i];
  if (exportStems === "stems") await writeFile(join(dir, part + ".wav"), stemWav(stem), { mode: 0o600 });
}
const raw = Buffer.from(mix.buffer);
if (endianness() === "BE") raw.swap32();
await writeFile(join(dir, "mix.f32"), raw, { mode: 0o600 });
