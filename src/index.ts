#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { analyze, effects, synthesize } from "./audio.js";
import { composePiano } from "./piano.js";

import { renderPiano, maxRenderSeconds } from "./render.js";

const configuredRoot = resolve(process.env.AUDIO_MCP_WORKSPACE || "audio-assets");
await mkdir(configuredRoot, { recursive: true, mode: 0o700 });
const root = await realpath(configuredRoot);
const server = new McpServer({ name: "audio-mcp", version: "0.1.0" });

function result(value: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value };
}

async function saveAsset(extension: "wav" | "mid", bytes: Buffer) {
  const asset_id = randomUUID();
  const path = join(root, asset_id + "." + extension);
  const temporary = path + ".tmp";
  await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 }).catch(async error => {
    if (error.code !== "EEXIST") await rm(temporary, { force: true });
    throw error;
  });
  try {
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return { asset_id, type: extension === "mid" ? "midi" : "wav", path };
}

const midiOptions = {
  duration_seconds: z.number().min(1).max(300).default(30),
  bpm: z.number().int().min(40).max(240).default(80),
  seed: z.number().int().min(0).max(0xffffffff).default(1),
};

server.registerTool("audio_generate_piano", {
  description: "Compose an editable C major solo piano MIDI with right and left hand tracks.",
  inputSchema: midiOptions,
}, async ({ duration_seconds, bpm, seed }) => {
  const asset = await saveAsset("mid", composePiano(duration_seconds, bpm, seed));
  return result({ status: "completed", assets: [asset], duration_seconds, bpm, seed });
});

server.registerTool("audio_generate_sfx", {
  description: "Generate an offline UI sound effect as a mono PCM WAV. Returns its local path and asset ID.",
  inputSchema: { effect: z.enum(effects), duration_seconds: z.number().min(0.02).max(3).optional() },
}, async ({ effect, duration_seconds }) => {
  const wav = synthesize(effect, duration_seconds);
  const validation = analyze(wav);
  const asset = await saveAsset("wav", wav);
  return result({ status: "completed", assets: [asset], validation });
});

async function readAsset(asset_id: string, extension: ".wav" | ".mid", limit: number) {
  const path = join(root, asset_id + extension);
  if (await realpath(path) !== path) throw new Error("Expected a regular workspace asset");
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error("Unsupported asset");
    return await file.readFile();
  } finally {
    await file.close();
  }
}

let rendering = false;
server.registerTool("audio_render", {
  description: "Render an audio_generate_piano MIDI asset to a stereo PCM WAV using the local sound bank.",
  inputSchema: { asset_id: z.uuid() },
}, async ({ asset_id }, { signal }) => {
  if (rendering) throw new Error("A render is already running. Retry when it completes.");
  rendering = true;
  try {
    const midi = await readAsset(asset_id, ".mid", 128 * 1024);
    const { wav, validation } = await renderPiano(root, midi, signal);
    const asset = await saveAsset("wav", wav);
    return result({ status: "completed", source_asset_id: asset_id, assets: [asset], validation });
  } finally {
    rendering = false;
  }
});

server.registerTool("audio_analyze", {
  description: "Measure a previously generated WAV by its asset ID in the configured workspace.",
  inputSchema: { asset_id: z.uuid() },
}, async ({ asset_id }) => {
  const wav = await readAsset(asset_id, ".wav", 44 + Math.ceil(maxRenderSeconds * 44100) * 4);
  return result({ asset_id, ...analyze(wav) });
});

await server.connect(new StdioServerTransport());
