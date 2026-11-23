import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseMidi } from "midi-file";
import { composeInstrument } from "../dist/instruments.js";
import { analyze } from "../dist/audio.js";

async function download(page, id) {
  const next = page.waitForEvent("download");
  await page.locator("#" + id).click();
  return readFile(await (await next).path());
}
async function render(page) {
  await page.getByRole("button", { name: "Generate & save" }).click();
  await expect(page.locator("#message")).toHaveText(
    "Take saved to your library.",
  );
}
test("compose, play, export, reopen offline and delete", async ({
  page,
  context,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await expect(page.locator("#connection")).toHaveText("Offline ready");
  await expect(page.locator("#play")).toBeEnabled();
  await expect(page.locator("#monitorTitle")).toHaveText("Marimba");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.selectOption("#voice", "acoustic_drums");
  await page.selectOption("#pattern", "swing");
  await page.locator("#duration").fill("2.4");
  await render(page);
  const midi = await download(page, "midi");
  expect(
    midi.equals(composeInstrument("acoustic_drums", 2.4, 100, 42, "swing")),
  ).toBeTruthy();
  expect(parseMidi(midi).tracks.length).toBe(2);
  const wav = analyze(await download(page, "wav"));
  expect(wav.duration_seconds).toBe(2.4);
  expect(wav.silent).toBe(false);
  await page.locator("#play").click();
  await expect
    .poll(() => page.locator("audio").evaluate((a) => a.currentTime))
    .toBeGreaterThan(0);
  await page.locator("#tempo").fill("117");
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#monitorTitle")).toHaveText("Acoustic drums");
  await expect(page.locator("#tempo")).toHaveValue("117");
  await expect(page.locator("#count")).toHaveText("1 TAKE");
  expect(
    await page.evaluate(async () => {
      try {
        await fetch("./uncached-network-probe");
        return false;
      } catch {
        return true;
      }
    }),
  ).toBeTruthy();
  await page.selectOption("#voice", "cello_ensemble");
  await render(page);
  expect(analyze(await download(page, "wav")).silent).toBe(false);
  await page.locator("#effectMode").click();
  await page.selectOption("#voice", "click");
  await page.locator("#duration").fill("0.06");
  await render(page);
  expect(analyze(await download(page, "wav")).duration_seconds).toBe(0.06);
  await expect(page.locator("#midi")).toBeHidden();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete Click take" }).click();
  await expect(page.locator("#count")).toHaveText("2 TAKES");
  expect(errors).toEqual([]);
});
test("all voices and effects produce real audio, with input and storage failure recovery", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator("#play")).toBeEnabled();
  for (const voice of [
    "marimba",
    "nylon_guitar",
    "finger_bass",
    "flute",
    "piano",
    "cello_ensemble",
    "acoustic_drums",
  ]) {
    await page.selectOption("#voice", voice);
    await page.locator("#duration").fill("1");
    await render(page);
    const measured = analyze(await download(page, "wav"));
    expect(measured.duration_seconds).toBe(1);
    expect(measured.channels).toBe(["marimba", "acoustic_drums"].includes(voice) ? 1 : 2);
    expect(measured.peak_amplitude).toBeGreaterThan(0.01);
  }
  await page.locator("#tempo").fill("0");
  await page.locator("#generate").click();
  expect(
    await page.locator("#tempo").evaluate((i) => i.validity.rangeUnderflow),
  ).toBeTruthy();
  await page.locator("#effectMode").click();
  for (const effect of ["hover", "success", "error", "whoosh"]) {
    await page.selectOption("#voice", effect);
    await render(page);
    expect(analyze(await download(page, "wav")).silent).toBe(false);
  }
  await page.evaluate(() => {
    IDBObjectStore.prototype.add = function () {
      this.transaction.abort();
      throw new DOMException("Full", "QuotaExceededError");
    };
  });
  await page.locator("#generate").click();
  await expect(page.locator("#message")).toContainText("Could not save");
  expect(analyze(await download(page, "wav")).silent).toBe(false);
  await expect(page.locator("#count")).toHaveText("11 TAKES");
});

test("offline acoustic scores have real stereo, editable parts and deterministic variations", async ({ page, context }) => {
  await page.goto("./?piece=film");
  await expect(page.locator("#monitorTitle")).toHaveText("Film chamber trio");
  await expect(page.locator("#connection")).toHaveText("Offline ready");
  await context.setOffline(true);
  const arrangements = [
    ["film_chamber", [0, 40, 42]], ["cafe_duet", [0, 32]],
    ["lyrical_piano", [0]], ["solo_violin", [40]],
  ];
  for (const [voice, programs] of arrangements) {
    await page.selectOption("#voice", voice);
    await page.locator("#duration").fill("8");
    await render(page);
    const score = parseMidi(await download(page, "midi"));
    const parts = score.tracks.slice(1);
    expect(parts.map(track => track.find(e => e.type === "programChange").programNumber)).toEqual(programs);
    for (const track of parts) expect(track.some(e => e.type === "noteOn")).toBeTruthy();
    const wav = await download(page, "wav");
    const measurements = analyze(wav);
    expect(measurements.channels).toBe(2);
    expect(measurements.duration_seconds).toBe(8);
    expect(measurements.peak_amplitude).toBeGreaterThan(.05);
    expect(measurements.peak_amplitude).toBeLessThan(.95);
    let stereoDifference = 0;
    for (let i = 44; i < wav.length; i += 4 * 127)
      stereoDifference += Math.abs(wav.readInt16LE(i) - wav.readInt16LE(i + 2));
    expect(stereoDifference).toBeGreaterThan(3000);
  }
  const initial = await download(page, "midi");
  await render(page);
  expect((await download(page, "midi")).equals(initial)).toBeTruthy();
  await page.locator("#seed").fill("123");
  await render(page);
  expect((await download(page, "midi")).equals(initial)).toBeFalsy();
});
