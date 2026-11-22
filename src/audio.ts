export const effects = ["click", "hover", "success", "error", "whoosh"] as const;
type Effect = typeof effects[number];
const sampleRate = 44100;
const durations: Record<Effect, number> = {
  click: 0.06, hover: 0.14, success: 0.45, error: 0.32, whoosh: 0.6,
};

export function synthesize(effect: Effect, seconds = durations[effect]) {
  const frames = Math.round(seconds * sampleRate);
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(frames * 2, 40);

  let phase = 0;
  let noise = 109;
  let filtered = 0;
  for (let frame = 0; frame < frames; frame++) {
    const t = frame / (frames - 1);
    let frequency = 0;
    switch (effect) {
      case "click": frequency = 1900 * Math.exp(-4 * t); break;
      case "hover": frequency = 580 + 380 * t; break;
      case "success": frequency = t < 0.33 ? 523.25 : t < 0.66 ? 659.25 : 783.99; break;
      case "error": frequency = t < 0.5 ? 246.94 : 174.61; break;
    }
    phase += 2 * Math.PI * frequency / sampleRate;
    let signal = Math.sin(phase);
    if (effect === "whoosh") {
      noise = (Math.imul(1664525, noise) + 1013904223) >>> 0;
      filtered += (0.035 + 0.4 * t) * (noise / 2147483648 - 1 - filtered);
      signal = filtered;
    }
    const envelope = effect === "click"
      ? Math.min(1, 100 * t) * Math.exp(-8 * t) * (1 - t)
      : Math.sin(Math.PI * t);
    wav.writeInt16LE(Math.round(signal * envelope * 24000), 44 + 2 * frame);
  }
  return wav;
}

// Both generators emit canonical 44-byte PCM headers.
export function analyze(wav: Buffer) {
  if (wav.length < 44) throw new Error("Invalid WAV header");
  const channels = wav.readUInt16LE(22);
  const frames = (wav.length - 44) / (channels * 2);
  if (frames < 1 || !Number.isInteger(frames) ||
      wav.toString("ascii", 0, 4) !== "RIFF" ||
      wav.readUInt32LE(4) !== wav.length - 8 ||
      wav.toString("ascii", 8, 16) !== "WAVEfmt " ||
      wav.readUInt32LE(16) !== 16 || wav.readUInt16LE(20) !== 1 ||
      (channels !== 1 && channels !== 2) || wav.readUInt32LE(24) !== sampleRate ||
      wav.readUInt32LE(28) !== sampleRate * channels * 2 || wav.readUInt16LE(32) !== channels * 2 ||
      wav.readUInt16LE(34) !== 16 || wav.toString("ascii", 36, 40) !== "data" ||
      wav.readUInt32LE(40) !== wav.length - 44) {
    throw new Error("Invalid or unsupported Audio MCP WAV asset");
  }
  let peak = 0;
  for (let offset = 44; offset < wav.length; offset += 2) {
    peak = Math.max(peak, Math.abs(wav.readInt16LE(offset)));
  }
  return { duration_seconds: frames / sampleRate, sample_rate_hz: sampleRate,
    channels, peak_amplitude: peak / 32768, silent: peak === 0 };
}
