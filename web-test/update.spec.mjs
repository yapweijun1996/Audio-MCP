import http from "node:http";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { test, expect } from "@playwright/test";

test("rejects a mixed release, coordinates tabs and applies an intact update", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Chromium release lifecycle gate");
  const root = new URL("../dist/studio/", import.meta.url);
  const html = await readFile(new URL("index.html", root), "utf8");
  const changed = html.replace(
    "Audio MCP · Sound studio",
    "Audio MCP · Updated studio",
  );
  const sw = await readFile(new URL("sw.js", root), "utf8");
  const sha = (text) => createHash("sha256").update(text).digest("hex");
  const second = sw
    .replace(/const version\s*=\s*"[^"]+"/, 'const version="update-fixture"')
    .replace(sha(html), sha(changed));
  let phase = "first";
  const server = http.createServer(async (req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/studio/index.html") {
      res.writeHead(307, { Location: "/studio/" + new URL(req.url, "http://localhost").search }).end();
      return;
    }
    const file = path.replace(/^\/studio\//, "") || "index.html";
    if (!/^[\w.-]+$/.test(file)) {
      res.writeHead(404).end();
      return;
    }
    try {
      let body = await readFile(new URL(file, root));
      if (file === "sw.js" && phase !== "first") body = second;
      if (file === "index.html" && phase === "complete") body = changed;
      const ext = file.split(".").at(-1);
      res
        .writeHead(200, {
          "Content-Type":
            {
              html: "text/html",
              js: "text/javascript",
              css: "text/css",
              webmanifest: "application/manifest+json",
            }[ext] || "application/octet-stream",
          "Cache-Control": "no-store",
        })
        .end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = "http://127.0.0.1:" + server.address().port + "/studio/";
  try {
    await page.goto(address);
    await expect(page.locator("#connection")).toHaveText("Offline ready");
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await expect(page.locator("#play")).toBeEnabled();
    await page.locator("#generate").click();
    await expect(page.locator("#count")).toHaveText("1 TAKE");
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator("#count")).toHaveText("1 TAKE");
    await context.setOffline(false);
    await page.locator("#tempo").fill("133");
    phase = "mixed";
    const rejected = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      const outcome = new Promise((resolve) =>
        reg.addEventListener(
          "updatefound",
          () => {
            const w = reg.installing;
            w.addEventListener("statechange", () => {
              if (["installed", "redundant"].includes(w.state))
                resolve(w.state);
            });
          },
          { once: true },
        ),
      );
      await reg.update();
      return outcome;
    });
    expect(rejected).toBe("redundant");
    await expect(page.locator("#updateNotice")).toBeHidden();
    expect(await page.evaluate(() => caches.keys())).toHaveLength(1);
    const other = await context.newPage();
    await other.goto(address);
    phase = "complete";
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.ready).update();
    });
    await expect(page.locator("#updateNotice")).toBeVisible();
    await page.locator("#update").click();
    await expect(page.locator("#updateText")).toContainText(
      "Close other studio tabs",
    );
    await other.close();
    await page.locator("#update").click();
    await expect(page).toHaveTitle("Audio MCP · Updated studio");
    await expect(page.locator("#tempo")).toHaveValue("133");
    await expect(page.locator("#count")).toHaveText("1 TAKE");
    await expect(page.locator("#updateNotice")).toBeHidden();
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
