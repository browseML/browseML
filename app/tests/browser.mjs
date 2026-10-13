// SPDX-License-Identifier: MIT
// browseML's browser checks, in a real browser (headless Brave or Chrome, a throwaway profile): the page served as it
// is deployed (dist/, cross-origin isolated), then what a visitor does — the control panel, its tools, a model found in
// a folder on this computer (no download), a question answered with its receipt as a closed accordion, the receipts
// kept in .history and .memory, the prompt cache restored on the next visit, the GPU kernel's exactness page, and a
// question asked with no model going straight to loading it.
//   node tests/browser.mjs [--browser /usr/bin/brave-browser] [--models DIR]   (after `npm run build`)
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, linkSync, writeFileSync, rmSync, copyFileSync, createReadStream, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BROWSER = arg("--browser", "/usr/bin/brave-browser");
const MODELS = arg("--models", `${process.env.HOME}/bML/bankml/.models`);
const PORT = 4186, BASE = `http://127.0.0.1:${PORT}`;
let failed = 0;
const check = (what, ok, more = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${what}${more ? " — " + more : ""}`); failed += !ok; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// the page as deployed: vite preview sends COOP/COEP (threads)
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: new URL("..", import.meta.url).pathname, stdio: "ignore", detached: true });
for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/app.html`)).ok) break; } catch {} await wait(500); }

const tmp = mkdtempSync(join(tmpdir(), "browseml-browser-"));
const folder = join(tmp, "my-models");
mkdirSync(folder);
try { linkSync(join(MODELS, "Bonsai-1.7B-Q1_0.gguf"), join(folder, "Bonsai-1.7B-Q1_0.gguf")); } catch { copyFileSync(join(MODELS, "Bonsai-1.7B-Q1_0.gguf"), join(folder, "Bonsai-1.7B-Q1_0.gguf")); }
writeFileSync(join(folder, "something-else.gguf"), Buffer.alloc(9 << 20));  // another model: listed, not run

let ctxNow = null;
const open = async (profile) => {
  const ctx = ctxNow = await chromium.launchPersistentContext(join(tmp, profile), { executablePath: BROWSER, headless: true, args: ["--headless=new", "--enable-unsafe-webgpu"], viewport: { width: 1366, height: 900 }, acceptDownloads: true });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on("pageerror", (e) => console.log("  page error:", String(e).slice(0, 200)));
  await page.addInitScript(() => { try { if (!localStorage.getItem("browseml:settings")) localStorage.setItem("browseml:settings", JSON.stringify({ ctx: 2048, maxTokens: 128 })); } catch {} });
  await page.goto(`${BASE}/app.html`, { waitUntil: "networkidle" });
  return { ctx, page };
};
const answered = (page, n) => page.waitForFunction((k) => /delivered by the model|No delivery|✗ receipt/.test([...document.querySelectorAll(".uif-output")][k]?.textContent || ""), n, { timeout: 1500000 });

try {
  // ── visit 1: the page, the panel, a model from a folder, an answer with its receipt ─────────────────────────────
  let { ctx, page } = await open("profile-a");
  check("the page: title and logo", (await page.title()) === "browseML — machine learning in your browser" && (await page.locator(".cs-mark img").count()) === 1);
  check("the FAQ: eight questions", (await page.locator(".cs-faq-q").count()) === 8);
  check("no panel at first, T in the field", (await page.locator(".uif-shelves.is-open").count()) === 0 && (await page.locator(".uif-tools-toggle").innerText()) === "T");
  await page.locator(".uif-tools-toggle").click(); await wait(400);
  const folds = (await page.locator(".cp-fold-head").allInnerTexts()).map((t) => t.replace(/[▾▸]/g, "").trim());
  check("T opens the control panel with its sections", ["NOW", "TOOLS", "CPU · RAM · GPU · CACHE", "ENGINE LOG", "RECEIPTS", "MODELS ON THIS COMPUTER", "HARD DRIVE", "DIALS", "DIAGNOSTICS", "TOOL SUITE", "LIMITERS"].every((f) => folds.includes(f)), folds.join(", "));
  const pw = await page.evaluate(() => { const a = document.querySelector(".uif-shelves.is-open"); return a.scrollWidth <= a.clientWidth; });
  check("the panel's content fits its width", pw);
  for (const t of ["MEMORY", "CPU", "STORAGE", "SENSORS", "EXACT"]) {
    const card = page.locator(".cp-tool", { hasText: t }).first();
    await card.getByRole("button", { name: "RUN" }).click();
    await page.waitForFunction(() => !document.querySelector(".cp-tool.is-running"), null, { timeout: 120000 });
    const out = await card.locator(".cp-tool-out").innerText().catch(() => "");
    check(`tool ${t}`, out && !out.startsWith("failed"), out.slice(0, 100));
  }
  const exact = await page.locator(".cp-tool", { hasText: "EXACT" }).first().locator(".cp-tool-out").innerText();
  check("EXACT: every row bit-exact on this GPU", /^(\d+)\/\1 rows bit-exact/.test(exact), exact);

  // a folder on this computer: the folder input (the path every browser has) — recognised, used, no download
  await page.locator(".cp-fold-head", { hasText: "MODELS ON THIS COMPUTER" }).click(); await wait(300);
  await page.locator(".cp-folders input[type=file]").setInputFiles(folder);
  await page.waitForSelector(".cp-found li", { timeout: 30000 });
  const verdicts = await page.locator(".cp-found li .cp-found-verdict").allInnerTexts();
  check("the folder's models listed with their verdicts", verdicts.some((v) => /right size|named/.test(v)) && verdicts.some((v) => /another model/.test(v)), verdicts.join(" | "));
  await page.locator(".cp-found li", { hasText: "Bonsai-1.7B-Q1_0.gguf" }).getByRole("button", { name: "USE" }).click();
  await page.waitForFunction(() => /✓ Bonsai|✓ .*from my-models|could not|not the model/i.test(document.querySelector(".cp-said")?.textContent || ""), null, { timeout: 300000 });
  const used = await page.locator(".cp-said").innerText();
  check("the model from the folder: recognised by sha256, used with no download", /✓/.test(used) && /no download/.test(used), used.slice(0, 140));
  // HARD DRIVE: the storage, the model kept, and a copy of it on the disk
  const hd = page.locator(".cp-disk");
  await hd.getByRole("button", { name: "REFRESH" }).click(); await wait(1500);
  const rows = (await hd.locator(".cp-row").allInnerTexts()).map((t) => t.replace(/\s+/g, " "));
  check("HARD DRIVE: the browser's storage and the model kept", rows.some((r) => /browser \d+ MB of \d+ MB/.test(r)) && rows.some((r) => /model \d+ MB in browser/.test(r)), rows.join(" | "));
  if (await page.evaluate(() => "showDirectoryPicker" in window)) {
    check("HARD DRIVE: a copy on the disk (this browser writes folders: the picker needs a person)", true, "skipped");
  } else {
    const [down] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), hd.getByText("keep a copy on disk").click()]);
    const to = join(tmp, "saved.gguf"); await down.saveAs(to);
    const sha = await new Promise((ok) => { const h = createHash("sha256"); createReadStream(to).on("data", (c) => h.update(c)).on("end", () => ok(h.digest("hex"))); });
    check("HARD DRIVE: keep a copy on the disk — the model saved, its sha256 the pin", down.suggestedFilename() === "Bonsai-1.7B-Q1_0.gguf" && statSync(to).size === 248302272 && sha === "3d7c6c90dd98717a203adb22d5eacd2581850e40aa5327e144b97766cae5f7e3", `${down.suggestedFilename()} · ${statSync(to).size} bytes · ${String(sha).slice(0, 16)}…`);
    await wait(500);
    check("HARD DRIVE: the copy recorded", /Downloads\/Bonsai-1\.7B-Q1_0\.gguf/.test(await hd.innerText()));
    // SAVE FOR bankML: the model and its FORK.json, ready for `bankml serve`
    const got = [];
    page.on("download", (d) => got.push(d));
    await hd.getByRole("button", { name: "SAVE FOR bankML" }).click();
    for (let i = 0; i < 240 && got.length < 2; i++) await wait(500);
    const fork = got.find((d) => d.suggestedFilename().endsWith(".FORK.json"));
    let forkOk = false;
    if (fork) { const to = join(tmp, "fork.json"); await fork.saveAs(to); try { forkOk = JSON.parse(readFileSync(to, "utf8")).files?.[0]?.sha256 === "3d7c6c90dd98717a203adb22d5eacd2581850e40aa5327e144b97766cae5f7e3"; } catch {} }
    check("HARD DRIVE: SAVE FOR bankML — the model and its FORK.json (pinned to the sha256)", got.length === 2 && forkOk, got.map((d) => d.suggestedFilename()).join(" + "));
  }
  await page.locator(".uif-shelves-switch").click(); await wait(300);

  // a question: answered here, its receipt a closed accordion
  await page.locator(".cs-faq-q", { hasText: "Does anything I type" }).click();
  await answered(page, 0);
  const acc = page.locator(".uif-output").first().locator("details.cs-receipt");
  const accHead = acc.locator(":scope > summary");
  check("the receipt under the answer: a closed accordion", (await acc.count()) === 1 && !(await acc.evaluate((d) => d.open)), (await accHead.innerText().catch(() => "")).replace(/\s+/g, " "));
  check("the receipt verified (✓)", /✓ receipt/.test(await accHead.innerText()));
  await accHead.click();
  check("opened: the response's sha256 in the receipt", /response sha256/.test(await acc.innerText()));
  const stored = await page.evaluate(() => ({
    history: JSON.parse(localStorage.getItem("uif:ultimate-clientside:history") || "[]").map((l) => JSON.parse(l)).filter((h) => h.receipt),
    memory: JSON.parse(localStorage.getItem("uif:ultimate-clientside:memory") || "[]").map((l) => JSON.parse(l)).filter((n) => n.source?.kind === "delivery" && n.receipt),
  }));
  check("the receipt kept in .history", stored.history.length >= 1, `${stored.history.length} exchange(s) with a receipt`);
  check("the receipt kept in .memory as a delivery record", stored.memory.length >= 1, `${stored.memory.length} delivery record(s)`);
  // the response window: no reply field unless chosen in its ⋯ menu
  const win = page.locator(".uif-output").first();
  check("a response window has no reply field unless chosen", (await win.locator(".uif-output-reply").count()) === 0);
  await win.getByTitle("This window's settings").click();
  await win.getByText("a reply field in this window").click(); await wait(300);
  check("its ⋯ menu adds one to that window", (await win.locator(".uif-output-reply").count()) === 1);
  await win.getByText("a reply field in this window").click(); await win.getByTitle("This window's settings").click(); await wait(200);
  check("the control panel opened with the response window", (await page.locator(".uif-shelves.is-open").count()) === 1);
  if (!(await page.locator(".uif-shelves.is-open").count())) { await page.locator(".uif-tools-toggle").click(); await wait(300); }
  check("NOW: the answer in the speed chart", (await page.locator(".cp-chart svg rect").count()) >= 1, (await page.locator(".cp-chart figcaption").innerText().catch(() => "")).replace(/\s+/g, " "));
  // arranging: HARD DRIVE dragged by its grip to the top, then hidden, shown, and the layout reset
  const order = () => page.locator(".cp-arrange > [data-arrange]").evaluateAll((els) => els.map((e) => e.getAttribute("data-arrange")));
  const grip = await page.locator('[data-arrange="disk"] .cp-grip').boundingBox(), top = await page.locator(".cp-arrange > [data-arrange]").first().boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down();
  await page.mouse.move(grip.x + 4, top.y + 6, { steps: 12 }); await page.mouse.up(); await wait(300);
  check("a panel section dragged by its grip to the top", (await order())[0] === "disk", (await order()).slice(0, 3).join(" · "));
  await page.locator('[data-arrange="disk"] .cp-hide').click(); await wait(200);
  const hidden = !(await order()).includes("disk");
  await page.getByRole("button", { name: "SHOW HARD DRIVE" }).click(); await wait(200);
  check("a section hidden with –, brought back with SHOW", hidden && (await order()).includes("disk"));
  await page.getByRole("button", { name: "RESET LAYOUT" }).click(); await wait(200);
  check("RESET LAYOUT puts NOW first again", (await order())[0] === "now");
  await page.locator(".cp-fold-head", { hasText: "RECEIPTS" }).click(); await wait(2500);
  check("the panel's RECEIPTS lists it", (await page.locator(".cp-receipts details.cs-receipt").count()) >= 1);
  await page.locator(".cp-receipts").getByText("view receipts under answers").click(); await wait(400);
  check("view receipts off: hidden under answers", (await page.locator(".uif-output details.cs-receipt").count()) === 0);
  await page.locator(".cp-receipts").getByText("view receipts under answers").click(); await wait(400);
  await ctx.close();

  // ── visit 2: the prompt cache restored ────────────────────────────────────────────────────────────────────────
  ({ ctx, page } = await open("profile-a"));
  await wait(3000);
  check("visit 2: the page just loads — nothing started before an interaction", !(await page.evaluate(() => document.querySelector(".uif-shelves.is-open"))));
  await page.mouse.click(900, 650);  // the first interaction: the panel pops out, browseML starts from the kept model
  await page.waitForSelector(".uif-shelves.is-open", { timeout: 5000 });
  await page.waitForFunction(() => [...document.querySelectorAll(".cp-row")].some((r) => /prompt cache/.test(r.textContent) && /restored|read \d+ tokens once|not warm:/.test(r.textContent)), null, { timeout: 300000 });
  const pc = (await page.locator(".cp-row", { hasText: "prompt cache" }).innerText()).replace(/\s+/g, " ");
  check("visit 2: the prompt cache restored", /restored \d+ tokens/.test(pc), pc);
  await ctx.close();

  // ── the GPU kernel's own page ─────────────────────────────────────────────────────────────────────────────────
  ({ ctx, page } = await open("profile-b"));
  await page.goto(`${BASE}/gpu-exact.html`);
  await page.click("#go");
  await page.waitForFunction(() => (document.getElementById("out").textContent.match(/control/g) || []).length === 2 || /Error/i.test(document.getElementById("out").textContent), null, { timeout: 180000 });
  const g = await page.locator("#out").innerText();
  const shapes = [...g.matchAll(/(\d+)\/(\d+) bit-exact/g)];
  check("gpu-exact.html: every shape bit-exact", shapes.length === 3 && shapes.every((m) => m[1] === m[2]), g.split("\n").slice(0, 3).join(" | "));
  check("gpu-exact.html: both controls differ", (g.match(/as expected/g) || []).length === 2);

  // ── no model: a question goes straight to loading it ─────────────────────────────────────────────────────────
  await page.goto(`${BASE}/app.html`, { waitUntil: "networkidle" });
  check("fresh visit: the page just loads, no panel before an interaction", (await page.locator(".uif-shelves.is-open").count()) === 0);
  await page.locator(".cs-faq-q").first().click();
  await wait(1500);
  const side = await page.evaluate(() => {
    const p = document.querySelector(".uif-shelves.is-open")?.getBoundingClientRect(), f = document.querySelector(".ultimate-input-field")?.getBoundingClientRect();
    return { open: !!p, right: p ? Math.round(p.right) : 0, field: f ? Math.round(f.left) : -1, hd: [...document.querySelectorAll(".cp-fold-head")].some((h) => /HARD DRIVE/.test(h.textContent)) };
  });
  check("the first interaction pops the control panel out, HARD DRIVE in it", side.open && side.hd);
  const tools = await page.locator(".cp-fold", { hasText: "TOOLS" }).first().locator("button").allInnerTexts();
  check("ON, OFF and CLEAR in the panel's TOOLS", ["OFF", "CLEAR"].every((b) => tools.includes(b)) && tools.some((b) => /^ON(…)?$/.test(b)), tools.join(" · "));
  check("the field drops beside the panel, not under it", side.field >= side.right, `panel ends at ${side.right}px, field starts at ${side.field}px`);
  await page.waitForFunction(() => /Loading the model in your browser/.test(document.querySelector(".uif-output")?.textContent || ""), null, { timeout: 60000 });
  await wait(4000);
  check("the response window does not ask: no Import button", (await page.locator(".uif-output .cs-import").count()) === 0);
  check("no model: asking starts loading it", /MB of \d+ MB/.test(await page.locator(".uif-output").first().innerText()));
  await ctx.close();
} catch (e) {
  try { await ctxNow?.pages()[0]?.screenshot({ path: process.env.SHOT || join(tmpdir(), "browseml-browser-fail.png") }); } catch {}
  check("the browser checks ran to the end", false, String(e.message || e).split("\n")[0]);
} finally {
  try { process.kill(-server.pid); } catch {}
  rmSync(tmp, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} browser check(s) failed` : "\nevery browser check passed");
process.exit(failed ? 1 : 0);
