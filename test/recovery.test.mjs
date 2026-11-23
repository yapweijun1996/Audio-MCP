import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const enabled = process.env.AUDIO_MCP_TEST_PRODUCTION === "1" || process.env.AUDIO_MCP_TEST_RENDER === "1";
const server = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const preload = new URL("./fixtures/interrupt-publish.mjs", import.meta.url).href;

test("retry after a killed publisher rolls back only its partial cue", { skip: !enabled }, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "audio-publish-recovery-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  async function connect(nodeArgs = []) {
    const transport = new StdioClientTransport({ command: process.execPath, args: [...nodeArgs, server],
      env: { AUDIO_MCP_WORKSPACE: root } });
    const client = new Client({ name: "recovery-test", version: "1" });
    await client.connect(transport);
    t.after(() => client.close());
    return { client, transport };
  }
  const args = { bars: 8, bpm: 128, seed: 42, include_stems: true };
  const produce = client => client.callTool({ name: "audio_produce_music", arguments: args }, undefined, { timeout: 120000 });
  const interrupted = await connect(["--import", preload]);
  const sfx = await interrupted.client.callTool({ name: "audio_generate_sfx", arguments: { effect: "click" } });
  const keep = sfx.structuredContent.assets[0];
  const original = await readFile(keep.path);
  const pending = produce(interrupted.client);
  let earlyError;
  pending.then(reply => { earlyError = new Error(JSON.stringify(reply.content)); }, error => { earlyError = error; });
  let part;
  const deadline = Date.now() + 120000;
  while (!part) {
    if (earlyError) throw earlyError;
    assert.ok(Date.now() < deadline, "Interrupted publication checkpoint was never reached");
    const dir = (await readdir(root)).find(name => name.startsWith(".produce-"));
    if (dir && (await readdir(join(root, dir))).includes("paused-after-master")) {
      part = await readFile(join(root, dir, "paused-after-master"), "utf8");
    } else {
      await pause(30);
    }
  }
  assert.ok((await readdir(root)).includes(part));
  const disconnected = assert.rejects(pending);
  process.kill(interrupted.transport.pid, "SIGKILL");
  await disconnected;

  // Another live process and older unowned staging formats must survive this server's recovery.
  const legacy = ".produce-aBc123";
  const live = ".produce-" + process.pid + "-qWe123";
  for (const name of [legacy, live]) {
    await mkdir(join(root, name));
    await writeFile(join(root, name, "keep"), "untouched");
  }
  const { client } = await connect();
  const next = await produce(client);
  assert.ok(!next.isError, JSON.stringify(next.content));
  const assets = next.structuredContent.assets;
  assert.equal(assets.length, 6);
  assert.deepEqual(new Set(await readdir(root)), new Set([legacy, live, basename(keep.path), ...assets.map(a => basename(a.path))]));
  assert.deepEqual(await readFile(keep.path), original);
  const analyzed = await client.callTool({ name: "audio_analyze", arguments: { asset_id: keep.asset_id } });
  assert.equal(analyzed.structuredContent.silent, false);
  for (const name of [legacy, live]) assert.equal(await readFile(join(root, name, "keep"), "utf8"), "untouched");
});
