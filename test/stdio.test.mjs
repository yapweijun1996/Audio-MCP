import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMidi } from "midi-file";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("generate piano MIDI and verify sound effects over stdio", async t => {
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
  assert.deepEqual(names.sort(), ["audio_analyze", "audio_generate_piano", "audio_generate_sfx", "audio_produce_music", "audio_render"]);
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
