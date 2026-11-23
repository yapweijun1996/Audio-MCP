import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { browserBank } from "./web-bank.mjs";
const root = new URL("../", import.meta.url);
const cwd = fileURLToPath(root),
  out = new URL("dist/studio/", root);
const read = (name) => readFile(new URL(name, root));
const hash = (x) => createHash("sha256").update(x).digest("hex");
const files = new Map();
function asset(label, ext, bytes) {
  const name = label + "-" + hash(bytes).slice(0, 16) + "." + ext;
  files.set(name, bytes);
  return name;
}
const bank = browserBank(await read("assets/cc0/instruments.sf2"));
const sampleURL = asset("recordings", "pcm", bank.pcm);
const regions = JSON.parse(await read("assets/chamber/regions.json"));
const chamberBanks = {};
for (const [voice, rows] of Object.entries(regions)) {
  chamberBanks[voice] = {
    url: asset(voice, "bank", await read("assets/chamber/" + voice + ".bank")),
    rows: rows.map(({ source, sha256, ...region }) => region),
  };
}
async function bundle(entry, opts = {}) {
  const result = await build({
    absWorkingDir: cwd,
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: "browser",
    target: "es2022",
    minify: true,
    legalComments: "eof",
    inject: [fileURLToPath(new URL("web/buffer.js", root))],
    ...opts,
  });
  return result.outputFiles[0].contents;
}
const worker = asset(
  "engine",
  "js",
  await bundle("web/render-worker.js", {
    plugins: [
      {
        name: "bank",
        setup(b) {
          b.onResolve({ filter: /^bank:assets$/ }, () => ({
            path: "bank",
            namespace: "bank",
          }));
          b.onLoad({ filter: /.*/, namespace: "bank" }, () => ({
            contents:
              "export const zones=" +
              JSON.stringify(bank.zones) +
              ";export const sampleURL=" +
              JSON.stringify(sampleURL) + ";export const chamberBanks=" + JSON.stringify(chamberBanks),
          }));
        },
      },
    ],
  }),
);
const app = asset(
  "studio",
  "js",
  await bundle("web/app.js", {
    define: { WORKER_PATH: JSON.stringify("./" + worker) },
  }),
);
const css = asset("studio", "css", await read("web/studio.css"));
for (const name of ["manifest.webmanifest", "icon-192.png", "icon-512.png"])
  files.set(name, await read("web/" + name));
files.set(
  "index.html",
  (await read("web/index.html"))
    .toString()
    .replace("APP_FILE", app)
    .replace("STYLE_FILE", css),
);
const licenses = [
  "assets/cc0/README.md",
  "assets/chamber/README.md",
  "assets/cc0/LICENSE.txt",
  "node_modules/buffer/LICENSE",
  "node_modules/base64-js/LICENSE",
  "node_modules/ieee754/LICENSE",
  "node_modules/midi-file/LICENSE.md",
];
files.set(
  "credits.txt",
  (
    await Promise.all(licenses.map(async (p) => p + "\n\n" + (await read(p))))
  ).join("\n\n"),
);
const entries = [...files].map(([k, v]) => [k, hash(v)]);
// Listening copies can stream immediately on a phone without installing the studio.
const previews = ["over-the-footbridge.mp3", "corner-table.mp3", "after-the-rain.mp3"];
for (const name of previews) files.set(name, await read("web/previews/" + name));
const sw = (await read("web/sw.js")).toString();
const version = hash(JSON.stringify(entries) + previews.map(name => hash(files.get(name))).join("") + sw).slice(0, 16);
files.set(
  "sw.js",
  sw
    .replace("__VERSION__", version)
    .replace("__PRECACHE__", JSON.stringify(entries)),
);
await mkdir(out, { recursive: true });
for (const [name, data] of files) await writeFile(new URL(name, out), data);
console.log("Audio MCP Studio", version, "→", fileURLToPath(out));

if (process.argv.includes("--package")) {
  const archive = fileURLToPath(
    new URL("../audio-mcp-studio-" + version + ".tar.gz", out),
  );
  execFileSync("tar", [
    "-czf",
    archive,
    "-C",
    fileURLToPath(out),
    ...files.keys(),
  ], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  console.log(
    "Release archive:",
    archive,
    "SHA-256:",
    hash(await readFile(archive)),
  );
}
