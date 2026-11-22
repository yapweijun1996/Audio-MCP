import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("discover, generate and measure WAVs over stdio", async t => {
  const directory = await mkdtemp(join(tmpdir(), "audio-mcp-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, "assets");
  const client = new Client({ name: "audio-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
    env: { AUDIO_MCP_WORKSPACE: root },
  });
  await client.connect(transport);
  t.after(() => client.close());
  const names = (await client.listTools()).tools.map(tool => tool.name);
  assert.deepEqual(names.sort(), ["audio_analyze", "audio_generate_sfx"]);
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
  await writeFile(files[0].path, "broken");
  assert.equal((await call("audio_analyze", { asset_id: files[0].asset_id })).isError, true);
  if (process.platform !== "win32") {
    await rm(files[0].path);
    await symlink(files[1].path, files[0].path);
    assert.equal((await call("audio_analyze", { asset_id: files[0].asset_id })).isError, true);
  }
});
