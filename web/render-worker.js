import { ensembles, chamberSolo, composeChamber } from "./chamber-score.js";
import { mixChamber } from "./chamber-mix.js";
import { composeInstrument, drumPatterns } from "../src/instruments.ts";
import { composePiano } from "../src/piano.ts";
import { synthesize } from "../src/audio.ts";
import { parseMidi } from "midi-file";
import { choices } from "./catalog.js";
import { zones, sampleURL } from "bank:assets";

const rate = 44100;
let pcm;
const sampled = {
  marimba: "marimba",
  acoustic_drums: "drums",
};
const within = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
function validate(p) {
  if (!choices[p.mode]?.includes(p[p.mode]))
    throw Error("Choose a valid instrument or effect.");
  if (p.mode === "effect") {
    if (!within(p.effectSeconds, 0.02, 3))
      throw Error("Effects must be 0.02–3 seconds.");
  } else if (
    !within(p.seconds, 1, 60) ||
    !Number.isInteger(p.bpm) ||
    !within(p.bpm, 40, 240) ||
    !Number.isInteger(p.seed) ||
    !within(p.seed, 0, 0xffffffff) ||
    !drumPatterns.includes(p.pattern)
  ) {
    throw Error("Check the tempo, length and seed.");
  }
}

function notes(midi) {
  const { header, tracks } = parseMidi(midi);
  const tempo = tracks[0].find(
    (e) => e.type === "setTempo",
  ).microsecondsPerBeat;
  const secondsPerTick = tempo / (header.ticksPerBeat * 1e6);
  const result = [];
  for (const track of tracks.slice(1)) {
    const active = new Map();
    let tick = 0, program = 0;
    for (const e of track) {
      tick += e.deltaTime;
      if (e.type === "programChange") program = e.programNumber;
      if (e.type === "noteOn")
        active.set(e.noteNumber, {
          program, key: e.noteNumber,
          velocity: e.velocity,
          start: tick * secondsPerTick,
        });
      if (e.type === "noteOff") {
        const note = active.get(e.noteNumber);
        note.end = tick * secondsPerTick;
        result.push(note);
        active.delete(e.noteNumber);
      }
    }
  }
  return result;
}
function mixSample(output, note, family) {
  const z = zones.find(
    (z) =>
      z.instrument === family &&
      note.key >= z.low &&
      note.key <= z.high &&
      note.velocity >= z.soft &&
      note.velocity <= z.loud,
  );
  if (!z) throw Error("The sound bank has no recording for this note.");
  const step = (z.rate / rate) * 2 ** ((note.key - z.root) / 12);
  const first = Math.round(note.start * rate),
    gate = Math.round((note.end - note.start) * rate);
  const release = Math.max(1, Math.round(z.release * rate));
  const count = Math.min(
    output.length - first,
    Math.floor((z.end - z.start - 1) / step),
    gate + release,
  );
  const gain = (note.velocity / 110) ** 1.7 / 32768;
  for (let i = 0; i < count; i++) {
    const pos = z.start + i * step,
      index = Math.floor(pos);
    const value = pcm[index] + (pcm[index + 1] - pcm[index]) * (pos - index);
    const envelope = i < gate ? 1 : (1 - (i - gate) / release) ** 2;
    output[first + i] += value * gain * envelope;
  }
}
function wavFile(...channels) {
  const frames = channels[0].length, stride = 2 * channels.length;
  let peak = .001;
  for (const channel of channels)
    for (const s of channel) peak = Math.max(peak, Math.abs(s));
  const gain = Math.min(2, .88 / peak) * 32767;
  const wav = Buffer.alloc(44 + frames * stride);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels.length, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * stride, 28);
  wav.writeUInt16LE(stride, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(frames * stride, 40);
  for (let i = 0; i < frames; i++) {
    const scale = gain * Math.min(1, (frames - 1 - i) / (rate * .055));
    for (let ch = 0; ch < channels.length; ch++)
      wav.writeInt16LE(Math.round(channels[ch][i] * scale), 44 + i * stride + 2 * ch);
  }
  return wav;
}
function loadRecordings(request) {
  return new Promise(resolve => {
    self.onmessage = ({ data }) => resolve(data.recordings);
    self.postMessage({ recordingRequest: request });
  });
}
self.onmessage = async ({ data: p }) => {
  try {
    validate(p);
    let wav, midi;
    if (p.mode === "effect") wav = synthesize(p.effect, p.effectSeconds);
    else {
      midi =
        [...ensembles, ...chamberSolo].includes(p.instrument)
          ? composeChamber(p.instrument, p.seconds, p.bpm, p.seed)
          : p.instrument === "piano"
          ? composePiano(p.seconds, p.bpm, p.seed)
          : composeInstrument(
              p.instrument,
              p.seconds,
              p.bpm,
              p.seed,
              p.pattern,
            );
      const frames = Math.round(rate * p.seconds), scoreNotes = notes(midi);
      const family = sampled[p.instrument];
      if (family) {
        const out = new Float32Array(frames);
        if (!pcm) {
          const response = await fetch(new URL(sampleURL, self.location.href));
          if (!response.ok) throw Error("Could not load the sample bank. Reconnect and try again.");
          pcm = new Int16Array(await response.arrayBuffer());
        }
        for (const note of scoreNotes) mixSample(out, note, family);
        wav = wavFile(out);
      } else {
        wav = wavFile(...await mixChamber(scoreNotes, frames, p.instrument, loadRecordings));
      }
    }
    const peaks = Array(240).fill(0);
    const stride = wav.readUInt16LE(32), frames = (wav.length - 44) / stride;
    for (let i = 0; i < frames; i++) {
      const bin = Math.floor((i * peaks.length) / frames);
      peaks[bin] = Math.max(
        peaks[bin],
        Math.abs(wav.readInt16LE(44 + i * stride)) / 32768,
        Math.abs(wav.readInt16LE(44 + (i + 1) * stride - 2)) / 32768,
      );
    }
    const bytes = (b) =>
      b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    const audio = bytes(wav),
      score = midi && bytes(midi);
    self.postMessage(
      { wav: audio, midi: score, peaks },
      score ? [audio, score] : [audio],
    );
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
