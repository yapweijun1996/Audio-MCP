import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
const root = new URL("../dist/studio/", import.meta.url);
const host = process.env.STUDIO_HOST || "127.0.0.1",
  port = Number(process.env.STUDIO_PORT || 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".mp3": "audio/mpeg",
  ".bank": "application/octet-stream",
  ".pcm": "application/octet-stream",
};
await stat(new URL("index.html", root));
const server = http.createServer(async (req, res) => {
  if (!["GET", "HEAD"].includes(req.method)) {
    res.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  const path = req.url.split("?")[0],
    name = path === "/" ? "index.html" : path.slice(1);
  if (!/^[-a-zA-Z0-9]+\.[a-z][a-z0-9]*$/.test(name) || !types[extname(name)]) {
    res.writeHead(404).end();
    return;
  }
  try {
    const data = await readFile(new URL(name, root));
    res.writeHead(200, {
      "Content-Type": types[extname(name)],
      "Content-Length": data.length,
      "Cache-Control": /-[a-f0-9]{16}\./.test(name)
        ? "public, max-age=31536000, immutable"
        : "no-cache",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    res.writeHead(404).end();
  }
});
server.listen(port, host, () =>
  console.log("Audio MCP Studio http://" + host + ":" + server.address().port),
);
