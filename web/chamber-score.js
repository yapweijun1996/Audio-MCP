import { ppq, timeline, instrumentTrack, encodeMidi } from "../src/midi.ts";

// Each row contains bass, inner voices, and the notes of a melodic phrase.
const film = [
  [38, [53, 57, 64], [69, 72, 74]],
  [34, [53, 57, 62], [77, 76, 74]],
  [41, [53, 57, 60], [72, 69, 67]],
  [40, [52, 55, 62], [67, 71, 72]],
  [43, [53, 58, 62], [74, 77, 79]],
  [41, [53, 57, 62], [81, 77, 76]],
  [34, [53, 58, 65], [74, 72, 70]],
  [33, [52, 55, 61], [69, 67, 73]],
];
const cafe = [
  [41, [52, 57, 62], [72, 69, 67]],
  [38, [53, 57, 60], [69, 72, 76]],
  [43, [53, 58, 62], [74, 70, 69]],
  [36, [52, 58, 62], [67, 69, 70]],
  [45, [55, 60, 64], [72, 76, 79]],
  [38, [54, 60, 64], [78, 76, 72]],
  [43, [53, 58, 64], [74, 70, 69]],
  [36, [52, 58, 69], [67, 70, 71]],
];
const voices = { piano: [0, 0], violin: [1, 40], cello: [2, 42], bass: [3, 32] };
export const ensembles = ["film_chamber", "cafe_duet"];
export const chamberSolo = ["solo_violin", "lyrical_piano"];

export function composeChamber(style, seconds, bpm, seed) {
  const { tempo, ticks } = timeline(seconds, bpm);
  const jazz = style === "cafe_duet";
  const form = jazz ? cafe : film;
  const solo = style === "solo_violin" || style === "lyrical_piano";
  const players = solo ? [style === "solo_violin" ? "violin" : "piano"] :
    jazz ? ["piano", "bass"] : ["piano", "violin", "cello"];
  const parts = Object.fromEntries(players.map(v => [v, []]));
  let state = seed;
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const transpose = [0, -2, 2, 0, 3][seed % 5];
  const variant = (seed >>> 2) % 3;
  const beats = ticks / ppq;
  // Leave space for the last chord to decay. Count the cadence as a bar even
  // when the requested length ends partway through a measure.
  const tail = Math.min(beats * 0.15, 0.65 * bpm / 60);
  const stop = beats - tail;
  const bars = Math.max(1, Math.ceil((stop - Math.min(1.15, stop * .25)) / 4));
  const add = (voice, at, duration, key, velocity) => {
    if (!parts[voice]) return;
    const start = Math.max(0, Math.round((at + (random() - 0.5) * .023) * ppq));
    const end = Math.min(Math.round(stop * ppq), start + Math.round(duration * ppq));
    if (end <= start) return;
    parts[voice].push({ start, end, key: key + transpose,
      velocity: Math.max(25, Math.min(112, Math.round(velocity + (random() - .5) * 6))) });
  };
  for (let bar = 0; bar < bars; bar++) {
    const at = bar * 4, last = bar === bars - 1;
    const [root, chord, tune] = last ?
      (jazz ? [41, [52, 57, 62], [69, 67, 65]] : [38, [53, 57, 64], [69, 65, 62]]) :
      form[bar % form.length];
    const arc = Math.sin(Math.PI * bar / Math.max(1, bars - 1)) * 11;
    if (last) {
      const hold = Math.min(stop - at, jazz ? 2.8 : 3.6);
      add(jazz ? "bass" : "piano", at, hold, root, 61);
      chord.forEach((key, n) => add("piano", at + .035 * (n + 1), hold - .12, key, 58 + n * 2));
      add("cello", at, hold * .9, root + 12, 55);
      add("violin", at, hold * .93, jazz ? 65 : 74, 55);
      add("piano", at + .08, hold - .1, jazz ? 69 : 74, 66);
      continue;
    }
    if (jazz) {
      // The bass leaves beat four open on alternate bars. Piano comping and
      // the right-hand answer occupy different parts of the swung beat.
      add("bass", at, 1.58, root, 76 + arc / 2);
      add("bass", at + 2.015, bar % 2 ? .81 : 1.35, root + (bar % 2 ? 7 : 4 + (bar % 4 === 2 ? -1 : 0)), 66);
      if (bar % 2) {
        const nextRoot = bar + 1 === bars - 1 ? 41 : form[(bar + 1) % form.length][0];
        add("bass", at + 3.33, .48, nextRoot - 1, 58);
      }
      const comp = bar % 2 ? [[.64, .76], [2.69, .78]] : [[.035, 1.2], [2.34, .54]];
      for (const [beat, length] of comp)
        chord.forEach((key, i) => add("piano", at + beat + i * .014, length, key, 49 + arc / 2));
      const rhythm = bar % 2 ? [[.06, .8], [1.66, .28], [2.05, 1.42]] : [[.68, .69], [1.68, .27], [2.68, .97]];
      rhythm.forEach(([beat, length], i) =>
        add("piano", at + beat, length, tune[(i + (variant && bar % 3 === 1 ? variant : 0)) % 3], 76 + arc - i * 3));
    } else {
      add("piano", at, 2.8, root, 52 + arc / 2);
      const fig = bar % 2 ? [0, 2, 1, 2] : [0, 1, 2, 1];
      fig.forEach((idx, i) => add("piano", at + [.49, 1.04, 1.95, 3.06][i],
        [1.48, 1.83, 1.50, .81][i], chord[idx], 47 + arc / 2 + (i === 2 ? 6 : 0)));
      const celloAnswer = !solo && bar % 8 === 4;
      const melodyVoice = style === "lyrical_piano" || (!solo && bar % 8 < 2)
        ? "piano" : celloAnswer ? "cello" : "violin";
      const rhythm = bar % 2 ? [[.05, 1.81], [2.12, .58], [2.94, .91]] : [[.14, 1.26], [1.64, .65], [2.49, 1.39]];
      rhythm.forEach(([beat, length], i) => add(melodyVoice, at + beat, length,
        tune[(i + (bar % 4 === 2 ? variant : 0)) % 3] - (celloAnswer ? 12 : 0), 66 + arc + (i === 0 ? 5 : -i)));
      if (melodyVoice === "piano" && bar % 8 === 1)
        add("violin", at + 2.25, 1.52, chord[1] + 12, 52);
      if (celloAnswer) {
        add("violin", at + .28, 2.93, chord[2] + 12, 57);
        continue;
      }
      add("cello", at + (bar === 0 ? 1.6 : .12), bar === 0 ? 2.15 : 2.66,
        root + 12, 53 + arc);
      if (bar % 2) add("cello", at + 3, .89, chord[0], 55 + arc);
    }
  }
  const tracks = players.map(voice => {
    const [channel, program] = voices[voice];
    const track = instrumentTrack(voice, channel, program);
    const notes = parts[voice].sort((a, b) => a.start - b.start);
    const previous = new Map();
    const events = [];
    for (const note of notes) {
      const old = previous.get(note.key);
      if (old && old.end > note.start) old.end = note.start;
      previous.set(note.key, note);
    }
    for (const n of notes) {
      if (n.end <= n.start) continue;
      events.push([n.start, n.key, n.velocity], [n.end, n.key, 0]);
    }
    events.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
    let tick = 0;
    for (const [t, noteNumber, velocity] of events) {
      track.push({ type: velocity ? "noteOn" : "noteOff", channel, noteNumber, velocity, deltaTime: t - tick });
      tick = t;
    }
    return track;
  });
  return encodeMidi(tempo, ticks, tracks);
}
