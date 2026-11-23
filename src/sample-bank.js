export const bundledBankURL = new URL("../assets/cc0/instruments.sf2", import.meta.url);

/**
 * Read the PCM and zones of the bundled mono SF2 created by build_cc0_bank.py.
 * @param {Buffer} sf2
 * @returns {{ pcm: Buffer, zones: Array<{ instrument: string, low: number, high: number,
 *   soft: number, loud: number, release: number, start: number, end: number,
 *   rate: number, root: number }> }}
 */
export function readSampleBank(sf2) {
  const chunks = new Map();
  function visit(start, end) {
    for (let p = start; p + 8 <= end;) {
      const name = sf2.toString("ascii", p, p + 4);
      const length = sf2.readUInt32LE(p + 4);
      const from = p + 8;
      if (from + length > end) throw Error("Truncated CC0 bank");
      if (name === "LIST") visit(from + 4, from + length);
      else chunks.set(name, sf2.subarray(from, from + length));
      p = from + length + (length % 2);
    }
  }
  visit(12, sf2.length);
  const inst = chunks.get("inst"),
    bags = chunks.get("ibag"),
    gens = chunks.get("igen"),
    samples = chunks.get("shdr");
  const zones = [];
  for (let p = 0; p + 22 < inst.length; p += 22) {
    const instrument = inst.toString("ascii", p, p + 20).split("\0")[0];
    for (
      let b = inst.readUInt16LE(p + 20);
      b < inst.readUInt16LE(p + 42);
      b++
    ) {
      const zone = { instrument };
      for (
        let g = bags.readUInt16LE(b * 4);
        g < bags.readUInt16LE((b + 1) * 4);
        g++
      ) {
        const at = 4 * g,
          type = gens.readUInt16LE(at);
        if (type === 43) [zone.low, zone.high] = gens.subarray(at + 2, at + 4);
        if (type === 44) [zone.soft, zone.loud] = gens.subarray(at + 2, at + 4);
        if (type === 38) {
          const seconds = 2 ** (gens.readInt16LE(at + 2) / 1200);
          // JS runtimes can round the power differently. Keep the bundled release ID reproducible.
          zone.release = Math.round(seconds * 1e9) / 1e9;
        }
        if (type === 53) {
          const s = 46 * gens.readUInt16LE(at + 2);
          zone.start = samples.readUInt32LE(s + 20);
          zone.end = samples.readUInt32LE(s + 24);
          zone.rate = samples.readUInt32LE(s + 36);
          zone.root = samples[s + 40];
        }
      }
      if (
        !Number.isInteger(zone.start) ||
        zone.end * 2 > chunks.get("smpl").length
      )
        throw Error("Invalid sample zone");
      zones.push(zone);
    }
  }
  return { zones, pcm: chunks.get("smpl") };
}
