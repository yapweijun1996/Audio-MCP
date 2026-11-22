#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { analyze, effects, synthesize } from "./audio.js";

const configuredRoot = resolve(process.env.AUDIO_MCP_WORKSPACE || "audio-assets");
await mkdir(configuredRoot, { recursive: true, mode: 0o700 });
const root = await realpath(configuredRoot);
const server = new McpServer({ name: "audio-mcp", version: "0.1.0" });

function result(value: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value };
}

server.registerTool("audio_generate_sfx", {
  description: "Generate an offline UI sound effect as a mono PCM WAV. Returns its local path and asset ID.",
  inputSchema: { effect: z.enum(effects), duration_seconds: z.number().min(0.02).max(3).optional() },
}, async ({ effect, duration_seconds }) => {
  const wav = synthesize(effect, duration_seconds);
  const validation = analyze(wav);
  const asset_id = randomUUID();
  const path = join(root, asset_id + ".wav");
  const temporary = path + ".tmp";
  await writeFile(temporary, wav, { flag: "wx", mode: 0o600 }).catch(async error => {
    if (error.code !== "EEXIST") await rm(temporary, { force: true });
    throw error;
  });
  try {
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return result({ status: "completed", assets: [{ asset_id, type: "wav", path }], validation });
});

server.registerTool("audio_analyze", {
  description: "Measure a previously generated WAV by its asset ID in the configured workspace.",
  inputSchema: { asset_id: z.uuid() },
}, async ({ asset_id }) => {
  const path = join(root, asset_id + ".wav");
  if (await realpath(path) !== path) throw new Error("Expected a regular workspace asset");
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 44 + 3 * 44100 * 2) throw new Error("Unsupported asset");
    return result({ asset_id, ...analyze(await file.readFile()) });
  } finally {
    await file.close();
  }
});

await server.connect(new StdioServerTransport());
