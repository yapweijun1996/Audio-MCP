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

// Four-bar phrases share a call, leave space for a response and approach the next downbeat.
// Lead entries are [beat, held beats, chord-tone index]. Comping entries are [beat, held beats].
type Phrase = [number, number, number][];
type Chords = [number, number][];
const velvetLead: Phrase[] = [
  [[0.5, 0.72, 1], [1.5, 0.32, 2], [2.25, 1.18, 3]],
  [[0.75, 1.12, 2], [2.5, 0.36, 1], [3.25, 0.38, 0]],
  [[0.5, 0.72, 1], [1.5, 0.32, 2], [2.25, 0.45, 3], [3.25, 0.38, 2]],
  [[0.25, 1.55, 1], [3.5, 0.30, 0]],
];
const nightLead: Phrase[] = [
  [[0.5, 0.38, 0], [1.25, 0.37, 0], [2, 0.82, 2], [3.5, 0.32, 1]],
  [[0, 1.35, 3], [2.75, 0.65, 1]],
  [[0.5, 0.38, 0], [1.25, 0.37, 0], [2, 0.40, 2], [2.75, 0.66, 3]],
  [[0, 1.72, 2], [3.25, 0.40, 1]],
];
const velvetComp: Chords[] = [
  [[0, 1.58], [2.5, 0.72]], [[0.5, 1.1], [2.75, 0.7]],
  [[0, 1.85], [3, 0.55]], [[0.25, 2.3]],
];
const nightComp: Chords[] = [
  [[0, 0.62], [1.5, 0.55], [3, 0.54]], [[0, 1.45], [2.75, 0.68]],
  [[0, 0.62], [1.5, 0.55], [3.5, 0.30]], [[0, 1.85]],
];

const velvetBass = [[0, 1.5, 2.75], [0, 2.25, 3.5], [0, 1.75, 2.75], [0, 2, 3.5]];
const nightBass = [[0, 0.75, 1.5, 2, 2.75, 3.5], [0, 1.5, 2, 3.25],
  [0, 0.75, 1.5, 2.5, 3.5], [0, 1.5, 2.75]];

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
  const motifOffset = (seed ^ (seed >>> 16)) & 3;
  const answerOffset = random() < 0.5 ? 1 : 3;
  const sections = ["intro", "theme", "lift", "outro"].map((name, i) => ({
    name, start_bar: 1 + i * bars / 4,
  }));
  const comp = driving ? nightComp : velvetComp;
  const bassLine = driving ? nightBass : velvetBass;
  const phrases = driving ? nightLead : velvetLead;
  const sectionBars = bars / sections.length;
  for (let bar = 0; bar < bars; bar++) {
    const section = Math.floor(bar * 4 / bars);
    const last = bar === bars - 1;
    const phraseBar = bar % 4;
    const localBar = bar % sectionBars;
    const turnaround = localBar === sectionBars - 1;
    const lift = section === 2;
    const chord = harmony[last ? 7 : bar % 8].map(pitch => pitch + transpose);
    const [root, ...upper] = chord;
    function note(part: Stem, beat: number, length: number, pitch: number, velocity: number, pan = 0) {
      const swing = !driving && beat % 1 === 0.5 ? 0.075 : 0;
      const jitter = beat === 0 ? 0 : (random() - 0.5) * 0.025;
      const pocket = !driving && part === "drums" && pitch === 38 ? 0.025 : 0;
      const tick = Math.max(bar * barTicks, Math.round((bar * 4 + beat + swing + jitter + pocket) * ppq));
      parts[part].push({ tick, length: Math.max(1, Math.min(bars * barTicks - tick, Math.round(length * ppq))),
        pitch, velocity: Math.round(velocity + random() * 6), pan });
    }
    // The final downbeat resolves to tonic with room for the tails to ring.
    const chords: Chords = last ? [[0, 2.35]] : section === 0 && localBar === 0 ? [[0, 2.6]] : comp[phraseBar];
    for (const [beat, length] of chords) {
      upper.forEach((pitch, voice) => {
        const finger = phraseBar % 2 ? 3 - voice : voice;
        const roll = driving ? 0.007 : 0.020 + 0.005 * phraseBar;
        const accent = (voice === 3 ? 7 : 0) - (beat >= 2 ? 8 : 0);
        note("keys", beat + finger * roll, length, pitch, (lift ? 76 : 64) + accent, (voice - 1.5) * 0.30);
      });
    }
    if (driving && lift && !turnaround) {
      for (const [i, beat] of [0.75, 1.25, 2.5, 3.25].entries()) {
        note("keys", beat, 0.20, upper[(i + phraseBar) % 4] + 12, 49 + i * 3, i % 2 ? 0.53 : -0.53);
      }
    }
    if (section > 0 || bar % 2 || last) {
      const beats = last ? [0] : bassLine[phraseBar];
      for (const [i, beat] of beats.entries()) {
        const pickup = !last && phraseBar % 2 === 1 && i === beats.length - 1;
        const nextRoot = harmony[bar + 1 === bars - 1 ? 7 : (bar + 1) % 8][0] + transpose;
        const pitch = pickup ? nextRoot - (driving ? 2 : 1) : beat === 2.75 ? root + 7 : root;
        const space = (beats[i + 1] ?? 4) - beat;
        const length = last ? 2.1 : Math.min(space - 0.14, driving ? 0.46 : 1.35);
        note("bass", beat, length, pitch, pickup ? 69 : i === 0 ? 91 : 78);
      }
    }
    if (last) {
      note("lead", 0.06, 1.6, root + 36, 64, 0.12);
      if (driving) note("drums", 0, 0.3, 36, 72);
      continue;
    }
    if (section === 1 || lift || bar % 2 === 1) {
      const phrase = phrases[phraseBar];
      for (const [i, [beat, length, degree]] of phrase.entries()) {
        if ((section === 0 || section === 3) && i > 1) break;
        if (turnaround && i > 0 && !lift) break;
        // On a second four-bar pass, recast the answer over the changing harmony.
        const variation = (lift || localBar >= 4) && phraseBar % 2 ? answerOffset : 0;
        if (localBar >= 4 && i === 1 && phraseBar === 2) continue;
        const index = (degree + motifOffset + variation) % 4;
        const accent = i === 0 ? 7 : length < 0.5 ? -7 : 2;
        note("lead", beat, length, upper[index] + 12, (lift ? 81 : 71) + accent, 0.12);
      }
    }
    const fullKit = section === 1 || section === 2;
    const kicks = fullKit ? driving ? [0, 1, 2, 3] : [0, 1.75, 2.5] : [0];
    for (const beat of kicks) note("drums", beat, 0.22, 36, beat === 0 ? 99 : 84);
    if (!driving && fullKit && phraseBar === 1) note("drums", 2.75, 0.07, 38, 34, -0.10);
    for (const beat of fullKit ? [1, 3] : [3]) note("drums", beat, 0.16, 38, fullKit ? 82 : 56, -0.07);
    const hats = fullKit ? 8 : 4;
    for (let i = 0; i < hats; i++) {
      const beat = fullKit ? i / 2 : i + 0.5;
      if (turnaround && i >= hats - 2) continue;
      const openHat = lift && i === (phraseBar % 2 ? 3 : 7);
      note("drums", beat, openHat ? 0.35 : 0.09, openHat ? 46 : 42, i % 2 ? 44 : 56, 0.32);
    }
    if (turnaround && section < 3) {
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
