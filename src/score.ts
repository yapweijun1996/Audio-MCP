import type { MidiEvent } from "midi-file";
import { encodeMidi, instrumentTrack, ppq } from "./midi.js";

export const musicStyles = ["velvet_keys", "night_drive"] as const;
export const stemNames = ["drums", "bass", "keys", "lead"] as const;
export type Style = typeof musicStyles[number];
export type Stem = typeof stemNames[number];
export type Note = { tick: number; length: number; pitch: number; velocity: number; pan: number };
export type Score = ReturnType<typeof composeScore>;

const programs = { drums: 0, bass: 38, keys: 4, lead: 81 };
const channels = { drums: 9, bass: 1, keys: 2, lead: 3 };
const barTicks = ppq * 4;

// Each voicing starts with a low bass root followed by the upper chord tones.
// The two palettes move through major ninths and minor sevenths respectively.
const velvet = [
  [38, 54, 57, 61, 64], [35, 54, 57, 61, 62], [31, 54, 57, 59, 62], [33, 55, 59, 61, 64],
  [40, 55, 59, 62, 66], [35, 54, 57, 61, 62], [33, 55, 59, 61, 64], [38, 54, 57, 59, 64],
];
const night = [
  [38, 53, 57, 60, 64], [34, 53, 57, 60, 62], [41, 53, 57, 60, 67], [36, 52, 55, 58, 62],
  [31, 53, 55, 58, 62], [34, 53, 57, 60, 62], [33, 52, 55, 61, 64], [38, 53, 57, 60, 64],
];

export function composeScore(style: Style, bars: number, seed: number, bpm: number) {
  const driving = style === "night_drive";
  const harmony = driving ? night : velvet;
  const tempo = Math.round(60_000_000 / bpm);
  const transpose = [0, -2, 3, 5][seed % 4];
  const parts: Record<Stem, Note[]> = { drums: [], bass: [], keys: [], lead: [] };
  let state = seed;
  function random() {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  }
  const hook = [2, 0, 1, 3];
  const motifOffset = Math.floor(random() * hook.length);
  const sections = ["intro", "theme", "lift", "outro"].map((name, i) => ({
    name, start_bar: 1 + i * bars / 4,
  }));
  for (let bar = 0; bar < bars; bar++) {
    const section = Math.floor(bar * 4 / bars);
    const last = bar === bars - 1;
    const chord = harmony[last ? 7 : bar % 8].map(pitch => pitch + transpose);
    const [root, ...upper] = chord;
    function note(part: Stem, beat: number, length: number, pitch: number, velocity: number, pan = 0) {
      const swing = !driving && beat % 1 === 0.5 ? 0.075 : 0;
      const jitter = beat === 0 ? 0 : (random() - 0.5) * 0.025;
      const tick = Math.max(0, Math.round((bar * 4 + beat + swing + jitter) * ppq));
      parts[part].push({ tick, length: Math.max(1, Math.min(bars * barTicks - tick, Math.round(length * ppq))),
        pitch, velocity: Math.round(velocity + random() * 6), pan });
    }
    // The final downbeat resolves to tonic with room for the tails to ring.
    const chords = last ? [0] : driving ? [0, 1.5, 3] : [0, 2.5];
    for (const beat of chords) {
      upper.forEach((pitch, voice) => {
        const length = last ? 2.35 : driving ? 0.7 : beat === 0 ? 1.7 : 1.0;
        note("keys", beat + voice * 0.013, length, pitch, section === 2 ? 72 : 62, (voice - 1.5) * 0.30);
      });
    }
    if (section > 0 || bar % 2 || last) {
      const beats = last ? [0] : driving ? [0, 0.75, 1.5, 2, 2.75, 3.5] : [0, 1.5, 2.75];
      for (const beat of beats) {
        const pitch = beat === 2.75 ? root + 7 : beat === 3.5 ? root + 12 : root;
        note("bass", beat, last ? 2.1 : driving ? 0.44 : 0.92, pitch, 84);
      }
    }
    if (last) {
      note("lead", 0.06, 1.6, root + 36, 64, 0.12);
      if (driving) note("drums", 0, 0.3, 36, 72);
      continue;
    }
    if (section === 1 || section === 2 || bar % 2 === 1) {
      const phrase = driving ? [0.5, 1.25, 2.5, 3.25] : [0.5, 1.5, 2.75];
      for (const [i, beat] of phrase.entries()) {
        if ((section === 0 || section === 3) && i > 1) break;
        if (bar % 4 === 3 && i === phrase.length - 1) continue;
        const index = hook[(motifOffset + i + (bar % 2) + (section === 2 ? 1 : 0)) % 4];
        note("lead", beat, i === 0 ? 0.65 : 0.44, upper[index] + 12, section === 2 ? 82 : 70, 0.15);
      }
    }
    const fullKit = section === 1 || section === 2;
    const kicks = fullKit ? driving ? [0, 1, 2, 3] : [0, 1.75, 2.5] : [0];
    for (const beat of kicks) note("drums", beat, 0.22, 36, beat === 0 ? 99 : 84);
    for (const beat of fullKit ? [1, 3] : [3]) note("drums", beat, 0.16, 38, fullKit ? 82 : 56, -0.07);
    const hats = fullKit ? 8 : 4;
    for (let i = 0; i < hats; i++) {
      const beat = fullKit ? i / 2 : i + 0.5;
      const openHat = section === 2 && i === 7;
      note("drums", beat, openHat ? 0.35 : 0.09, openHat ? 46 : 42, i % 2 ? 44 : 56, 0.32);
    }
    if (bar % 4 === 3 && section < 3) {
      for (const beat of [3.5, 3.75]) note("drums", beat, 0.08, 38, beat === 3.5 ? 36 : 48, -0.12);
    }
  }
  return { style, bpm, seed, bars, tempo, ticks: bars * barTicks, sections, parts };
}

export function scoreMidi(score: Score) {
  const tracks = stemNames.map(part => {
    const channel = channels[part];
    const track = instrumentTrack(part, channel, programs[part]);
    const events: { at: number; event: MidiEvent }[] = [];
    for (const { tick, length, pitch, velocity } of score.parts[part]) {
      events.push({ at: tick, event: { type: "noteOn", deltaTime: 0, channel, noteNumber: pitch, velocity } },
        { at: tick + length, event: { type: "noteOff", deltaTime: 0, channel, noteNumber: pitch, velocity: 0 } });
    }
    events.sort((a, b) => a.at - b.at || Number(a.event.type === "noteOn") - Number(b.event.type === "noteOn"));
    let previous = 0;
    for (const { at, event } of events) {
      event.deltaTime = at - previous;
      track.push(event);
      previous = at;
    }
    return track;
  });
  return encodeMidi(score.tempo, score.ticks, tracks);
}
