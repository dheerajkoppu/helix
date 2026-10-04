import { chromium } from "playwright";
const [url, prefix, ...flags] = process.argv.slice(2);
const dark = flags.includes("--dark");
const only = flags.find((f) => f.startsWith("--only="))?.split("=")[1];
const mobile = flags.includes("--mobile");
const steps = ["question","evidence","hypothesis","experiment","result","decision","candidates"];
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: mobile ? {width:390,height:844} : { width: 1440, height: 900 }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: mobile?2:1 });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1600);
const list = only ? only.split(",") : steps;
for (const step of list) {
  const i = steps.indexOf(step);
  await page.locator(`nav[aria-label="Discovery loop"] button`).nth(i).click().catch((e)=>errors.push(String(e)));
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => {
    const main = document.querySelector("main");
    const col = document.querySelector('[data-col="step"]');
    return { mainOverflow: main.scrollHeight - main.clientHeight, colOverflow: col ? col.scrollHeight - col.clientHeight : null };
  });
  await page.screenshot({ path: `${prefix}-${step}.png` });
  console.log(step.padEnd(11), JSON.stringify(m));
}
await browser.close();
if (errors.length) console.log("errors:", errors.slice(0,5).join("\n"));
