import { instruments } from "../src/instruments.ts";
import { effects } from "../src/audio.ts";
export const names = {
  film_chamber: "Film chamber trio",
  cafe_duet: "Café piano & upright bass",
  solo_violin: "Solo violin",
  lyrical_piano: "Lyrical solo piano",
  piano: "Grand piano",
  nylon_guitar: "Nylon guitar",
  finger_bass: "Finger bass",
  flute: "Flute",
  marimba: "Marimba",
  acoustic_drums: "Acoustic drums",
  cello_ensemble: "Cello ensemble",
  click: "Click",
  hover: "Hover",
  success: "Success",
  error: "Error",
  whoosh: "Whoosh",
};
export const choices = {
  instrument: [
    "marimba",
    "film_chamber", "cafe_duet", "lyrical_piano", "solo_violin",
    ...["piano", ...instruments].filter((i) => i !== "marimba"),
  ],
  effect: effects,
};
export const defaults = {
  mode: "instrument",
  instrument: "marimba",
  effect: "success",
  bpm: 100,
  seconds: 12,
  effectSeconds: 0.45,
  seed: 42,
  pattern: "backbeat",
};

export const featured = {
  film: { instrument: "film_chamber", seconds: 32, bpm: 68, seed: 15 },
  cafe: { instrument: "cafe_duet", seconds: 32, bpm: 88, seed: 25 },
  recital: { instrument: "lyrical_piano", seconds: 28, bpm: 76, seed: 5 },
};
