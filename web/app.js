import { decodeRecordings } from "./chamber-audio.js";
import { storageKey } from "./scope.js";
import { names, choices, defaults, featured } from "./catalog.js";
import { drumPatterns } from "../src/instruments.ts";
import * as library from "./library.js";
import { setupPWA } from "./install.js";
const $ = (id) => document.getElementById(id);
const audio = $("audio"),
  form = $("controls"),
  canvas = $("wave");
const message = (text) => {
  $("message").textContent = text;
};
const patternName = {
  backbeat: "Backbeat",
  half_time: "Half-time",
  swing: "Swing",
};
const announce =
  typeof BroadcastChannel === "function"
    ? new BroadcastChannel(storageKey("audio-mcp-takes"))
    : null;
const prefs = { ...defaults };
try {
  Object.assign(
    prefs,
    JSON.parse(sessionStorage.getItem(storageKey("composer")) || "{}"),
  );
} catch {}
let active,
  urls = [],
  worker,
  busy = false,
  viewSequence = 0,
  listSequence = 0,
  animation = 0;
let cancelRender;
let storedDraft = false;
try {
  storedDraft = !!sessionStorage.getItem(storageKey("composer"));
} catch {}
function remember() {
  try {
    sessionStorage.setItem(storageKey("composer"), JSON.stringify(prefs));
  } catch {}
}
function fillSelect(el, values, labels, selected) {
  el.replaceChildren(...values.map((v) => new Option(labels[v], v)));
  el.value = values.includes(selected) ? selected : values[0];
}
function paintForm() {
  const fx = prefs.mode === "effect";
  prefs.mode = fx ? "effect" : "instrument";
  $("effectMode").setAttribute("aria-pressed", String(fx));
  $("instrumentMode").setAttribute("aria-pressed", String(!fx));
  $("voiceLabel").textContent = fx ? "Sound effect" : "Instrument or arrangement";
  fillSelect($("voice"), choices[prefs.mode], names, prefs[prefs.mode]);
  $("patternField").hidden = fx || $("voice").value !== "acoustic_drums";
  $("tempoField").hidden = $("seedField").hidden = fx;
  $("seed").disabled = $("tempo").disabled = fx;
  $("duration").min = fx ? "0.02" : "1";
  $("duration").max = fx ? "3" : "60";
  $("duration").value = fx ? prefs.effectSeconds : prefs.seconds;
  $("tempo").value = prefs.bpm;
  $("seed").value = prefs.seed;
  $("pattern").value = prefs.pattern;
}
fillSelect($("pattern"), drumPatterns, patternName, prefs.pattern);
function readForm() {
  prefs[prefs.mode] = $("voice").value;
  prefs[prefs.mode === "effect" ? "effectSeconds" : "seconds"] =
    $("duration").valueAsNumber;
  if (prefs.mode !== "effect") {
    prefs.bpm = $("tempo").valueAsNumber;
    prefs.seed = $("seed").valueAsNumber;
    prefs.pattern = $("pattern").value;
  }
  if (form.checkValidity()) remember();
}
for (const mode of ["instrument", "effect"])
  $(mode + "Mode").onclick = () => {
    prefs.mode = mode;
    paintForm();
    remember();
  };
form.oninput = readForm;
$("voice").onchange = () => {
  readForm();
  $("patternField").hidden = $("voice").value !== "acoustic_drums";
};
$("random").onclick = () => {
  $("seed").value = crypto.getRandomValues(new Uint32Array(1))[0];
  readForm();
};
const formatTime = (v) =>
  active && duration(active.params) < 1
    ? v.toFixed(2) + " s"
    : Math.floor(v / 60) + ":" + String(Math.floor(v % 60)).padStart(2, "0");
const duration = (p) => (p.mode === "effect" ? p.effectSeconds : p.seconds);
function describe(p) {
  const parts = [
    p.mode === "effect" ? "UI effect" : p.bpm + " BPM",
    duration(p) + " sec",
  ];
  if (p.mode === "instrument" && p.instrument === "acoustic_drums")
    parts.push(patternName[p.pattern]);
  return parts.join(" · ");
}
function draw() {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const rect = canvas.getBoundingClientRect(),
    dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.round(rect.width * dpr),
    h = Math.round(rect.height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.clearRect(0, 0, w, h);
  if (!active) return;
  const peaks = active.peaks,
    progress = audio.currentTime / duration(active.params);
  const n = Math.min(peaks.length, Math.max(1, Math.floor(rect.width / 4)));
  const max = Math.max(0.03, ...peaks);
  for (let i = 0; i < n; i++) {
    const height = Math.max(
      dpr * 2,
      (peaks[Math.floor((i * peaks.length) / n)] / max) * h * 0.84,
    );
    ctx.fillStyle = i / n < progress ? "#f4a978" : "#d8ea80";
    ctx.fillRect(
      (w * i) / n,
      (h - height) / 2,
      Math.max(1, w / n - dpr * 1.3),
      height,
    );
  }
  $("seek").value = audio.currentTime;
  $("elapsed").textContent = formatTime(audio.currentTime);
}
function frame() {
  draw();
  if (!audio.paused) animation = requestAnimationFrame(frame);
}
function playState() {
  const playing = !audio.paused;
  $("playText").textContent = playing ? "Pause" : "Play";
  $("playIcon").textContent = playing ? "Ⅱ" : "▶";
  $("play").setAttribute(
    "aria-label",
    playing ? "Pause preview" : "Play preview",
  );
  cancelAnimationFrame(animation);
  frame();
}
for (const ev of ["play", "pause", "ended"])
  audio.addEventListener(ev, playState);
audio.addEventListener("timeupdate", draw);
$("play").onclick = async () => {
  try {
    if (audio.paused) await audio.play();
    else audio.pause();
  } catch {
    message("Playback is unavailable. Download the WAV to listen.");
  }
};
$("seek").oninput = () => {
  if (Number.isFinite(audio.duration))
    audio.currentTime = Number($("seek").value);
  draw();
};
new ResizeObserver(draw).observe(canvas);
function loadTake(meta, blobs) {
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  urls.forEach(URL.revokeObjectURL);
  urls = [];
  active = meta;
  const name = names[meta.params[meta.params.mode]];
  $("monitorTitle").textContent = name;
  $("details").textContent = describe(meta.params);
  $("length").textContent = formatTime(duration(meta.params));
  $("elapsed").textContent = "0:00";
  $("seek").max = duration(meta.params);
  $("seek").value = 0;
  $("seek").disabled = false;
  for (const type of ["wav", "midi"]) {
    const a = $(type),
      blob = blobs[type];
    a.hidden = !blob;
    if (!blob) {
      a.removeAttribute("href");
      continue;
    }
    const url = URL.createObjectURL(
      blob instanceof Blob
        ? blob
        : new Blob([blob], {
            type: type === "wav" ? "audio/wav" : "audio/midi",
          }),
    );
    urls.push(url);
    a.href = url;
    a.download =
      name.toLowerCase().replaceAll(" ", "-") +
      "-" +
      meta.id.slice(0, 8) +
      (type === "wav" ? ".wav" : ".mid");
    if (type === "wav") audio.src = url;
  }
  $("play").disabled = false;
  draw();
}
function render(params) {
  return new Promise((resolve, reject) => {
    worker = new Worker(new URL(WORKER_PATH, document.baseURI));
    const deadline = setTimeout(() => {
      worker?.terminate();
      reject(Error("Render timed out. Try a shorter duration."));
    }, 90000);
    cancelRender = () => {
      clearTimeout(deadline);
      reject(Error("Render interrupted. Generate the take again."));
    };
    const renderingWorker = worker;
    worker.onmessage = async (e) => {
      if (e.data.recordingRequest) {
        try {
          const { recordings, transfers } = await decodeRecordings(e.data.recordingRequest);
          renderingWorker.postMessage({ recordings }, transfers);
        } catch (error) {
          clearTimeout(deadline);
          reject(error);
        }
        return;
      }
      clearTimeout(deadline);
      e.data.error ? reject(Error(e.data.error)) : resolve(e.data);
    };
    worker.onerror = () => {
      clearTimeout(deadline);
      reject(
        Error(
          "Could not start the audio engine. Reopen the studio and try again.",
        ),
      );
    };
    worker.postMessage(params);
  }).finally(() => {
    worker?.terminate();
    worker = null;
    cancelRender = null;
  });
}
async function generate(params, save) {
  if (busy) return;
  busy = true;
  viewSequence++;
  $("generate").disabled = true;
  form.setAttribute("aria-busy", "true");
  message(
    save ? "Rendering audio on this device…" : "Loading the sound preview…",
  );
  try {
    const { peaks, ...blobs } = await render(params);
    const meta = {
      id: crypto.randomUUID(),
      created: Date.now(),
      params,
      peaks,
    };
    loadTake(meta, blobs);
    if (save) {
      try {
        await library.save(meta, blobs);
        try {
          sessionStorage.setItem(storageKey("monitorTake"), meta.id);
        } catch {}
        await refresh();
        announce?.postMessage("changed");
        message("Take saved to your library.");
      } catch {
        message(
          "Could not save to this device. Your preview and downloads are still available.",
        );
      }
    } else
      message("Preview ready. Generate a take to save it to your library.");
  } catch (e) {
    message(e.message);
  } finally {
    busy = false;
    $("generate").disabled = false;
    form.removeAttribute("aria-busy");
  }
}
form.onsubmit = (e) => {
  e.preventDefault();
  readForm();
  if (form.reportValidity()) generate({ ...prefs }, true);
};
async function openTake(meta, scroll, restoreForm = true) {
  const sequence = ++viewSequence;
  const blobs = await library.files(meta.id);
  if (sequence !== viewSequence || busy) return;
  if (!blobs) {
    message("This take was removed in another tab.");
    await refresh();
    return;
  }
  loadTake(meta, blobs);
  if (restoreForm) {
    Object.assign(prefs, meta.params);
    paintForm();
    remember();
  }
  try {
    sessionStorage.setItem(storageKey("monitorTake"), meta.id);
  } catch {}
  message("Saved take loaded.");
  if (scroll) $("studio").scrollIntoView();
}
async function refresh() {
  const sequence = ++listSequence,
    rows = (await library.list()).sort((a, b) => b.created - a.created);
  if (sequence !== listSequence) return rows;
  $("count").textContent =
    rows.length + " " + (rows.length === 1 ? "TAKE" : "TAKES");
  const frag = document.createDocumentFragment();
  for (const row of rows) {
    const el = document.createElement("div");
    el.className = "take";
    const art = document.createElement("span");
    art.className = "swatch";
    art.setAttribute("aria-hidden", "true");
    const open = document.createElement("button");
    open.className = "open";
    open.textContent = names[row.params[row.params.mode]];
    const detail = document.createElement("small");
    detail.textContent =
      describe(row.params) + " · " + new Date(row.created).toLocaleString();
    open.append(detail);
    open.onclick = () => {
      if (!busy)
        openTake(row, true).catch(() => message("Could not load that take."));
    };
    const del = document.createElement("button");
    del.className = "delete";
    del.textContent = "Delete";
    del.setAttribute(
      "aria-label",
      "Delete " + open.firstChild.textContent + " take",
    );
    del.onclick = async () => {
      if (!confirm("Delete this saved take from this device?")) return;
      try {
        await library.remove(row.id);
        await refresh();
        announce?.postMessage("changed");
        message("Take removed from your library.");
      } catch {
        message("Could not remove the take. Try again.");
      }
    };
    el.append(art, open, del);
    frag.append(el);
  }
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Your generated takes will appear here.";
    frag.append(empty);
  }
  $("takes").replaceChildren(frag);
  return rows;
}
announce?.addEventListener("message", () =>
  refresh().catch(() => message("Library unavailable.")),
);
window.addEventListener("pagehide", () => cancelRender?.());
paintForm();
setupPWA(() => busy, remember);
(async () => {
  const piece = new URL(location.href).searchParams.get("piece");
  const preset = Object.hasOwn(featured, piece) ? featured[piece] : null;
  if (preset) {
    Object.assign(prefs, defaults, preset);
    paintForm();
    remember();
    const url = new URL(location.href);
    url.searchParams.delete("piece");
    history.replaceState(history.state, "", url);
    await refresh().catch(() => {});
    await generate({ ...prefs }, false);
    return;
  }
  let rows = [];
  try {
    rows = await refresh();
    let selected;
    try {
      selected = sessionStorage.getItem(storageKey("monitorTake"));
    } catch {}
    if (rows.length)
      await openTake(
        rows.find((row) => row.id === selected) || rows[0],
        false,
        !storedDraft,
      );
  } catch {
    message("Local storage is unavailable. You can still render and download.");
  }
  if (!active && !busy) await generate({ ...prefs }, false);
})().catch((e) => message(e.message));
