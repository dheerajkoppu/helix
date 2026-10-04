import { chromium } from "playwright";
const [url, prefix] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
const page = await context.newPage();
await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
let worst = 0, shot = 0;
const start = Date.now();
while (Date.now() - start < 150000) {
  await page.waitForTimeout(1200);
  const m = await page.evaluate(() => {
    const main = document.querySelector("main");
    const col = document.querySelector('[data-col="step"]');
    const step = document.querySelector("section[data-step]")?.dataset.step;
    const playing = !!document.querySelector('[aria-label="Pause"], button[title="Pause"]');
    const bar = document.querySelector('[aria-label="Replay"], [data-slot="replay-bar"]');
    return { mainOverflow: main.scrollHeight - main.clientHeight, colOverflow: col ? col.scrollHeight - col.clientHeight : null, step, playing, bar: !!bar };
  });
  worst = Math.max(worst, m.colOverflow ?? 0, m.mainOverflow);
  if (shot < 6 && (Date.now() - start) / 1200 > shot * 12) {
    await page.screenshot({ path: `${prefix}-f${shot}.png` });
    console.log("frame", shot, JSON.stringify(m));
    shot++;
  }
  const done = await page.evaluate(() => {
    const el = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Replay");
    return !!el;
  });
  if (done && Date.now() - start > 5000) break;
}
await page.waitForTimeout(1500);
await page.screenshot({ path: `${prefix}-final.png` });
const end = await page.evaluate(() => {
  const main = document.querySelector("main");
  const col = document.querySelector('[data-col="step"]');
  return { step: document.querySelector("section[data-step]")?.dataset.step, mainOverflow: main.scrollHeight - main.clientHeight, colOverflow: col ? col.scrollHeight - col.clientHeight : null };
});
console.log("final", JSON.stringify(end), "worstOverflow", worst, "seconds", Math.round((Date.now()-start)/1000));
await browser.close();
