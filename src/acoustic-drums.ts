import { readFile } from "node:fs/promises";
import { bundledBankURL, readSampleBank } from "./sample-bank.js";
import type { Note } from "./score.js";

const drumMix = new Map([
  [36, { gain: 0.75, tail: 0.80 }],
  [38, { gain: 0.47, tail: 0.65 }],
  [42, { gain: 0.35, tail: 0.22 }],
  [46, { gain: 0.35, tail: 0.75 }],
]);

export async function renderAcousticDrums(
  buffer: Float32Array, notes: Note[], secondsPerTick: number, rate: number, seed: number,
) {
  const { pcm, zones } = readSampleBank(await readFile(bundledBankURL));
  const hits = zones.filter(z => z.instrument === "drums").map(z => {
    const mix = drumMix.get(z.root);
    if (!mix) throw Error("Missing drum mix for MIDI pitch " + z.root);
    const step = z.rate / rate;
    const frames = Math.min(Math.floor((z.end - z.start - 1) / step), Math.round(mix.tail * rate));
    const samples = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      const at = i * step;
      const index = Math.floor(at);
      const byte = (z.start + index) * 2;
      const a = pcm.readInt16LE(byte);
      const b = pcm.readInt16LE(byte + 2);
      samples[i] = (a + (b - a) * (at - index)) * mix.gain / 32768;
    }
    return { ...z, samples };
  });

  let kick = seed;
  const closedHats = notes.filter(n => n.pitch === 42).map(n => n.tick).sort((a, b) => a - b);
  for (const note of notes) {
    const choices = hits.filter(z => z.root === note.pitch);
    // The two kicks are alternate takes at the same dynamic. Hat accents span two recorded strikes.
    const velocity = note.pitch === 42 && note.velocity >= 55 ? Math.max(note.velocity, 71) : note.velocity;
    const hit = note.pitch === 36 ? choices[kick++ % choices.length] :
      choices.find(z => velocity >= z.soft && velocity <= z.loud);
    if (!hit) throw Error("Missing recorded drum for MIDI pitch " + note.pitch);
    const start = Math.round(note.tick * secondsPerTick * rate);
    const nextClosed = note.pitch === 46 ? closedHats.find(tick => tick > note.tick) : undefined;
    const chokeFrames = Math.round(rate * 0.012);
    const end = nextClosed === undefined ? hit.samples.length :
      Math.min(hit.samples.length, Math.round(nextClosed * secondsPerTick * rate) - start + chokeFrames);
    const count = Math.min(end, buffer.length / 2 - start);
    const fade = nextClosed === undefined ? Math.round(rate * 0.030) : chokeFrames;
    const gain = (note.velocity / 100) ** 1.6;
    const left = Math.sqrt((1 - note.pan) / 2) * gain;
    const right = Math.sqrt((1 + note.pan) / 2) * gain;
    for (let i = 0; i < count; i++) {
      const sample = hit.samples[i] * Math.min(1, (end - 1 - i) / fade);
      buffer[(start + i) * 2] += left * sample;
      buffer[(start + i) * 2 + 1] += right * sample;
    }
  }
}
