# Music delivery checklist

Use this page to decide whether an arranged cue is ready for an editor. Start with the brief, choose a take, check the arrangement against the picture, and deliver the master, matching edits and source parts.

## Finished examples

| Take | Duration | Integrated loudness | True peak | Delivery |
| --- | ---: | ---: | ---: | --- |
| Velvet Keys, 86 BPM, seed 17 | 44.651 s | −16.00 LUFS | −2.24 dBTP | [24-bit WAV](../examples/production/velvet-keys.wav) · [Preview](../examples/production/velvet-keys.mp3) |
| Night Drive, 112 BPM, seed 42 | 34.286 s | −13.97 LUFS | −1.38 dBTP | [Preview](../examples/production/night-drive.mp3) |
| Night Drive main, 128 BPM, seed 42 | 30.000 s | −13.97 LUFS | −1.42 dBTP | [WAV, edits, stems and MIDI](../examples/production/night-drive-editor.zip) |
| Night Drive cutdown, from the 30-second performance | 15.000 s | −14.09 LUFS | −1.48 dBTP | Included in the pack |
| Night Drive underscore, from the same stems | 30.000 s | −20.00 LUFS | −5.11 dBTP | Included in the pack |

These takes were rendered on macOS arm64 with Node 24.21.0 and FFmpeg 8.1.2. The measurements come from the stereo 48 kHz, 24-bit WAV masters before preview encoding. For each new take, measure the actual deliverable at the client's requested loudness and duration. The pack manifest records exact frame counts, edit points, measurements, render settings and file hashes. [Generator revision](https://github.com/yapweijun1996/Audio-MCP/commit/b80adcb980f45c0fa3a6f54a4f2a5fd241dc421f) · [Render another pack](../README.md#download-or-render-an-editor-pack)

## Arrangement and edit checks

- [x] **Keep a theme the listener can follow.** In the Velvet Keys demo, listen around 22 s for the descending bass under sustained common tones. At 39 s, a borrowed minor chord introduces the return to C major. Alternating recorded kick strikes, softer offbeat hats and a closing hi-hat that cuts off its open predecessor give the groove a live-kit articulation. Night Drive keeps its electronic pulse. Around 30 s in the 112 BPM demo, a suspended chord resolves before the final F minor hit.
- [x] **Edit the actual performance.** The 15-second version starts with four bars of the 30-second theme, moves into two lift bars and lands on the original final two bars. Five-millisecond overlaps preserve the incoming beats. The two versions reach the logo at 28.125 s and 13.125 s, frames 675 and 315 on a 24 fps timeline counting from zero. Automated waveform comparisons check both channels before and after each splice. [Editor pack regression](../test/editor-pack.test.mjs)
- [x] **Leave room for dialogue.** The underscore removes the lead, lowers the keys and retains the bass and drums. The 30-second picture edit brings the theme up between lines and moves to the underscore under speech. The decoded AAC mix measured −18.84 LUFS and −1.70 dBTP. A 300 Hz–4 kHz mono playback check with Whisper Small recovered all 30 scripted words, ignoring punctuation and case. This covers the supplied English voice and mix. [Play the narrated example](../examples/production/last-tram.mp4)
- [x] **Open and verify the files independently.** The pack contains three masters, four pre-master stems and a four-part MIDI score. Place the stems at sample zero. The main mix and each stem have 1,440,000 stereo frames. The short has 720,000. The MIDI ends on the same 16-bar grid as the main mix. Each master meets its loudness target within 1 LU and stays below −1 dBTP. The manifest lets the recipient check the files after extraction.
- [ ] **Sign off a new client's mix to their picture.** Check the hook against the reveal, listen for masked words and repeated fills, and play the final transition in context on headphones and a speaker. Record the take, timecode and requested edit. The measurements above cover the published examples. An editor's listening preference remains unmeasured.

## Reference and sources

The same 30-second picture and narration were also mixed with the first 30 seconds of Kevin MacLeod's *Cipher*. For this comparison both full music beds measured −20.0 LUFS before identical dialogue automation. Folding to mono reduced music energy by 0.28 dB for Night Drive and 2.75 dB for the reference. The test also explains why the pack includes an underscore. In the narrated edit, the median voice-to-music energy advantage in the 300 Hz–4 kHz band during active speech was 18.8 dB. *Cipher* is an attributed stock reference and is excluded from the delivered media. [Publisher's track and license](https://incompetech.com/music/royalty-free/index.html?Search=Search&isrc=USUAN1100844) · [Earlier Velvet Keys and Night Drive comparisons](production-readiness.md#comparison-with-paid-stock-music)

Night Drive uses original generated scores and synthesized performances. Velvet Keys adds recordings from the CC0 Virtuosity Drums kit. The picture and narration text for *Last Tram* were created for this demonstration. The spoken voice was rendered locally with Kokoro v1.0, voice `af_heart`. Keep these source credits with the project, and confirm the intended rights when incorporating client recordings or supplying a license. [Drum credits](../assets/cc0/README.md) · [Kokoro model card](https://huggingface.co/hexgrad/Kokoro-82M)

The delivery formats have analogues in licensed libraries. *Easy Days* includes 15-, 30- and 60-second edits, loops and stems. *Sunset Chill* offers an underscore. [PremiumBeat listing](https://www.premiumbeat.com/royalty-free-tracks/easy-days) · [Melody Loops listing](https://www.melodyloops.com/tracks/sunset-chill/)
