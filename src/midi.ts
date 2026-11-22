import { writeMidi, type MidiEvent } from "midi-file";

export const ppq = 480;
export const harmony = [
  [48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50],
];


export function timeline(seconds: number, bpm: number) {
  const tempo = Math.round(60_000_000 / bpm);
  return { tempo, ticks: Math.round(seconds * 1_000_000 * ppq / tempo) };
}

export function instrumentTrack(name: string, channel: number, programNumber: number): MidiEvent[] {
  return [
    { type: "trackName", text: name, deltaTime: 0 },
    { type: "programChange", programNumber, channel, deltaTime: 0 },
  ];
}

export function addNote(track: MidiEvent[], channel: number, pitch: number, length: number, velocity: number) {
  track.push(
    { type: "noteOn", channel, noteNumber: pitch, velocity, deltaTime: 0 },
    { type: "noteOff", channel, noteNumber: pitch, velocity: 0, deltaTime: length },
  );
}

export function encodeMidi(tempo: number, ticks: number, parts: MidiEvent[][]) {
  const conductor: MidiEvent[] = [
    { type: "setTempo", deltaTime: 0, microsecondsPerBeat: tempo },
    { type: "endOfTrack", deltaTime: ticks },
  ];
  for (const track of parts) track.push({ type: "endOfTrack", deltaTime: 0 });
  const tracks = [conductor, ...parts];
  return Buffer.from(writeMidi({ header: { format: 1, numTracks: tracks.length, ticksPerBeat: ppq }, tracks }));
}
