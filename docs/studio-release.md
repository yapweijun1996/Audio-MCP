# Sound Studio web release

Sound Studio is a static, local-first PWA. It runs from a loopback HTTP origin or an HTTPS static host. The studio needs no account, application server, analytics service, native audio executable or remote sample API. The stdio MCP server remains a separate entry point.

## Public deployment

[Open Sound Studio](https://audio-mcp-studio.onemap-token-proxy.workers.dev/). The production service is Cloudflare Workers Static Assets, named `audio-mcp-studio`. The acoustic release on 2026-11-23 is `da14c49c0b212a27`, Worker version `3ae1d738-3341-412c-abf4-52592b5b41fd`. All 20 public files matched their packaged SHA-256, including the three streaming MP3s. The archive SHA-256 is `d9538b14a1759333cc63e6cb8dcf6031a389a0e5795598603478db3bd9e6c31d`. Desktop Chromium and emulated iPhone WebKit opened, played and exported the film cue online and the café and piano cues offline on the public origin.

The rollback release from 2026-11-23 is `09612c1b305bab39`, Worker version `b0558560-d775-42e1-aa88-de7a7f8e1d6d`. All ten public files matched the corresponding files in the release archive (archive SHA-256 `acc30311afbd737932d28286686e38a8d696e4458e25d8db3e90d9665d186eef`).

This host redirects `/index.html` to `/`. The service worker strips redirect history from verified responses before caching, so installed windows and offline navigation can replay the app document. The Chromium release lifecycle test reproduces this host behavior. For the rollback release, a disposable desktop Chromium profile installed the public app, launched a standalone window and generated a saved take offline. Six public-origin checks covered playback, downloads, persistence and offline generation across desktop Chromium, Android Chromium emulation and iPhone WebKit emulation.

For subsequent releases, use the same Worker name and upload only the files extracted from the current release archive. Preserve the public origin and scope so that existing installations and their libraries remain associated with the app. Apply the HTTP header policy below to the upload directory through Cloudflare's `_headers` file.

## Package and serve

Use `npm ci` and `npm run package:studio` with Node.js 22+ and a system tar executable. The archive in `dist/audio-mcp-studio-<build>.tar.gz` contains only the current release's static files. Extract it into its own directory on the HTTPS host. The entry point is `index.html`; root and directory deployments both work. Keep the trailing slash when linking to a directory deployment. Use `npm run studio` after building for loopback access on port 4173.

Serve JavaScript as JavaScript, CSS as CSS, the manifest as application/manifest+json and PCM and acoustic bank data as application/octet-stream. Serve preview MP3s as audio/mpeg. Serve index.html, sw.js, icons, the manifest and unversioned preview MP3s with revalidation. Files with content hashes in their names can have immutable caching. Avoid host-side HTML rewriting because the worker checks the delivered bytes. Match the loopback server's no-sniff, no-referrer and anti-framing headers on the HTTPS host.

Publish the whole archive atomically and keep the previous archive for rollback. A release ID covers both the content hashes and worker source. An update installs only after SHA-256 validation of every offline asset. Open sessions can keep working on their current release. The update action waits for rendering to finish and for other studio tabs to close. On rollback, restore the previous complete archive at the same URL. Keep IndexedDB and site storage during the switch.

## Offline and storage behavior

The offline package contains approximately 39 MB of instrument data. Once **Offline ready** appears, users can cold-start the app, generate any voice, audition, save, delete and export without a connection. The browser renderer produces 44.1 kHz PCM and limits music to 60 seconds per take. A full-length stereo acoustic take uses about 10.6 MB for its WAV. Marimba, drums and effects use mono PCM. The browser decodes individual FLAC recordings for the pitches and dynamics used in the score.

The MP3 listening copies stream on demand. After offline setup, the three featured links can regenerate their scores and export WAV and MIDI without a connection. Identical inputs produce identical MIDI across the tested browser engines. WAV output can vary by engine. Each MP3 was encoded from the corresponding browser WAV at 192 kb/s.

The version-one IndexedDB schema stores metadata and audio/MIDI bytes separately in one transaction. IDs are unique per take. Separate deployment paths have separate library keys. A failed save leaves the generated audio available for download and reports the failure. Durable downloads are important for work that must survive removal or eviction of browser storage. No account or cloud synchronization is involved. [Browser storage behavior](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)

The app install action uses the browser prompt when available and provides platform instructions otherwise. Installation support depends on the browser and OS. [Installation requirements](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)

## Qualification

The release build rounds SF2 envelope release times to nanoseconds before bundling. On macOS arm64, Node 22.23.3, 23.10.0 and 24.21.0 produced the same 20 static files and build ID `bdb35eeba0c262d3` with the locked dependencies. The public deployment above records the preceding build.

The final native render-enabled npm test run passed all 14 checks. The acoustic release exercised ten browser workflows across Chromium, Firefox and emulated iPhone WebKit, including offline stereo export, multitrack MIDI and deterministic score variations. The original Firefox run exceeded the 65-second test-case limit on this host. Its three workflows passed on rerun, with two using a 180-second total case budget and the same assertions. The three featured WAVs measured −15.7, −16.5 and −16.6 LUFS for film, café and solo piano, with true peaks near −1.1 dBTP.

The 2026-11-22 local candidate has web build ID `277a82456af2c6d2`. A clean dependency install reproduced the same worker digest. The three-engine browser suite passed all seven cases, and the production/render-enabled Node suite passed all 13 tests. The packaged archive was opened independently and checked against every precache hash. Its SHA-256 digest is `2bf3fd30d2a7005d054492514a5ed19f064677f9b752d6b842be0765d02afc60` for this particular archive.

Run the existing Node integration tests with `npm test`. Use `AUDIO_MCP_TEST_RENDER=1 npm test` on a configured native MIDI rendering host. For the web suite, install Playwright's Chromium, Firefox and WebKit browsers with `npx playwright install chromium firefox webkit` and run `npm run test:studio`. The tests start a dedicated loopback server and run in isolated browser profiles.

| Surface | Evidence in this workspace |
| --- | --- |
| Desktop Chromium and Firefox; mobile WebKit emulation | Seven shared instrument choices, four acoustic arrangements or solos and five effects. Checks cover stereo WAV, program assignments in MIDI, offline generation, playback, downloads, persistence and storage failure recovery. |
| Release upgrade, Chromium | Mixed release rejected, old cache retained, update delayed with two tabs, explicit update applied with saved take and unsubmitted tempo preserved under a directory scope |
| Desktop Chromium install | Isolated profile passed installability checks, installed and launched the app, and opened a standalone window |
| Accessibility | Automated WCAG A/AA rules checked on the studio landing state in Chromium. Keyboard labels, native form inputs, audio seek control and the install dialog are available |
| MCP regression | Native render-enabled integration suite exercised the existing stdio workflow |
| Coverage boundaries | Physical iOS and Android installation, VoiceOver and field Core Web Vitals were not measured. WebKit device emulation is a browser test rather than physical-device certification |

The offline web distribution includes the bundled sample credits and third-party JavaScript license texts in credits.txt. The application's own source distribution terms remain the repository owner's decision.
