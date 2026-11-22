# Production readiness checklist

Use this checklist for a trusted local MCP client that launches Audio MCP over stdio, with one OS account owning the asset directory. Piano MIDI and sound effects run in Node.js. Piano MIDI rendering adds FluidSynth, FFmpeg and a readable General MIDI sound bank. The arranged music producer uses Node.js and FFmpeg with the `loudnorm` filter.

## Arranged music acceptance

On macOS arm64 with Node 24.21.0 and FFmpeg 8.1.2, the stdio client produced both 16-bar previews below and read back the master and four stems by asset ID. The delivered WAVs use stereo 48 kHz, 24-bit PCM. Measurements are from the final WAVs before encoding the MP3 previews.

| Cue | Seed | BPM | Duration | Integrated loudness | True peak |
| --- | --- | --- | --- | --- | --- |
| [Velvet Keys](../examples/production/velvet-keys.mp3) | 17 | 86 | 44.65 s | −16.01 LUFS | −1.85 dBTP |
| [Night Drive](../examples/production/night-drive.mp3) | 42 | 112 | 34.29 s | −14.01 LUFS | −1.48 dBTP |

A separate macOS run on Node 22.23.5 produced the longest supported cue (32 bars at 72 BPM, 106.67 seconds, including stems) and the shortest (8 bars at 128 BPM, 15 seconds). Both passed the delivery limits.

Run `AUDIO_MCP_TEST_PRODUCTION=1 npm test` for this delivery path. The integration test exercises both styles, WAV readback, overlapping calls, client cancellation, retry and cleanup after missing FFmpeg. Each server process shares one render slot between MIDI rendering and music production. Budget temporary space for the float mix, master and requested stems. Each 48 kHz stereo 24-bit WAV uses 288,000 bytes per second plus its header. If the process is forcibly terminated, inspect `.produce-*` directories with the server stopped.

The supplied producer sounds are synthesized from the score without third-party samples or banks. Verify client-specific deliverable requirements and any rights to added samples or performances when preparing a remix. [Production tool and asset guide](../README.md#produce-a-music-cue)

## Verified baseline

On 2026-11-22, the following checks passed on macOS 27.2 arm64 at [commit `48e6aab`](https://github.com/yapweijun1996/Audio-MCP/commit/48e6aab0fc9e794da082a095e77bfb8195f3ab1e). The renderer used FluidSynth 2.5.5, FFmpeg 8.1.2 and the macOS system DLS bank.

| Check | Observed result |
| --- | --- |
| Clean install and stdio integration | Node 22.23.5 and 24.21.0 each passed `npm ci`, `npm test` and the render-enabled suite. The SDK client discovered four tools, generated all five effects, checked WAV peaks against disk samples and verified seeded piano MIDI. [Integration test](../test/stdio.test.mjs) |
| Real synthesis | The render-enabled suite produced non-silent stereo audio within 2 ms of the requested 1.37 seconds and found no leftover render directory. |
| Maximum duration and overlapping calls | A separate Node 24 stdio check requested a 300-second piano piece at 240 BPM and submitted two renders together. One returned the busy error. The other produced a 52,920,044-byte stereo WAV at 44.1 kHz. A fresh server read the full 300 seconds using the same WAV ID. |
| Workspace and failure handling | The new workspace had mode `0700` and the finished WAV had mode `0600`. With a missing bank, rendering returned a tool error and SFX generation and analysis still worked. The suite also rejected damaged WAV data, invalid IDs and a symlinked WAV on macOS. |
| npm advisories | Full `npm audit` and `npm audit --omit=dev` each reported zero known vulnerabilities for the locked tree on the review date. Repeat the audit for each candidate. Native executables and the sound bank need their own review. [npm audit](https://docs.npmjs.com/cli/v10/commands/npm-audit/) |

Linux and Windows qualification, abrupt process termination during file writes, and commercial distribution clearance for the project remain open.

## Qualify a candidate on its target host

- [ ] **Build the pinned revision.** Record the Git SHA, OS, architecture, Node and npm versions. Choose a supported Node LTS line within the project's `>=22` range. In a clean checkout, run the commands below. The default suite starts the compiled server as a child process and uses a disposable workspace. [Node release status](https://nodejs.org/en/about/previous-releases) · [npm clean install](https://docs.npmjs.com/cli/v11/commands/npm-ci/)

  ```sh
  git rev-parse HEAD
  node --version
  npm --version
  npm ci
  npm test
  npm audit
  ```

- [ ] **Exercise the renderer wherever it is offered.** Record `fluidsynth --version`, `ffmpeg -version` and the bank identity. Make both programs visible on the client's PATH. Configure `AUDIO_MCP_SOUNDFONT` with an absolute path to a compatible local bank, or use the macOS default with a DLS-capable build. Run `AUDIO_MCP_TEST_RENDER=1 npm test` in a POSIX shell. In PowerShell, set `$env:AUDIO_MCP_TEST_RENDER = "1"` before `npm test`. Require the real render to pass on each advertised OS and bank combination. [Renderer](../src/render.ts) · [FluidSynth manual](https://www.fluidsynth.org/wiki/UserManual/)

- [ ] **Smoke-test the configured client.** Point it at the compiled `dist/index.js` and an absolute, private `AUDIO_MCP_WORKSPACE`. Reconnect and list tools. Call `audio_generate_sfx` with `{"effect":"success","duration_seconds":0.45}`, then pass the returned `assets[0].asset_id` to `audio_analyze`. Expect 0.45 seconds, one channel, 44100 Hz and `silent: false`. For a render-enabled host, generate piano MIDI, render its ID, and analyze the **new WAV ID**. Check two channels, duration and audible playback. Capture stderr for diagnostics and reserve stdout for protocol messages. [Client setup](../README.md#connect-a-client) · [MCP stdio specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#stdio)

- [ ] **Check workspace ownership and capacity.** Inspect existing directory permissions or Windows ACLs under the account that launches the client. The server requests private modes when creating files and directories. It reuses existing directories. Allow space for the final WAV **and** intermediate audio. A five-minute stereo WAV alone uses about 50.5 MiB. Set a retention period and free-space alert appropriate to the host. Assets persist until removed. [Workspace implementation](../src/index.ts)

- [ ] **Rehearse failure and recovery in a disposable workspace.** Test an unwritable workspace, a cancelled render, and an interrupted server. Verify the client sees a failure, completed assets remain readable after reconnect, and a new render succeeds. Inspect for orphaned child processes, `.render-*` directories and `*.tmp` files with the server stopped. Each external command has a 60-second timeout. The one-render limit applies per server process, so check resource use with the number of clients the host will actually run. [Render lifecycle](../src/render.ts)

- [ ] **Clear the intended distribution.** The reviewed tree has no top-level project license and the npm package is marked private. Before distributing source, binaries, sound banks or sample recordings, record the owner's terms for the project, the exact native builds and npm dependencies, and the provenance and permitted uses of each bank and bundled audio example. Include both WAVs in `examples/cafe-pilot/` in that review. FFmpeg build options affect its applicable license. [Package manifest](../package.json) · [GitHub repository licensing](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository) · [FFmpeg licensing](https://ffmpeg.org/legal.html)

## Rollback and sign-off

Keep the previous tested checkout and client configuration available, including its runtime, workspace path and sound bank. If the candidate fails, stop its client-launched process, point the client back to the previous build and reconnect. Analyze a known WAV ID from the same workspace, then generate and analyze a new SFX. Repeat the piano render check if the host offers rendering. Preserve existing assets during the switch.

Record the candidate and rollback SHAs, target host and client, enabled tools, test results, any exceptions and the person accepting the release. Sign off only on the host and workflows that passed.
