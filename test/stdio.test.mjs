import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMidi } from "midi-file";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("generate instrument MIDI and verify sound effects over stdio", async t => {
  const directory = await mkdtemp(join(tmpdir(), "audio-mcp-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, "assets");
  const client = new Client({ name: "audio-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
    env: { AUDIO_MCP_WORKSPACE: root, AUDIO_MCP_SOUNDFONT: process.env.AUDIO_MCP_SOUNDFONT || "" },
  });
  await client.connect(transport);
  t.after(() => client.close());
  const names = (await client.listTools()).tools.map(tool => tool.name);
  assert.deepEqual(names.sort(), ["audio_analyze", "audio_generate_instrument", "audio_generate_piano", "audio_generate_sfx", "audio_produce_music", "audio_render"]);
  const call = (name, args) => client.callTool({ name, arguments: args });
  const files = [];
  for (const effect of ["click", "hover", "success", "error", "whoosh"]) {
    const generated = await call("audio_generate_sfx", { effect, duration_seconds: 0.2 });
    assert.ok(!generated.isError);
    const { asset_id, path } = generated.structuredContent.assets[0];
    files.push({ asset_id, path });
    const wave = await readFile(path);
    assert.equal(wave.length, 44 + 8820 * 2);
    assert.equal(wave.toString("ascii", 8, 12), "WAVE");
    let peak = 0;
    for (let i = 44; i < wave.length; i += 2) peak = Math.max(peak, Math.abs(wave.readInt16LE(i)));
    assert.ok(peak > 0);
    const measured = (await call("audio_analyze", { asset_id })).structuredContent;
    assert.equal(measured.peak_amplitude, peak / 32768);
    assert.equal(measured.duration_seconds, 0.2);
  }
  assert.equal((await call("audio_generate_sfx", { effect: "click", duration_seconds: 100 })).isError, true);
  assert.equal((await call("audio_analyze", { asset_id: "../outside" })).isError, true);
  assert.equal((await readdir(root)).length, 5);
  async function midiAsset(tool, args) {
    const reply = await call(tool, args);
    assert.ok(!reply.isError);
    const [asset] = reply.structuredContent.assets;
    assert.equal(asset.type, "midi");
    assert.equal(asset.path, join(await realpath(root), asset.asset_id + ".mid"));
    return readFile(asset.path);
  }
  const piano = args => midiAsset("audio_generate_piano", args);
  const bytes = await piano({});
  assert.deepEqual(await piano({ seed: 1 }), bytes);
  assert.notDeepEqual(await piano({ seed: 2 }), bytes);
  for (const [data, duration, bpm] of [[bytes, 30, 80], [await piano({ duration_seconds: 1.37, bpm: 137 }), 1.37, 137]]) {
    const midi = parseMidi(data);
    const [conductor, ...hands] = midi.tracks;
    const tempo = conductor.find(e => e.type === "setTempo").microsecondsPerBeat;
    assert.equal(tempo, Math.round(60_000_000 / bpm));
    assert.equal(midi.header.format, 1);
    assert.equal(hands.length, 2);
    for (const [channel, track] of hands.entries()) {
      assert.deepEqual(track.filter(e => e.type === "programChange").map(e => e.programNumber), [0]);
      assert.ok(track.every(e => e.channel === undefined || e.channel === channel));
      const notes = track.filter(e => e.type === "noteOn" || e.type === "noteOff");
      assert.ok(notes.length >= 2);
      for (let i = 0; i < notes.length; i += 2) {
        assert.equal(notes[i].type, "noteOn");
        assert.equal(notes[i + 1].type, "noteOff");
        assert.equal(notes[i].noteNumber, notes[i + 1].noteNumber);
        assert.ok(notes[i + 1].deltaTime > 0);
      }
      const ticks = track.reduce((sum, event) => sum + event.deltaTime, 0);
      assert.ok(Math.abs(ticks * tempo / midi.header.ticksPerBeat / 1e6 - duration) < 0.002);
    }
  }
  assert.equal((await call("audio_generate_piano", { bpm: 0 })).isError, true);
  for (const [instrument, program, count] of [
    ["nylon_guitar", 24, 9], ["finger_bass", 33, 5], ["flute", 73, 5],
  ]) {
    await t.test(instrument, async () => {
      const args = { instrument, duration_seconds: 2.125, bpm: 120, seed: 42 };
      const data = await midiAsset("audio_generate_instrument", args);
      assert.deepEqual(await midiAsset("audio_generate_instrument", args), data);
      const { header, tracks } = parseMidi(data);
      assert.equal(header.format, 1);
      assert.equal(tracks.length, 2);
      const [conductor, part] = tracks;
      assert.equal(conductor.find(e => e.type === "setTempo").microsecondsPerBeat, 500000);
      assert.deepEqual(part.filter(e => e.type === "programChange").map(e => e.programNumber), [program]);
      const notes = part.filter(e => e.type === "noteOn" || e.type === "noteOff");
      assert.equal(notes.length, count * 2);
      for (let i = 0; i < notes.length; i += 2) {
        const [on, off] = notes.slice(i, i + 2);
        assert.equal(on.type, "noteOn");
        assert.equal(off.type, "noteOff");
        assert.equal(on.noteNumber, off.noteNumber);
        assert.ok(on.velocity > 0 && off.deltaTime > 0);
        assert.equal(on.deltaTime, 0);
      }
      for (const track of tracks) {
        assert.equal(track.reduce((sum, e) => sum + e.deltaTime, 0), header.ticksPerBeat * 4.25);
      }
      const pitches = notes.filter(e => e.type === "noteOn").map(e => e.noteNumber);
      if (instrument === "nylon_guitar") assert.deepEqual(pitches.slice(0, 4), [60, 64, 67, 64]);
      if (instrument === "finger_bass") assert.deepEqual(pitches.slice(0, 4), [36, 36, 43, 36]);
      if (instrument === "flute") assert.ok(pitches.every(pitch => pitch >= 60 && pitch <= 96));
    });
  }
  for (const [instrument, pattern] of [
    ["marimba"], ["cello_ensemble"], ["acoustic_drums", "backbeat"],
    ["acoustic_drums", "half_time"], ["acoustic_drums", "swing"],
  ]) {
    await t.test([instrument, pattern].filter(Boolean).join(" "), async () => {
      const args = { instrument, pattern, duration_seconds: 2.4, bpm: 100, seed: 42 };
      const generated = await call("audio_generate_instrument", args);
      assert.ok(!generated.isError);
      const [asset] = generated.structuredContent.assets;
      const data = await readFile(asset.path);
      assert.deepEqual(await midiAsset("audio_generate_instrument", args), data);
      const { header, tracks: [conductor, part] } = parseMidi(data);
      assert.equal(conductor.find(e => e.type === "setTempo").microsecondsPerBeat, 600000);
      const beat = header.ticksPerBeat;
      let time = 0;
      const starts = [];
      for (const event of part) {
        time += event.deltaTime;
        if (event.type === "noteOn") starts.push({ time, key: event.noteNumber, channel: event.channel });
      }
      assert.equal(time, 4 * beat);
      if (instrument === "acoustic_drums") {
        assert.equal(generated.structuredContent.pattern, pattern);
        assert.ok(starts.every(n => n.channel === 9));
        const hat = starts.filter(n => n.key === 42);
        assert.equal(hat.length, 8);
        assert.equal(hat[1].time, pattern === "swing" ? 2 * beat / 3 : beat / 2);
        const snare = starts.filter(n => n.key === 38).map(n => n.time);
        assert.deepEqual(snare, pattern === "half_time" ? [2 * beat] : [beat, 3 * beat]);
        if (pattern === "backbeat") {
          assert.deepEqual(await midiAsset("audio_generate_instrument", { ...args, pattern: undefined }), data);
        }
      } else {
        const marimba = instrument === "marimba";
        assert.equal(part.find(e => e.type === "programChange").programNumber, marimba ? 12 : 42);
        assert.equal(starts.length, marimba ? 8 : 2);
        assert.equal(starts[1].time, marimba ? beat / 2 : 2 * beat);
      }
      if (process.env.AUDIO_MCP_TEST_RENDER === "1") {
        const rendered = await call("audio_render", { asset_id: asset.asset_id });
        assert.ok(!rendered.isError, JSON.stringify(rendered.content));
        const [wav] = rendered.structuredContent.assets;
        const measured = (await call("audio_analyze", { asset_id: wav.asset_id })).structuredContent;
        assert.equal(measured.channels, 2);
        assert.equal(measured.duration_seconds, 2.4);
        assert.ok(measured.peak_amplitude > 0.01 && measured.peak_amplitude < 1);
      }
    });
  }
  for (const args of [{ instrument: "marimba", pattern: "swing" }, { instrument: "acoustic_drums", pattern: "unknown" }]) {
    assert.equal((await call("audio_generate_instrument", args)).isError, true);
  }
  assert.equal((await call("audio_generate_instrument", { instrument: "unknown" })).isError, true);
  assert.equal((await call("audio_render", { asset_id: "../outside" })).isError, true);
  assert.equal((await call("audio_render", { asset_id: files[0].asset_id })).isError, true);
  if (process.env.AUDIO_MCP_TEST_RENDER === "1") {
    const generated = await call("audio_generate_piano", { duration_seconds: 1.37, bpm: 137 });
    const { asset_id } = generated.structuredContent.assets[0];
    const rendered = await call("audio_render", { asset_id });
    assert.ok(!rendered.isError, JSON.stringify(rendered.content));
    const [wav] = rendered.structuredContent.assets;
    const measured = (await call("audio_analyze", { asset_id: wav.asset_id })).structuredContent;
    assert.equal(measured.channels, 2);
    assert.equal(measured.silent, false);
    assert.ok(Math.abs(measured.duration_seconds - 1.37) < 0.002);
    assert.equal((await readFile(wav.path)).length, 44 + Math.round(measured.duration_seconds * 44100) * 4);
    assert.ok(!(await readdir(root)).some(name => name.startsWith(".render-")));
  }
  await writeFile(files[0].path, "broken");
  assert.equal((await call("audio_analyze", { asset_id: files[0].asset_id })).isError, true);
  if (process.platform !== "win32") {
    await rm(files[0].path);
    await symlink(files[1].path, files[0].path);
    assert.equal((await call("audio_analyze", { asset_id: files[0].asset_id })).isError, true);
  }
});
