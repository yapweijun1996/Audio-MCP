import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseMidi } from "midi-file";

const run = promisify(execFile);
const script = fileURLToPath(new URL("../scripts/render-editor-pack.mjs", import.meta.url));
const rate = 48_000;
const roles = ["drums", "bass", "keys", "lead"];
const sample = (wav, frame, channel = 0) => wav.readIntLE(44 + 6 * frame + 3 * channel, 3) / 8388608;

test("editor pack rejects an invalid seed and preserves an existing destination", async t => {
  const root = await mkdtemp(join(tmpdir(), "editor-pack-existing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "original"), "keep");
  await assert.rejects(run(process.execPath, [script, root, "-1"]), error => error.code === 2);
  await assert.rejects(run(process.execPath, [script, root]), /Already exists/);
  assert.deepEqual(await readdir(root), ["original"]);
  assert.equal(await readFile(join(root, "original"), "utf8"), "keep");
});

// Gain-independent waveform agreement checks the actual recorded performance through mastering.
function correlation(a, b, first, last) {
  let cross = 0, powerA = 0, powerB = 0;
  for (let frame = first; frame < last; frame += 8) {
    const x = a(frame), y = b(frame);
    cross += x * y;
    powerA += x * x;
    powerB += y * y;
  }
  return cross / Math.sqrt(powerA * powerB);
}

test("editor pack preserves the hook, both splice positions, final cadence and narration mix", {
  skip: process.env.AUDIO_MCP_TEST_PRODUCTION !== "1",
}, async t => {
  const root = await mkdtemp(join(tmpdir(), "editor-pack-render-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pack = join(root, "delivery");
  await run(process.execPath, [script, pack, "42"], { cwd: root });
  assert.deepEqual(await readdir(root), ["delivery"]);
  const manifest = JSON.parse(await readFile(join(pack, "manifest.json"), "utf8"));
  const lock = await readFile(new URL("../package-lock.json", import.meta.url));
  assert.equal(manifest.build.package_lock_sha256, createHash("sha256").update(lock).digest("hex"));
  for (const module of ["audio", "midi", "score", "score-worker", "acoustic-drums", "sample-bank", "produce", "program"]) {
    const bytes = await readFile(new URL(`../dist/${module}.js`, import.meta.url));
    assert.equal(manifest.build.module_sha256[module], createHash("sha256").update(bytes).digest("hex"));
  }
  assert.equal(manifest.request.seed, 42);
  assert.deepEqual(manifest.cutdown_source_bars, [[5, 8], [11, 12], [15, 16]]);
  const expectedNames = ["main-30s.wav", "cutdown-15s.wav", "underscore-30s.wav", "score.mid",
    ...roles.map(role => "stems/" + role + ".wav")];
  assert.deepEqual(manifest.files.map(file => file.name).sort(), expectedNames.sort());
  const waves = {};
  for (const file of manifest.files) {
    const data = await readFile(join(pack, file.name));
    assert.equal(createHash("sha256").update(data).digest("hex"), file.sha256);
    if (file.name === "score.mid") {
      const { header, tracks } = parseMidi(data);
      assert.deepEqual(tracks.slice(1).map(track => track[0].text), roles);
      assert.equal(tracks[0].reduce((ticks, event) => ticks + event.deltaTime, 0), header.ticksPerBeat * 64);
      continue;
    }
    const seconds = file.role === "cutdown" ? 15 : 30;
    assert.equal(data.length, 44 + seconds * rate * 6);
    assert.equal(data.readUInt32LE(24), rate);
    assert.equal(data.readUInt16LE(34), 24);
    assert.equal(data.readUInt16LE(22), 2);
    waves[file.role] = data;
    for (const channel of [0, 1]) {
      assert.ok(Math.abs(sample(data, seconds * rate - 1, channel)) < 0.0002, "Tail for " + file.name);
    }
    if (!roles.includes(file.role)) {
      const target = file.role === "underscore" ? -20 : -14;
      assert.ok(Math.abs(file.integrated_lufs - target) <= 1);
      assert.ok(file.true_peak_dbtp <= -1);
    }
  }
  // Inspect intervals after each splice, including the original bar-16 resolution.
  for (const channel of [0, 1]) {
    for (const [first, last, sourceOffset] of [[0.1, 7.4, 7.5], [7.52, 11.2, 11.25], [11.27, 14.8, 15]]) {
      const result = correlation(i => sample(waves.cutdown, i, channel),
        i => sample(waves.master, i + sourceOffset * rate, channel), Math.round(first * rate), Math.round(last * rate));
      assert.ok(result > 0.97, "Cutdown source correlation " + result + " at " + first);
    }
    for (const offset of [7.5, 11.25]) {
      const frame = offset * rate;
      for (const edge of [frame - 240, frame]) {
        const jump = Math.abs(sample(waves.cutdown, edge, channel) - sample(waves.cutdown, edge - 1, channel));
        assert.ok(jump < 0.08, "Splice discontinuity " + jump + " at " + edge);
      }
    }
    const bed = correlation(i => sample(waves.underscore, i, channel),
      i => 0.75 * sample(waves.drums, i, channel) + 0.85 * sample(waves.bass, i, channel) +
        0.50 * sample(waves.keys, i, channel), rate * 8, rate * 23);
    assert.ok(bed > 0.97, "Underscore source correlation " + bed);
  }
});
