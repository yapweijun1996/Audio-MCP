import { readFile, writeFile } from "node:fs/promises";
import { endianness } from "node:os";
import { join } from "node:path";
import { pcmHeader } from "./audio.js";
import { ppq } from "./midi.js";
import { stemNames, type Note, type Score, type Stem } from "./score.js";

const rate = 48000;
const tableSize = 4096;
const sineTable = Float32Array.from({ length: tableSize }, (_, i) => Math.sin(2 * Math.PI * i / tableSize));
// Sixteen partials stay below Nyquist across the score's synth registers.
const sawTable = Float32Array.from({ length: tableSize }, (_, i) => {
  const angle = 2 * Math.PI * i / tableSize;
  let sum = 0;
  for (let h = 1; h <= 16; h++) sum += (1 - h / 20) * Math.sin(angle * h) / h;
  return sum;
});

function oscillator(table: Float32Array, phase: number) {
  const position = phase * tableSize;
  const whole = Math.floor(position);
  const index = whole & (tableSize - 1);
  return table[index] + (position - whole) * (table[(index + 1) & (tableSize - 1)] - table[index]);
}
function sine(phase: number) { return oscillator(sineTable, phase); }

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
  const touch = Math.min(1, note.velocity / 100);
  const section = Math.floor(note.tick * score.sections.length / score.ticks);
  const lift = score.sections[section].name === "lift";
  const stereoDepth = [0.35, 0.72, 0.90, 0.55][section];
  const attack = rate * ({ keys: drive ? 0.018 : 0.014 - touch * 0.010,
    lead: drive ? 0.012 : 0.034, bass: 0.006, drums: 0.0013 }[part]);
  const releaseSeconds = { keys: 0.52, lead: 0.28, bass: 0.10, drums: 0.32 }[part];
  const openHat = note.pitch === 46;
  const keyDecay = Math.exp(-1 / (rate * (drive ? 0.75 : 1.5)));
  const transientDecay = Math.exp(-1 / (rate * (part === "keys" ? 0.07 + 0.11 * touch : 0.095)));
  const detune = drive ? 0.0027 : 0.0011;
  const tremoloStep = 4.2 / rate;
  const startPhase = (start * tremoloStep) % 1;
  const stereoPhase = (start * frequency / rate * detune) % 1;
  const tineStrength = touch * touch * 0.56;
  const openness = (lift ? 0.64 : 0.40) + 0.15 * touch;
  const drumDecay = Math.exp(-1 / (rate * (note.pitch === 36 ? 0.080 : note.pitch === 38 ? 0.064 : openHat ? 0.090 : 0.025)));
  const releaseDecay = Math.exp(-6.5 / (rate * releaseSeconds));
  const end = Math.min(held + Math.round(releaseSeconds * rate), buffer.length / 2 - start);
  let phase = 0, kickPhase = 0, body = 1, transient = 1, release = 1, drumLevel = 1;
  let noiseState = Math.imul(voiceSeed ^ 0xa53c9e31, 0x85ebca6b) >>> 0;
  let previousNoise = 0, noiseBand = 0, lowNoise = 0;
  for (let i = 0; i < end; i++) {
    let sample: number;
    let spread = 0;
    if (part === "drums") {
      noiseState = (Math.imul(1664525, noiseState) + 1013904223) >>> 0;
      const noise = noiseState / 2 ** 31 - 1;
      const high = noise - previousNoise;
      previousNoise = noise;
      lowNoise += 0.08 * (noise - lowNoise);
      noiseBand += (drive ? 0.57 : 0.38) * (noise - lowNoise - noiseBand);
      if (note.pitch === 36) {
        kickPhase += (47 + 113 * transient ** 4) / rate;
        sample = 0.58 * sine(kickPhase) + 0.025 * high * transient ** 8;
      } else if (note.pitch === 38) {
        const wires = drive && i < rate * 0.014 ? 0.40 : 1;
        sample = (drive ? 0.78 : 0.48) * wires * noiseBand +
          (0.18 * sine(i * 183 / rate) + 0.072 * sine(i * 327 / rate)) * transient;
      } else {
        const metal = sine(i * 4177 / rate) * sine(i * 6371 / rate);
        sample = (drive ? 0.28 : 0.14) * noiseBand + 0.055 * high +
          (drive ? 0.13 : 0.08) * metal;
      }
      sample *= drumLevel;
      drumLevel *= drumDecay;
    } else if (part === "bass") {
      sample = 0.32 * (sine(phase) + (drive ? 0.32 : 0.17) * sine(2 * phase) + 0.10 * transient * sine(3 * phase));
    } else if (part === "keys") {
      if (drive) {
        const dry = sine(phase);
        const bright = (0.22 + 0.64 * transient) * openness;
        const a = oscillator(sawTable, phase * (1 - detune) + stereoPhase);
        const b = oscillator(sawTable, phase * (1 + detune) + stereoPhase + 0.21);
        const strike = 0.18 * touch * transient * sine(5.01 * phase);
        sample = 0.135 * body * (dry + bright * (a + b) * 0.5 + strike);
        spread = 0.105 * stereoDepth * body * openness * (a - b);
      } else {
        const bell = sine(phase + tineStrength * transient * sine(3.01 * phase));
        const reed = 0.20 * sine(phase * (1 + detune)) + 0.34 * touch * transient * sine(phase * 6.98);
        const tremolo = 0.95 + 0.05 * sine(startPhase + i * tremoloStep);
        sample = 0.15 * body * (bell + reed) * tremolo;
      }
    } else {
      const vibrato = (drive ? 0.026 : 0.019) * (1 - transient) * sine(i * 4.8 / rate);
      const p = phase + vibrato;
      if (drive) {
        const bright = openness * (0.55 + 0.40 * transient);
        const core = oscillator(sawTable, p);
        const detuned = oscillator(sawTable, p * (1 + detune) + stereoPhase + 0.25);
        const fundamental = sine(p);
        const overtones = core - 0.95 * fundamental;
        sample = 0.15 * (fundamental + bright * (core + 1.50 * overtones));
        spread = 0.092 * stereoDepth * bright * (detuned - core);
      } else {
        sample = 0.16 * (sine(p + 0.24 * touch * transient * sine(3 * p)) + 0.18 * sine(2.003 * p));
      }
    }
    if (i >= held) release *= releaseDecay;
    const envelope = Math.min(1, i / attack) * release;
    const pos = (start + i) * 2;
    buffer[pos] += left * envelope * (sample + spread);
    buffer[pos + 1] += right * envelope * (sample - spread);
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
