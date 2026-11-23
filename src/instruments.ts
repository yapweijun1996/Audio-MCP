import { addNote, cc0BankTag, encodeMidi, harmony, instrumentTrack, ppq, timeline } from "./midi.js";

export const instruments = ["nylon_guitar", "finger_bass", "flute", "marimba", "cello_ensemble", "acoustic_drums"] as const;
type Instrument = typeof instruments[number];

export const drumPatterns = ["backbeat", "half_time", "swing"] as const;
type DrumPattern = typeof drumPatterns[number];

const presets = {
  nylon_guitar: { name: "Nylon Guitar", program: 24, step: ppq / 2 },
  finger_bass: { name: "Fingered Electric Bass", program: 33, step: ppq },
  flute: { name: "Flute", program: 73, step: ppq },
  marimba: { name: "Marimba", program: 12, step: ppq / 2 },
  cello_ensemble: { name: "Cello Ensemble", program: 42, step: ppq * 2 },
} satisfies Record<Exclude<Instrument, "acoustic_drums">, { name: string; program: number; step: number }>;

function drumTrack(ticks: number, pattern: DrumPattern, seed: number) {
  const channel = 9; // GM percussion uses MIDI channel 10 (zero-based index 9).
  const track = instrumentTrack("Acoustic Drums", channel, 0);
  let tick = 0;
  for (let step = 0; tick < ticks; step++) {
    const position = step % 8;
    const downbeat = position % 2 === 0;
    const stepTicks = pattern === "swing" ? ppq * (downbeat ? 2 / 3 : 1 / 3) : ppq / 2;
    const length = Math.min(stepTicks, ticks - tick);
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const accent = seed >>> 29;
    const hits = [{ key: position === 7 && step % 16 === 15 ? 46 : 42,
      velocity: (downbeat ? 76 : 55) + accent }];
    const kicks = pattern === "half_time" ? [0, 3] : [0, 4];
    const snares = pattern === "half_time" ? [4] : [2, 6];
    if (kicks.includes(position)) hits.push({ key: 36, velocity: 88 + accent });
    if (snares.includes(position)) hits.push({ key: 38, velocity: 86 + accent });
    for (const hit of hits) track.push({ type: "noteOn", deltaTime: 0, channel,
      noteNumber: hit.key, velocity: hit.velocity });
    hits.forEach((hit, i) => track.push({ type: "noteOff", deltaTime: i === 0 ? length : 0,
      channel, noteNumber: hit.key, velocity: 0 }));
    tick += length;
  }
  return track;
}

export function composeInstrument(instrument: Instrument, seconds: number, bpm: number, seed: number,
    pattern: DrumPattern = "backbeat") {
  const { tempo, ticks } = timeline(seconds, bpm);
  if (instrument === "acoustic_drums") {
    return encodeMidi(tempo, ticks, [drumTrack(ticks, pattern, seed)], cc0BankTag);
  }
  const { name, program, step } = presets[instrument];
  const track = instrumentTrack(name, 0, program);
  let state = seed;
  for (let start = 0; start < ticks; start += step) {
    const chord = harmony[Math.floor(start / (4 * ppq)) % harmony.length];
    const position = (start / step) % 4;
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    let pitch: number;
    let velocity = 70 + (state >>> 28);
    switch (instrument) {
      case "nylon_guitar": pitch = chord[[0, 1, 2, 1][position]] + 12; break;
      case "finger_bass": pitch = chord[position === 2 ? 2 : 0] - 12; break;
      case "marimba":
        pitch = chord[[0, 1, 2, 1][position]] + 12;
        velocity = (position % 2 === 0 ? 80 : 56) + (state >>> 28);
        break;
      case "cello_ensemble":
        pitch = position % 2 === 0 ? chord[0] : chord[1 + (state >>> 31)];
        break;
      case "flute": pitch = chord[Math.floor(state / 2 ** 32 * chord.length)] + 24; break;
    }
    addNote(track, 0, pitch, Math.min(step, ticks - start), velocity);
  }
  const bank = instrument === "marimba" || instrument === "cello_ensemble" ? cc0BankTag : undefined;
  return encodeMidi(tempo, ticks, [track], bank);
}
