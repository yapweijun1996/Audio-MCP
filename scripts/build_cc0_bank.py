"""Rebuild the bundled mono SF2 from pinned CC0 recordings. Requires Python 3 and ffmpeg."""
from array import array
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from struct import pack
from tempfile import TemporaryDirectory
from urllib.parse import quote
import subprocess
import sys

DEST = Path(__file__).resolve().parents[1] / "assets/cc0/instruments.sf2"
SOURCES = {
    "marimba": "sgossner/VCSL/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e",
    "cello": "sgossner/VSCO-2-CE/440300901dfe9275fd84e0b7763af1f8443ae62e",
    "drums": "sfzinstruments/virtuosity_drums/9f04cf9a734527edfbb0a4eee1f674e45bbf71bc",
}
RATE = 32000


def pitched_zones(keys):
    """Split the keyboard halfway between adjacent recording pitches."""
    low = 0
    for i, (key, name) in enumerate(keys):
        high = (key + keys[i + 1][0]) // 2 if i + 1 < len(keys) else 127
        yield key, low, high, name
        low = high + 1


def zones():
    for key, low, high, name in pitched_zones([(55, "G2"), (59, "B2"), (65, "F3"), (72, "C4"), (79, "G4")]):
        for layer, vlow, vhigh in [("soft", 0, 70), ("med", 71, 127)]:
            path = f"Idiophones/Struck Idiophones/Marimba/Marimba_hit_Outrigger_{name}_{layer}_01.wav"
            yield "marimba", path, key, low, high, vlow, vhigh
    for key, low, high, name in pitched_zones([(43, "G1"), (47, "B1"), (50, "D2"), (53, "F2"), (57, "A2"), (60, "C3"), (64, "E3")]):
        yield "cello", f"Strings/Cello Section/susvib/susvib_{name}_v1_1.wav", key, low, high, 0, 127
    for key, layers in [
        (36, ["kickmic/kick/kickmic_kick_snon_vl3_rr2", "kickmic/kick/kickmic_kick_snon_vl3_rr1"]),
        (38, ["oh/snare/oh_snare_center_vl8", "oh/snare/oh_snare_center_vl23"]),
        (42, ["oh/hh/oh_hh_closed_vl2_rr2", "oh/hh/oh_hh_closed_vl3_rr1"]),
        (46, ["oh/hh/oh_hh_half_vl2_rr1"]),
    ]:
        for i, path in enumerate(layers):
            yield "drums", f"Samples/{path}.flac", key, key, key, 71 if i else 0, 70 if len(layers) == 2 and not i else 127


def chunk(tag, data):
    return tag.encode() + pack("<I", len(data)) + data + bytes(len(data) % 2)


def recording(zone):
    family, path = zone[:2]
    url = "https://raw.githubusercontent.com/" + SOURCES[family] + "/" + quote(path)
    with TemporaryDirectory() as folder:
        source = Path(folder) / Path(path).name
        subprocess.run(["curl", "-fsSL", "--retry", "3", url, "-o", str(source)], check=True)
        raw = subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(source), "-ac", "1",
                                       "-ar", str(RATE), "-t", "5", "-f", "s16le", "-"])
    pcm = array("h")
    pcm.frombytes(raw)
    if sys.byteorder != "little":
        pcm.byteswap()
    peak = max(abs(x) for x in pcm)
    onset = next(i for i, x in enumerate(pcm) if abs(x) > peak * .01)
    pcm = pcm[max(0, onset - RATE // 100):]
    for i in range(min(len(pcm), 640)):
        pcm[-1-i] = round(pcm[-1-i] * i / 640)
    pcm = array("h", (round(x * 27000 / peak) for x in pcm))
    if sys.byteorder != "little":
        pcm.byteswap()
    return pcm.tobytes()


def build():
    presets = [("marimba", 12, 0), ("cello", 42, 0), ("drums", 0, 128)]
    tables = {k: bytearray() for k in ("phdr", "pbag", "pmod", "pgen", "inst", "ibag", "imod", "igen", "shdr")}
    samples = BytesIO()
    regions = list(zones())
    with ThreadPoolExecutor(max_workers=4) as pool:
        recordings = list(pool.map(recording, regions))
    for inst_id, (family, program, bank) in enumerate(presets):
        tables["phdr"] += pack("<20sHHHIII", family.encode(), program, bank, inst_id, 0, 0, 0)
        tables["pbag"] += pack("<HH", inst_id, 0)
        tables["pgen"] += pack("<HH", 41, inst_id)
        tables["inst"] += pack("<20sH", family.encode(), len(tables["ibag"]) // 4)
        for i, (group, path, root, lo, hi, vlo, vhi) in enumerate(regions):
            if family != group:
                continue
            tables["ibag"] += pack("<HH", len(tables["igen"]) // 4, 0)
            # SF2 key range, velocity range, release timecents and terminal sample ID.
            release = {"marimba": -1200, "cello": -3200, "drums": -600}[family]
            tables["igen"] += pack("<HBBHBBHhHH", 43, lo, hi, 44, vlo, vhi, 38, release, 53, i)
            start = samples.tell() // 2
            samples.write(recordings[i])
            end = samples.tell() // 2
            samples.write(bytes(46 * 2))
            tables["shdr"] += pack("<20sIIIIIBbHH", Path(path).stem.encode()[:20], start, end,
                                    start + 8, end - 8, RATE, root, 0, 0, 1)
    count = len(presets)
    tables["phdr"] += pack("<20sHHHIII", b"EOP", 0, 0, count, 0, 0, 0)
    tables["pbag"] += pack("<HH", count, 0)
    tables["inst"] += pack("<20sH", b"EOI", len(regions))
    tables["ibag"] += pack("<HH", len(tables["igen"]) // 4, 0)
    for tag in ("pmod", "imod"):
        tables[tag] += bytes(10)
    for tag in ("pgen", "igen"):
        tables[tag] += bytes(4)
    tables["shdr"] += pack("<20s26x", b"EOS")
    info = chunk("ifil", pack("<HH", 2, 1)) + chunk("isng", b"EMU8000\0") + chunk("INAM", b"Audio MCP CC0\0")
    bank = (chunk("LIST", b"INFO" + info) + chunk("LIST", b"sdta" + chunk("smpl", samples.getvalue())) +
            chunk("LIST", b"pdta" + b"".join(chunk(tag, data) for tag, data in tables.items())))
    DEST.write_bytes(chunk("RIFF", b"sfbk" + bank))


if __name__ == "__main__":
    build()
