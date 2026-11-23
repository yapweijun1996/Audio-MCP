import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cc0BankTag } from "./midi.js";
import { bundledBankURL } from "./sample-bank.js";
import { runProgram } from "./program.js";
import { parseMidi } from "midi-file";
import { analyze } from "./audio.js";

const cc0Bank = fileURLToPath(bundledBankURL);
const macPianoBank = "/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls";
export const maxRenderSeconds = 300.01;

// Read only the bounded conductor track for tempo, duration and bank selection.
function renderSettings(midi: Buffer) {
  if (midi.length < 30 || midi.toString("ascii", 0, 4) !== "MThd" ||
      midi.readUInt32BE(4) !== 6 || midi.readUInt16BE(8) !== 1 ||
      midi.toString("ascii", 14, 18) !== "MTrk" || midi.readUInt32BE(18) > 20 + cc0BankTag.length) {
    throw new Error("Expected a generated Audio MCP MIDI asset");
  }
  const end = 22 + midi.readUInt32BE(18);
  const {header, tracks} = parseMidi(midi.subarray(0, end));
  const events = tracks[0];
  const marker = events[1];
  const bundled = events.length === 3 && marker?.type === "text" && marker.deltaTime === 0 && marker.text === cc0BankTag;
  const tempo = events[0];
  const stop = events.at(-1);
  if ((!bundled && events.length !== 2) || tempo?.type !== "setTempo" || tempo.deltaTime !== 0 ||
      stop?.type !== "endOfTrack" || !header.ticksPerBeat) {
    throw new Error("Unsupported MIDI conductor track");
  }
  const seconds = stop.deltaTime * tempo.microsecondsPerBeat / header.ticksPerBeat / 1e6;
  if (!(seconds > 0 && seconds <= maxRenderSeconds)) throw new Error("Unsupported MIDI duration");
  return { seconds, bundled };
}

export async function renderMidi(root: string, midi: Buffer, signal: AbortSignal) {
  const { seconds, bundled } = renderSettings(midi);
  const bank = bundled ? cc0Bank : process.env.AUDIO_MCP_SOUNDFONT || (process.platform === "darwin" ? macPianoBank : "");
  if (!bank) throw new Error("Set AUDIO_MCP_SOUNDFONT to a local GM piano sound bank");
  await access(bank);
  const dir = await mkdtemp(join(root, ".render-"));
  try {
    const input = join(dir, "source.mid");
    const raw = join(dir, "synth.wav");
    const output = join(dir, "output.wav");
    await writeFile(input, midi);
    await runProgram("fluidsynth", ["-ni", "-F", raw, "-T", "wav", "-r", "44100", bank, input], signal);
    const fade = Math.min(0.15, seconds);
    const filter = "volume=25dB,alimiter=limit=0.94:level=0:latency=1,afade=t=out:st=" +
      (seconds - fade) + ":d=" + fade;
    await runProgram("ffmpeg", ["-nostdin", "-v", "error", "-i", raw, "-t", String(seconds),
      "-af", filter, "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", "-fflags", "+bitexact", output], signal);
    const wav = await readFile(output);
    const validation = analyze(wav);
    if (validation.silent || Math.abs(validation.duration_seconds - seconds) > 0.002) {
      throw new Error("Rendered WAV is silent or does not match the MIDI duration");
    }
    return { wav, validation };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
