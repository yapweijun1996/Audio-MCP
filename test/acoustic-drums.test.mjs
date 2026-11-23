import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { bundledBankURL, readSampleBank } from "../dist/sample-bank.js";
import { renderAcousticDrums } from "../dist/acoustic-drums.js";

test("Velvet Keys alternates recorded kicks and plays distinct snare and hat articulations", async () => {
  const rate = 48000;
  const stroke = (tick, pitch, velocity) => ({ tick, pitch, velocity, length: 1, pan: 0 });
  const notes = [
    stroke(0, 36, 90), stroke(1, 36, 90), stroke(2, 36, 90),
    stroke(3, 38, 38), stroke(4, 38, 86),
    stroke(5, 42, 45), stroke(6, 42, 58), stroke(7, 46, 58),
  ];
  const buffer = new Float32Array(8 * rate * 2);
  await renderAcousticDrums(buffer, notes, 1, rate, 17);
  const attack = n => buffer.subarray(n * rate * 2, n * rate * 2 + 4096);
  function correlation(a, b) {
    let aa = 0, bb = 0, ab = 0;
    for (let i = 0; i < a.length; i++) {
      aa += a[i] * a[i];
      bb += b[i] * b[i];
      ab += a[i] * b[i];
    }
    assert.ok(aa > 0 && bb > 0);
    return ab / Math.sqrt(aa * bb);
  }
  assert.deepEqual(attack(0), attack(2));
  assert.notDeepEqual(attack(0), attack(1));
  const { pcm, zones } = readSampleBank(await readFile(bundledBankURL));
  const expectedStrokes = [[36, 127], [36, 70], [36, 127], [38, 70], [38, 127],
    [42, 70], [42, 127], [46, 127]];
  for (const [n, [pitch, loud]] of expectedStrokes.entries()) {
    const sample = zones.find(z => z.instrument === "drums" && z.root === pitch && z.loud === loud);
    // Every third 48 kHz frame lands exactly on every second original 32 kHz recording frame.
    const original = Float32Array.from({ length: 512 }, (_, i) => pcm.readInt16LE(2 * (sample.start + 2 * i)));
    const rendered = Float32Array.from({ length: 512 }, (_, i) => buffer[2 * (n * rate + 3 * i)]);
    assert.ok(correlation(original, rendered) > 0.99999, "stroke " + n + " matches its source take");
  }
  assert.ok(Math.max(...attack(3)) < Math.max(...attack(4)), "ghost snare stays softer");

  const choke = new Float32Array(rate * 2);
  await renderAcousticDrums(choke, [stroke(0, 46, 80), stroke(1, 42, 0)], 0.1, rate, 17);
  assert.ok(choke.subarray(0, rate / 5).some(v => v !== 0));
  assert.ok(choke.subarray(Math.ceil(0.112 * rate) * 2).every(v => v === 0));
});
