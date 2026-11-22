import { addNote, encodeMidi, harmony, instrumentTrack, ppq, timeline } from "./midi.js";

export function composePiano(seconds: number, bpm: number, seed: number) {
  const { tempo, ticks } = timeline(seconds, bpm);
  const melody = instrumentTrack("Right hand", 0, 0);
  const accompaniment = instrumentTrack("Left hand", 1, 0);
  let state = seed;
  for (let start = 0; start < ticks; start += ppq) {
    const beat = start / ppq;
    const chord = harmony[Math.floor(beat / 4) % harmony.length];
    const length = Math.min(ppq, ticks - start);
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const index = Math.floor(state / 2 ** 32 * chord.length);
    addNote(melody, 0, chord[index] + 24, length, 70 + (state >>> 28));
    addNote(accompaniment, 1, chord[[0, 2, 1, 2][beat % 4]], length, 52);
  }
  return encodeMidi(tempo, ticks, [melody, accompaniment]);
}
