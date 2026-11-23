# Audio MCP Sound Studio

Audio MCP includes an installable, local-first web studio and a stdio MCP server. The web studio composes music and UI sound effects, previews a waveform, keeps takes on the device and exports WAV and MIDI. Once the studio shows **Offline ready**, the full workflow is available offline.

## Open the web studio

[Open Sound Studio](https://audio-mcp-studio.onemap-token-proxy.workers.dev/) on a desktop or phone. Use **Install app** for your browser's installation steps. Once **Offline ready** appears, the studio can reopen, generate, save and export without a connection.

| Featured piece | Arrangement | Listen | Generate and export |
| --- | --- | --- | --- |
| Over the Footbridge | Steinway B, solo violin and cello section at 68 BPM · 32 s | [MP3](https://audio-mcp-studio.onemap-token-proxy.workers.dev/over-the-footbridge.mp3) | [Film chamber trio](https://audio-mcp-studio.onemap-token-proxy.workers.dev/?piece=film#studio) |
| Corner Table | Swing piano and pizzicato upright bass at 88 BPM · 32 s | [MP3](https://audio-mcp-studio.onemap-token-proxy.workers.dev/corner-table.mp3) | [Café piano & upright bass](https://audio-mcp-studio.onemap-token-proxy.workers.dev/?piece=cafe#studio) |
| After the Rain | Lyrical Steinway B solo at 76 BPM · 28 s | [MP3](https://audio-mcp-studio.onemap-token-proxy.workers.dev/after-the-rain.mp3) | [Lyrical solo piano](https://audio-mcp-studio.onemap-token-proxy.workers.dev/?piece=recital#studio) |

Choose an instrument or arrangement and set the duration, tempo and variation seed. Select **Generate & save** to keep the take in this browser. The monitor plays it and exports a 44.1 kHz, 16-bit WAV and editable MIDI. Music lasts 1–60 seconds. The chamber arrangements and acoustic pitched voices export stereo. Marimba, acoustic drums and UI effects export mono. Effects last 0.02–3 seconds and export WAV.

The offline pack includes 136 CC0 acoustic sample regions for grand piano, violin, cello section, upright bass, flute, nylon guitar and fingered electric bass. It also includes the marimba and acoustic kit recordings. The sample credits identify the sources and CC0 terms for commercial use. [Chamber recording credits](assets/chamber/README.md) · [SoundFont recording credits](assets/cc0/README.md)

To run the web studio locally with Node.js 22 or later:

```sh
npm ci
npm run build:studio
npm run studio
```

Open [the local studio](http://127.0.0.1:4173/). For packaging, deployment and verification, see the [web release runbook](docs/studio-release.md).

## MCP server

Audio MCP gives coding agents local tools for producing audio assets. The project goal is to let an agent compose, edit, verify, and export music and sound effects for apps, games, and videos.

Generate editable MIDI for piano, nylon guitar, fingered electric bass, flute, marimba, acoustic drums or cello ensemble, or synthesize a short UI sound and check the resulting WAV. The TypeScript server communicates over MCP stdio and synthesizes the waveform locally. All tools run offline after setup. MIDI rendering uses local FluidSynth, FFmpeg, and a sound bank.

## Build and verify

Use Node.js 22 or later and npm. Run these commands in the checkout.

```sh
npm ci
npm test
```

The test builds the server, launches it as a child process, discovers its tools and checks the generated audio. To build without running tests, use `npm run build`.

Before using a build in production, review the verified environments, outstanding checks, and rollback procedure in the [production readiness checklist](docs/production-readiness.md).

For music delivery, use the [mastering, cutdown and stem checklist](docs/commercial-readiness.md).

## Produce a music cue

Ask your MCP client to “produce a 16-bar night-drive instrumental with stems”. The `audio_produce_music` tool composes an intro, theme, lift and resolved ending, renders four parts, and masters the stereo mix. It runs locally with Node.js and FFmpeg on PATH. Night Drive uses electronic synthesis throughout. Velvet Keys pairs synthesized electric keys, bass and lead with the bundled acoustic drum recordings. [Recording credits](assets/cc0/README.md)

| Style | Sound | Full-length preview |
| --- | --- | --- |
| `velvet_keys` | Swung electric keys, recorded drums and a descending bass line in the lift. Default 86 BPM. | [Velvet Keys · 45 s](examples/production/velvet-keys.mp3) · [24-bit WAV](examples/production/velvet-keys.wav) |
| `night_drive` | A straight electronic pulse with syncopated bass and a brighter hook. Default 112 BPM. | [Night Drive · 34 s](examples/production/night-drive.mp3) |

```json
{"style":"night_drive","bars":16,"seed":42,"include_stems":true}
```

Choose 8, 16 or 32 bars and optionally set `bpm` from 72 to 128. The default is a 16-bar `velvet_keys` cue with seed 1. The same inputs reproduce the score. In the result, select assets by `role`. Use `master` for the finished 48 kHz, 24-bit stereo WAV and `score` for editable multitrack MIDI. Optional `drums`, `bass`, `keys` and `lead` WAVs start at the same sample and end together. Import the four stems at time zero for remixing. They include their individual effects and precede master-bus processing.

Each master is measured after export. The project targets −16 LUFS for Velvet Keys and −14 LUFS for Night Drive. Delivery requires integrated loudness within 1 LU of the style target and true peak at or below −1 dBTP. The result includes both measurements and the section start bars. Pass any returned WAV ID to `audio_analyze` for duration, channel count and sample peak. [FFmpeg loudness measurement](https://ffmpeg.org/ffmpeg-filters.html#loudnorm)

### Download or render an editor pack

The [Night Drive WAV pack](examples/production/night-drive-editor.zip) includes a 30-second master, a 15-second cut from the same performance, a 30-second underscore for dialogue, four aligned stems and the multitrack MIDI score. The manifest lists edit points, measured levels and file hashes. [Hear the underscore in a narrated picture edit](examples/production/last-tram.mp4)

After building, render another take to a new directory. The optional second argument is the seed. The pack runs at 128 BPM to fit the two durations exactly.

```sh
node scripts/render-editor-pack.mjs audio-assets/night-drive-42 42
```

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
| audio_produce_music | Optional `style`, `bars`, `bpm`, `seed` and `include_stems`. | Master WAV, editable MIDI, optional four WAV stems, arrangement and measured loudness. |
| audio_generate_piano | Optional `duration_seconds` (1–300, default 30), integer `bpm` (40–240, default 80), and integer `seed` (0–4294967295, default 1). | A C major Standard MIDI File with two editable piano parts, its absolute path and asset ID. |
| audio_generate_instrument | Required `instrument` (`nylon_guitar`, `finger_bass`, `flute`, `marimba`, `acoustic_drums`, `cello_ensemble`). Same optional duration, BPM and seed as piano. Drums accept an optional `pattern`. | An editable MIDI part, its absolute path and asset ID. |
| audio_generate_sfx | Required `effect` (click, hover, success, error, whoosh). Optional `duration_seconds` from 0.02 to 3. | A 44.1 kHz mono 16-bit PCM WAV, its absolute path, asset ID and measured audio properties. |
| audio_render | Required MIDI `asset_id` from `audio_generate_piano` or `audio_generate_instrument`. | A stereo 44.1 kHz 16-bit PCM WAV, its asset ID, absolute path, and measured properties. |
| audio_analyze | Required `asset_id` from a WAV generation result. | Duration, sample rate, channels, normalized peak amplitude and a digital silence flag. |

For example, call `audio_generate_sfx` with `{"effect":"success","duration_seconds":0.45}`, then pass the returned `assets[0].asset_id` to `audio_analyze`. Calls return structured content and equivalent JSON text. Invalid inputs and unreadable assets produce MCP errors.

For piano, call `audio_generate_piano` with `{"duration_seconds":30,"bpm":80,"seed":42}`. Open the returned `.mid` file in a DAW or MIDI player with a General MIDI synthesizer. Both hands use acoustic grand piano. Repeating the parameters reproduces the MIDI bytes.

For a nylon guitar arpeggio, call `audio_generate_instrument` with `{"instrument":"nylon_guitar","duration_seconds":12,"bpm":100,"seed":42}`. Instrument playback uses the General MIDI sounds available in your player.

For an acoustic groove, call `audio_generate_instrument` with `{"instrument":"acoustic_drums","pattern":"swing","bpm":100,"duration_seconds":12,"seed":42}`. Choose `backbeat` (default), `half_time` or `swing`. For mallet arpeggios or sustained bowed notes, use `marimba` or `cello_ensemble` and omit `pattern`. Pass the MIDI asset ID to `audio_render` to hear the [bundled CC0 recordings](assets/cc0/README.md).

## Render MIDI to WAV

Install FluidSynth and FFmpeg and make both executables available on the MCP server's PATH. Marimba, acoustic drums and cello ensemble automatically use the included SoundFont on all platforms. For piano, guitar, bass and flute, configure a General MIDI bank. On macOS the renderer defaults to the system General MIDI DLS bank. Use a FluidSynth build with DLS support or configure a local GM-compatible SF2 bank. For these General MIDI instruments on other platforms, set `AUDIO_MCP_SOUNDFONT` to its absolute path in the server environment. Reconnect the client after changing server configuration.

In Codex CLI, ask “Generate 30 seconds of piano, render it to WAV using audio_render, and give me the WAV path.” To reuse an existing piece, call `audio_render` with `{"asset_id":"<MIDI asset UUID>"}` in the same workspace. Use the MIDI result’s `assets[0].asset_id` as the render input. The render result includes the original ID in `source_asset_id` and a new WAV ID in `assets[0].asset_id`. Pass the WAV ID to `audio_analyze` to read back the duration, channel count, and peak amplitude.

Rendering handles the fixed-tempo MIDI produced by this server, retains its duration, and applies a 150 ms ending fade and a peak limiter. One render runs per server at a time. Each external command has a 60-second timeout. For the real synthesis integration check, run `AUDIO_MCP_TEST_RENDER=1 npm test` with the render dependencies installed.

## Development

- [Server entry point](src/index.ts) registers the tools, validates inputs, and manages workspace files.
- [Audio engine](src/audio.ts) owns the five synthesis presets, PCM encoding, and analysis.
- [Stdio integration test](test/stdio.test.mjs) launches the compiled server through the MCP SDK client. It checks all five effects, compares measured peaks with the samples on disk, and exercises invalid inputs and damaged files.

## V1 roadmap

| Area | Planned outcome |
| --- | --- |
| Composition and MIDI | Expand cue styles and add controls for harmony and instrumentation. |
| Audio production | Add seamless loop delivery, editing of existing assets and additional export formats. |
| Long renders | Add progress reporting and queued jobs for long renders. |
| Release verification | Exercise the supported workflows on macOS, Linux, and Windows and audit the distribution licenses of dependencies and sound assets before claiming commercial readiness. |
