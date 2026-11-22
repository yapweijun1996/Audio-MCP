# Audio MCP

Audio MCP gives coding agents local tools for producing audio assets. The project goal is to let an agent compose, edit, verify, and export music and sound effects for apps, games, and videos.

Generate editable MIDI for solo piano, or synthesize a short UI sound and check the resulting WAV. The TypeScript server communicates over MCP stdio and synthesizes the waveform locally. All tools run offline after setup. MIDI rendering uses local FluidSynth, FFmpeg, and a piano sound bank.

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

With no environment override, the server uses an `audio-assets` directory under its working directory. MIDI and WAV files persist across server restarts. Remove unwanted files from that directory to reclaim disk space.

## Tools

| Tool | Input | Result |
| --- | --- | --- |
| audio_generate_piano | Optional `duration_seconds` (1–300, default 30), integer `bpm` (40–240, default 80), and integer `seed` (0–4294967295, default 1). | A C major Standard MIDI File with two editable piano parts, its absolute path and asset ID. |
| audio_generate_sfx | Required `effect` (click, hover, success, error, whoosh). Optional `duration_seconds` from 0.02 to 3. | A 44.1 kHz mono 16-bit PCM WAV, its absolute path, asset ID and measured audio properties. |
| audio_render | Required `asset_id` from `audio_generate_piano`. | A stereo 44.1 kHz 16-bit PCM WAV, its asset ID, absolute path, and measured properties. |
| audio_analyze | Required `asset_id` from a WAV generation result. | Duration, sample rate, channels, normalized peak amplitude and a digital silence flag. |

For example, call `audio_generate_sfx` with `{"effect":"success","duration_seconds":0.45}`, then pass the returned `assets[0].asset_id` to `audio_analyze`. Calls return structured content and equivalent JSON text. Invalid inputs and unreadable assets produce MCP errors.

For piano, call `audio_generate_piano` with `{"duration_seconds":30,"bpm":80,"seed":42}`. Open the returned `.mid` file in a DAW or MIDI player with a General MIDI synthesizer. Both hands use acoustic grand piano. Repeating the parameters reproduces the MIDI bytes.

## Render piano MIDI to WAV

Install FluidSynth and FFmpeg and make both executables available on the MCP server's PATH. On macOS the renderer defaults to the system General MIDI DLS bank. Use a FluidSynth build with DLS support or configure a local GM-compatible SF2 bank. On other platforms set `AUDIO_MCP_SOUNDFONT` to its absolute path in the server environment. Reconnect the client after changing server configuration.

In Codex CLI, ask “Generate 30 seconds of piano, render it to WAV using audio_render, and give me the WAV path.” To reuse an existing piece, call `audio_render` with `{"asset_id":"<MIDI asset UUID>"}` in the same workspace. Use the MIDI result’s `assets[0].asset_id` as the render input. The render result includes the original ID in `source_asset_id` and a new WAV ID in `assets[0].asset_id`. Pass the WAV ID to `audio_analyze` to read back the duration, channel count, and peak amplitude.

Rendering handles the fixed-tempo MIDI produced by this server, retains its duration, and applies a 150 ms ending fade and a peak limiter. One render runs per server at a time. Each external command has a 60-second timeout. For the real synthesis integration check, run `AUDIO_MCP_TEST_RENDER=1 npm test` with the render dependencies installed.

## Development

- [Server entry point](src/index.ts) registers the tools, validates inputs, and manages workspace files.
- [Audio engine](src/audio.ts) owns the five synthesis presets, PCM encoding, and analysis.
- [Stdio integration test](test/stdio.test.mjs) launches the compiled server through the MCP SDK client. It checks all five effects, compares measured peaks with the samples on disk, and exercises invalid inputs and damaged files.

## V1 roadmap

| Area | Planned outcome |
| --- | --- |
| Composition and MIDI | Expand the piano generator with style presets, additional keys and multi-instrument composition. |
| Audio production | Render background music, create seamless loops, trim, fade, normalize, mix, and export additional formats. |
| Long renders | Run rendering in a worker with progress, cancellation, and timeouts. |
| Release verification | Exercise the supported workflows on macOS, Linux, and Windows and audit the distribution licenses of dependencies and sound assets before claiming commercial readiness. |
