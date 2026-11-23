"""Build the acoustic recordings with Python 3, curl, libarchive tar and FFmpeg."""
from array import array
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import quote
import json
import math
import re
import shutil
import subprocess
import sys

DEST = Path(__file__).resolve().parents[1] / "assets/chamber"
RAW = "https://raw.githubusercontent.com/sgossner/"
VCSL = "VCSL/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/"
VSCO = "VSCO-2-CE/440300901dfe9275fd84e0b7763af1f8443ae62e/"
MAPPING = "VSCO-2-CE/6dd651d55dde97fd4028699be9d4481f26917891/"
RATE = 32000
GUITAR = "https://freepats.zenvoid.org/Guitar/SpanishClassicalGuitar/SpanishClassicalGuitar-SFZ+FLAC-20190618.7z"
GUITAR_SHA = "903916921a21662d2237ade7f0e98e55de93cb7b86da219e4e10f4ad385b8f5e"
ELECTRIC = "https://raw.githubusercontent.com/freepats/electric-bass-YR/8dcb7ea9116f417273ef8c030d15e7b3aa654301/"


def fetch(path):
    return subprocess.check_output(["curl", "-fsSL", "--retry", "3", RAW + quote(path)])


def plucked_regions(temp):
    archive = temp / "guitar.7z"
    subprocess.run(["curl", "-fsSL", "--retry", "3", GUITAR, "-o", str(archive)], check=True)
    if sha256(archive.read_bytes()).hexdigest() != GUITAR_SHA:
        raise ValueError("Spanish guitar archive checksum mismatch")
    tar = shutil.which("bsdtar") or "tar"
    mapping = subprocess.check_output([tar, "-xOf", str(archive), "*.sfz"]).decode()
    electric = subprocess.check_output(["curl", "-fsSL", "--retry", "3",
        ELECTRIC + "FingerBassYR%2020190930.sfz"]).decode()
    for voice, sfz in [("guitar", mapping), ("electric", electric)]:
        for region in sfz.split("<region>")[1:]:
            key = int(re.search(r"\b(?:pitch_keycenter|key)=(\d+)", region)[1])
            path = re.search(r"sample=(\S+)", region)[1]
            if voice == "guitar":
                if not 48 <= key <= 76 or key % 2 == 1 and key not in (55, 67):
                    continue
                source = GUITAR + "#" + path
                (temp / ("guitar-" + Path(path).name)).write_bytes(subprocess.check_output(
                    [tar, "-xOf", str(archive), "*/" + path]))
            else:
                source = ELECTRIC + quote(path)
            yield voice, key, 0, 0, source


def regions(temp):
    yield from plucked_regions(temp)
    pitches = ["C2", "F#2", "A#2", "D3", "F#3", "A#3", "D4", "F#4", "A#4", "D5", "F#5", "A#5"]
    for pitch in pitches:
        key = (int(pitch[-1]) + 1) * 12 + {"C": 0, "D": 2, "F#": 6, "A#": 10}[pitch[:-1]]
        for layer in [2, 3, 4]:
            name = f"JHPiano_Sus_Close_{pitch}_vl{layer}_rr1.wav"
            yield "piano", key, layer, 0, VCSL + "Chordophones/Zithers/Grand Piano, Steinway B/Sus/" + name
    # Use the publisher's MIDI root and fine-tuning, which vary by session.
    for voice, mapping, low, high in [
        ("violin", "SViolinVib", 55, 84), ("cello", "CelloEnsSusVib", 36, 71),
        ("bass", "ContrabassPizz", 28, 52), ("flute", "FluteSusVib", 60, 84),
    ]:
        sfz = fetch(MAPPING + mapping + ".sfz").decode("utf-8-sig")
        folder = re.search(r"default_path=(.+)", sfz)[1].strip().replace(chr(92), "/")
        seen = set()
        for region in sfz.split("<region>")[1:]:
            op = dict(re.findall(r"(?m)^([a-z_]+)=(.+)", region.split("<group>")[0]))
            name = op["sample"].strip()
            key = int(op["pitch_keycenter"])
            layer = int(op.get("lovel", 0))
            if not low <= key <= high or (key, layer) in seen:
                continue
            seen.add((key, layer))
            yield voice, key, layer, int(op.get("tune", 0)), VSCO + folder + name


def recording(region, temp):
    voice, key, layer, tune, path = region
    if voice == "guitar":
        source = (temp / ("guitar-" + path.split("/")[-1])).read_bytes()
    elif voice == "electric":
        source = subprocess.check_output(["curl", "-fsSL", "--retry", "3", path])
    else:
        source = fetch(path)
    filename = temp / (voice + "-" + str(key) + "-" + str(layer) + Path(path).suffix)
    filename.write_bytes(source)
    data = subprocess.check_output(["ffmpeg", "-nostdin", "-v", "error", "-i", str(filename),
        "-t", "6.4", "-ar", str(RATE), "-ac", "2", "-f", "s16le", "-"])
    samples = array("h", data)
    if sys.byteorder != "little":
        samples.byteswap()
    peak = max(abs(s) for s in samples)
    attack = next(i//2 for i, s in enumerate(samples) if abs(s) > peak * 0.007)
    samples = samples[2 * max(0, attack - RATE//100):]
    frames = len(samples)//2
    body = samples[:min(len(samples), RATE)]
    rms = math.sqrt(sum(s*s for s in body)/len(body))
    gain = round(min(0.88 * 32767 / peak, 0.145 * 32767 / rms), 5)
    fade = min(frames, RATE//8)
    for i in range(2*fade):
        samples[-1-i] = round(samples[-1-i] * (i//2) / fade)
    if sys.byteorder != "little":
        samples.byteswap()
    encoded = encode_flac(samples.tobytes())
    return voice, dict(key=key, layer=layer, cents=tune, frames=frames, gain=gain,
                       source=path, sha256=sha256(source).hexdigest()), encoded


def encode_flac(pcm):
    return subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-f", "s16le", "-ar", str(RATE),
        "-ac", "2", "-i", "-", "-map_metadata", "-1", "-compression_level", "8",
        "-f", "flac", "-"], input=pcm, stdout=subprocess.PIPE, check=True).stdout


def build():
    DEST.mkdir(exist_ok=True, parents=True)
    with TemporaryDirectory() as work:
        temp = Path(work)
        index = {}
        with ThreadPoolExecutor(max_workers=6) as pool:
            for voice, meta, content in pool.map(lambda z: recording(z, temp), regions(temp)):
                rows = index.setdefault(voice, [])
                with (temp / (voice + ".bank")).open("ab") as out:
                    meta["offset"] = out.tell()
                    meta["bytes"] = len(content)
                    out.write(content)
                rows.append(meta)
        for voice in index:
            (temp / (voice + ".bank")).replace(DEST / (voice + ".bank"))
        (DEST / "regions.json").write_text(json.dumps(index, indent=2) + "\n")


if __name__ == "__main__":
    build()
