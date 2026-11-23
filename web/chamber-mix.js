import { chamberBanks } from "bank:assets";

const rate = 44100;
const programVoice = { 0: "piano", 24: "guitar", 33: "electric", 32: "bass", 40: "violin", 42: "cello", 73: "flute" };
const position = { piano: -.06, guitar: 0, electric: 0, violin: -.26, cello: .24, bass: .13, flute: -.12 };
const release = { piano: .62, guitar: .34, electric: .24, violin: .28, cello: .36, bass: .33, flute: .23 };
function plan(notes) {
  const selected = new Map(), requests = {};
  for (const note of notes) {
    const voice = programVoice[note.program], bank = chamberBanks[voice];
    const closest = bank.rows.reduce((a, b) =>
      Math.abs(a.key - note.key) <= Math.abs(b.key - note.key) ? a : b).key;
    const layers = bank.rows.filter(z => z.key === closest).sort((a, b) => a.layer - b.layer);
    const level = layers.length < 3 ? Number(note.velocity >= 74) :
      (note.velocity < 66 ? 0 : note.velocity < 88 ? 1 : 2);
    const z = layers[Math.min(layers.length - 1, level)];
    const id = voice + "/" + z.offset;
    Object.assign(note, { voice, region: z, id });
    if (!selected.has(id)) {
      (requests[bank.url] ??= []).push({ id, offset: z.offset, bytes: z.bytes, frames: z.frames });
      selected.set(id, true);
    }
  }
  return requests;
}

function mixRoom(left, right, film) {
  // Four damped, mutually coupled delay lines give the separate sessions a
  // shared early field. The shorter café decay leaves room around each attack.
  const lines = [1367, 1789, 2027, 2459].map(n => new Float32Array(n));
  const heads = [0, 0, 0, 0], damp = new Float32Array(4);
  const feedback = film ? .65 : .47, wet = film ? .16 : .105;
  for (let i = 0; i < left.length; i++) {
    let total = 0;
    for (let j = 0; j < 4; j++) {
      damp[j] += .42 * (lines[j][heads[j]] - damp[j]);
      total += damp[j];
    }
    for (let j = 0; j < 4; j++) {
      lines[j][heads[j]] = (j % 2 ? right[i] : left[i]) * .55 + feedback * (.5 * total - damp[j]);
      if (++heads[j] === lines[j].length) heads[j] = 0;
    }
    left[i] += wet * (damp[0] + damp[2]);
    right[i] += wet * (damp[1] + damp[3]);
  }
}

export async function mixChamber(notes, frames, style, load) {
  const recordings = await load(plan(notes));
  const left = new Float32Array(frames), right = new Float32Array(frames);
  const ensemble = style === "film_chamber" || style === "cafe_duet";
  for (const n of notes) {
    const { voice, region: z } = n, [l, r] = recordings[n.id];
    const step = 32000 / rate * 2 ** ((n.key - z.key + z.cents / 100) / 12);
    const first = Math.round(n.start * rate), gate = Math.round((n.end - n.start) * rate);
    const tail = Math.round(release[voice] * rate);
    const count = Math.min(frames - first, Math.floor((l.length - 1) / step), gate + tail);
    const pan = ensemble ? position[voice] : 0;
    const balance = ensemble ? { piano: .94, violin: .81, cello: .65, bass: .91 }[voice] : 1;
    const gain = z.gain * balance * (n.velocity / 90) ** 1.55;
    const gl = gain * Math.sqrt(1 - pan), gr = gain * Math.sqrt(1 + pan);
    const bowed = voice === "violin" || voice === "cello";
    for (let i = 0; i < count; i++) {
      const p = i * step, k = Math.floor(p), f = p - k;
      const env = (i < gate ? 1 : (1 - (i - gate) / tail) ** 2) *
        (bowed ? .90 + .10 * Math.sin(Math.PI * Math.min(1, i / gate)) : 1);
      left[first+i] += (l[k] + (l[k+1] - l[k]) * f) * gl * env;
      right[first+i] += (r[k] + (r[k+1] - r[k]) * f) * gr * env;
    }
  }
  mixRoom(left, right, style === "film_chamber");
  return [left, right];
}
