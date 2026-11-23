import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseMidi } from "midi-file";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { analyze } from "../dist/audio.js";
import { composeScore, scoreMidi } from "../dist/score.js";

test("editable scores preserve form, seed and polyphonic note lengths", () => {
  for (const style of ["velvet_keys", "night_drive"]) {
    const score = composeScore(style, 16, 42, 100);
    assert.deepEqual(score.sections.map(s => s.start_bar), [1, 5, 9, 13]);
    const bytes = scoreMidi(score);
    assert.deepEqual(bytes, scoreMidi(composeScore(style, 16, 42, 100)));
    assert.notDeepEqual(bytes, scoreMidi(composeScore(style, 16, 43, 100)));
    const { header, tracks } = parseMidi(bytes);
    assert.equal(header.format, 1);
    assert.equal(tracks.length, 5);
    assert.equal(tracks[0].at(-1).deltaTime, 16 * 4 * header.ticksPerBeat);
    assert.deepEqual(tracks.slice(1).map(track => track[0].text), ["drums", "bass", "keys", "lead"]);
    for (const track of tracks.slice(1)) {
      const active = new Set();
      let tick = 0;
      for (const event of track) {
        tick += event.deltaTime;
        if (event.type === "noteOn") {
          assert.ok(!active.has(event.noteNumber));
          active.add(event.noteNumber);
        } else if (event.type === "noteOff") {
          assert.ok(active.delete(event.noteNumber));
        }
      }
      assert.equal(active.size, 0);
      assert.ok(tick <= 16 * 4 * header.ticksPerBeat);
    }
  }
});

test("arrangements keep a recurring call and leave space for a contrasting answer", () => {
  for (const style of ["velvet_keys", "night_drive"]) {
    for (const seed of [0, 17, 42, 0xffffffff]) {
      const { parts, ticks } = composeScore(style, 16, seed, 100);
      const barTicks = ticks / 16;
      function onsets(part, bar) {
        return [...new Set(parts[part].filter(n => Math.floor(n.tick / barTicks) === bar)
          .map(n => Math.round((n.tick % barTicks) * 16 / barTicks)))].sort((a, b) => a - b);
      }
      const bars = Array.from({ length: 8 }, (_, i) => i + 4);
      for (const part of ["lead", "bass", "keys"]) {
        assert.ok(new Set(bars.map(bar => onsets(part, bar).join(","))).size >= 3, style + " " + part);
      }
      assert.deepEqual(onsets("lead", 4).slice(0, 2), onsets("lead", 6).slice(0, 2));
      assert.ok(onsets("lead", 7).length < onsets("lead", 4).length);
      if (style === "night_drive") {
        const kicks = parts.drums.filter(n => n.pitch === 36 && Math.floor(n.tick / barTicks) === 4);
        assert.deepEqual(kicks.map(n => Math.round(n.tick * 4 / barTicks) % 4), [0, 1, 2, 3]);
      }
    }
  }
});

test("the lift changes bass direction and the penultimate bar resolves in each style", () => {
  for (const style of ["velvet_keys", "night_drive"]) {
    const driving = style === "night_drive";
    for (const bars of [8, 16, 32]) {
      for (const seed of [0, 1, 2, 3, 17, 42, 0x10002, 0xffffffff]) {
        const { parts, ticks } = composeScore(style, bars, seed, 100);
        const barTicks = ticks / bars;
        const notesAt = (part, bar) => parts[part].filter(n => Math.floor(n.tick / barTicks) === bar)
          .sort((a, b) => a.tick - b.tick);
        const finalBass = notesAt("bass", bars - 1)[0];
        assert.equal(finalBass.tick, ticks - barTicks);
        const roots = driving ? [-5, -4, -2, 2] : [5, 4, 2, -5];
        for (let i = 0; i < Math.min(4, bars / 4); i++) {
          assert.equal(notesAt("bass", bars / 2 + i)[0].pitch - finalBass.pitch, roots[i]);
        }
        const answer = notesAt("lead", bars / 2 + 1).map(n => n.pitch);
        assert.equal(answer.length, 3);
        assert.ok(driving ? answer[0] < answer[1] && answer[1] < answer[2] :
          answer[0] > answer[1] && answer[1] > answer[2]);
        const tonicLead = finalBass.pitch + 36;
        assert.deepEqual(notesAt("lead", bars - 2).map(n => n.pitch - tonicLead), driving ? [-5, -1] : [-4, -5]);
        assert.equal(notesAt("lead", bars - 1)[0].pitch, tonicLead);
        if (driving) {
          const keys = notesAt("keys", bars - 2);
          const intervals = notes => notes.map(n => n.pitch - finalBass.pitch).sort((a, b) => a - b);
          assert.deepEqual(intervals(keys.slice(0, 4)), [17, 20, 24, 26]);
          assert.deepEqual(intervals(keys.slice(4)), [17, 20, 23, 26]);
        }
        for (const notes of Object.values(parts)) {
          const ends = new Map();
          for (const n of [...notes].sort((a, b) => a.tick - b.tick)) {
            assert.ok(n.pitch >= 0 && n.pitch <= 127 && n.length > 0 && n.tick + n.length <= ticks);
            assert.ok(n.tick >= (ends.get(n.pitch) ?? 0), "Overlapping note at pitch " + n.pitch);
            ends.set(n.pitch, n.tick + n.length);
          }
        }
      }
    }
  }
});

test("analysis reads signed 24-bit stereo PCM", () => {
  const header = Buffer.from("524946462a00000057415645666d7420100000000100020080bb000000650400060018006461746106000000", "hex");
  const data = Buffer.concat([header, Buffer.from("000080ffff7f", "hex")]);
  assert.equal(analyze(data).peak_amplitude, 1);
  assert.equal(analyze(data).duration_seconds, 1 / 48000);
  data.writeUInt16LE(20, 34);
  assert.throws(() => analyze(data), /unsupported/i);
});

const renderEnabled = process.env.AUDIO_MCP_TEST_PRODUCTION === "1" || process.env.AUDIO_MCP_TEST_RENDER === "1";
async function openClient(root, env = {}) {
  const client = new Client({ name: "production-test", version: "1" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
    env: { AUDIO_MCP_WORKSPACE: root, ...env },
  }));
  return client;
}
async function until(check) {
  const deadline = Date.now() + 15000;
  while (!await check()) {
    if (Date.now() >= deadline) assert.fail("Timed out waiting for the workspace state");
    await pause(25);
  }
}

test("produce, cancel, reject overlap, recover and read assets over stdio", { skip: !renderEnabled }, async t => {
  const root = await mkdtemp(join(tmpdir(), "music-e2e-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const client = await openClient(root);
  t.after(() => client.close());
  const produce = (args, options = {}) => client.callTool({ name: "audio_produce_music", arguments: args }, undefined,
    { timeout: 120000, ...options });
  assert.equal((await produce({ bars: 7 })).isError, true);
  const controller = new AbortController();
  const pending = produce({ bars: 32, include_stems: true }, { signal: controller.signal });
  const cancelled = assert.rejects(pending);
  await until(async () => {
    const dir = (await readdir(root)).find(name => name.startsWith(".produce-"));
    return dir && (await readdir(join(root, dir))).includes("drums.wav");
  });
  const busy = await produce({ bars: 8 });
  assert.ok(busy.isError);
  assert.match(busy.content[0].text, /already running/);
  controller.abort();
  await cancelled;
  await until(async () => (await readdir(root)).length === 0);
  for (const [style, target, stems] of [["velvet_keys", -16, false], ["night_drive", -14, true]]) {
    const response = await produce({ style, bars: 8, bpm: 120, seed: 9, include_stems: stems });
    assert.ok(!response.isError, JSON.stringify(response.content));
    const { assets, validation } = response.structuredContent;
    assert.ok(Math.abs(validation.integrated_lufs - target) <= 1);
    assert.ok(validation.true_peak_dbtp <= -1);
    assert.deepEqual(assets.map(a => a.role), stems ? ["master", "score", "drums", "bass", "keys", "lead"] : ["master", "score"]);
    for (const asset of assets) {
      const file = await readFile(asset.path);
      if (asset.type === "midi") {
        assert.equal(parseMidi(file).tracks.length, 5);
        continue;
      }
      assert.equal(file.readUInt16LE(34), 24);
      assert.equal(file.readUInt32LE(24), 48000);
      assert.equal(file.length, 44 + 16 * 48000 * 6);
      const reply = await client.callTool({ name: "audio_analyze", arguments: { asset_id: asset.asset_id } });
      assert.equal(reply.structuredContent.silent, false);
      assert.equal(reply.structuredContent.duration_seconds, 16);
      assert.equal(reply.structuredContent.channels, 2);
    }
  }
  assert.equal((await readdir(root)).length, 8);
});

test("missing FFmpeg leaves no published or temporary assets", { skip: !renderEnabled }, async t => {
  const root = await mkdtemp(join(tmpdir(), "music-missing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const client = await openClient(root, { PATH: root });
  t.after(() => client.close());
  const result = await client.callTool({ name: "audio_produce_music", arguments: { bars: 8, bpm: 128 } });
  assert.ok(result.isError);
  assert.match(result.content[0].text, /Install ffmpeg/);
  assert.deepEqual(await readdir(root), []);
});
