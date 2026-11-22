import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseMidi } from "midi-file";
import { analyze } from "./audio.js";

const execute = promisify(execFile);
const macPianoBank = "/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls";
export const maxRenderSeconds = 300.01;

// Piano assets carry a single tempo and the piece's end tick in the conductor track.
function pianoDuration(midi: Buffer) {
  if (midi.length < 30 || midi.toString("ascii", 0, 4) !== "MThd" ||
      midi.readUInt32BE(4) !== 6 || midi.readUInt16BE(8) !== 1 ||
      midi.toString("ascii", 14, 18) !== "MTrk" || midi.readUInt32BE(18) > 16) {
    throw new Error("Expected an audio_generate_piano MIDI asset");
  }
  const end = 22 + midi.readUInt32BE(18);
  const {header, tracks} = parseMidi(midi.subarray(0, end));
  const [tempo, stop] = tracks[0];
  if (tracks[0].length !== 2 || tempo?.type !== "setTempo" || tempo.deltaTime !== 0 ||
      stop?.type !== "endOfTrack" || !header.ticksPerBeat) {
    throw new Error("Unsupported piano MIDI conductor track");
  }
  const seconds = stop.deltaTime * tempo.microsecondsPerBeat / header.ticksPerBeat / 1e6;
  if (!(seconds > 0 && seconds <= maxRenderSeconds)) throw new Error("Unsupported MIDI duration");
  return seconds;
}

async function run(program: string, args: string[], signal: AbortSignal) {
  try {
    await execute(program, args, { timeout: 60000, killSignal: "SIGKILL", signal, maxBuffer: 128 * 1024 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("Install " + program + " and make it available on the MCP server PATH");
    }
    throw error;
  }
}

export async function renderPiano(root: string, midi: Buffer, signal: AbortSignal) {
  const seconds = pianoDuration(midi);
  const bank = process.env.AUDIO_MCP_SOUNDFONT || (process.platform === "darwin" ? macPianoBank : "");
  if (!bank) throw new Error("Set AUDIO_MCP_SOUNDFONT to a local GM piano sound bank");
  await access(bank);
  const dir = await mkdtemp(join(root, ".render-"));
  try {
    const input = join(dir, "source.mid");
    const raw = join(dir, "synth.wav");
    const output = join(dir, "output.wav");
    await writeFile(input, midi);
    await run("fluidsynth", ["-ni", "-F", raw, "-T", "wav", "-r", "44100", bank, input], signal);
    const fade = Math.min(0.15, seconds);
    const filter = "volume=25dB,alimiter=limit=0.94:level=0:latency=1,afade=t=out:st=" +
      (seconds - fade) + ":d=" + fade;
    await run("ffmpeg", ["-nostdin", "-v", "error", "-i", raw, "-t", String(seconds),
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
