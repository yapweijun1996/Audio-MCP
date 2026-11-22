# Audio MCP

Audio MCP gives coding agents local tools for producing audio assets. The project goal is to let an agent compose, edit, verify, and export music and sound effects for apps, games, and videos.

Version 0.1.0 implements the first workflow: generate a short UI sound, check its audio properties, and hand the client a playable WAV file. The TypeScript server communicates over MCP stdio and synthesizes the waveform locally. After installation, this workflow runs offline without API keys, external codecs, or sample downloads.

## Build and verify

Use Node.js 22 or later and npm. Run these commands in the checkout.

```sh
npm ci
npm test
```

The test builds the server, launches it as a child process, discovers its tools and checks the generated audio. To build without running tests, use `npm run build`.

## Connect a client

Launch the compiled entry point directly so stdout carries only protocol messages. Replace the example paths with absolute local paths. Use a private, writable directory for generated assets.

```sh
codex mcp add audio-mcp --env AUDIO_MCP_WORKSPACE=/absolute/path/to/audio-assets -- node /absolute/path/to/Audio-MCP/dist/index.js
```

Open a new Codex CLI session and ask: “Use audio-mcp to generate a 0.45-second success sound, analyze it, and give me the WAV path.” This workflow has been exercised with Codex CLI on macOS.

For clients using JSON configuration, including Claude Code project configurations:

```json
{
  "mcpServers": {
    "audio-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/Audio-MCP/dist/index.js"],
      "env": { "AUDIO_MCP_WORKSPACE": "/absolute/path/to/audio-assets" }
    }
  }
}
```

With no environment override, the server uses an `audio-assets` directory under its working directory. WAV files persist across server restarts. Remove unwanted files from that directory to reclaim disk space.

## Tools

| Tool | Input | Result |
| --- | --- | --- |
| audio_generate_sfx | Required `effect` (click, hover, success, error, whoosh). Optional `duration_seconds` from 0.02 to 3. | A 44.1 kHz mono 16-bit PCM WAV, its absolute path, asset ID and measured audio properties. |
| audio_analyze | Required `asset_id` from a generation result. | Duration, sample rate, channels, normalized peak amplitude and a digital silence flag. |

For example, call `audio_generate_sfx` with `{"effect":"success","duration_seconds":0.45}`, then pass the returned `assets[0].asset_id` to `audio_analyze`. Calls return structured content and equivalent JSON text. Invalid inputs and unreadable assets produce MCP errors.

## Development

- [Server entry point](src/index.ts) registers the tools, validates inputs, and manages workspace files.
- [Audio engine](src/audio.ts) owns the five synthesis presets, PCM encoding, and analysis.
- [Stdio integration test](test/stdio.test.mjs) launches the compiled server through the MCP SDK client. It checks all five effects, compares measured peaks with the samples on disk, and exercises invalid inputs and damaged files.

## V1 roadmap

| Area | Planned outcome |
| --- | --- |
| Composition and MIDI | Generate editable MIDI and piano-only pieces with reproducible presets and instrument selection. |
| Audio production | Render background music, create seamless loops, trim, fade, normalize, mix, and export additional formats. |
| Long renders | Run rendering in a worker with progress, cancellation, and timeouts. |
| Release verification | Exercise the supported workflows on macOS, Linux, and Windows and audit the distribution licenses of dependencies and sound assets before claiming commercial readiness. |
