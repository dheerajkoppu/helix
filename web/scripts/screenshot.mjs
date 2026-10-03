// Usage: node scripts/screenshot.mjs <url> <output.png> [--dark] [--mobile] [--full] [--wait=ms] [--click=selector]
import { chromium } from "playwright";

const [url, output, ...flags] = process.argv.slice(2);
if (!url || !output) {
  console.error("usage: node scripts/screenshot.mjs <url> <output.png> [--dark] [--mobile] [--full] [--wait=ms] [--click=selector]");
  process.exit(1);
}
const flagValue = (name) => flags.find((flag) => flag.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const isMobile = flags.includes("--mobile");

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const context = await browser.newContext({
  viewport: isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  deviceScaleFactor: isMobile ? 2 : 1,
  colorScheme: flags.includes("--dark") ? "dark" : "light",
});
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => message.type() === "error" && consoleErrors.push(message.text()));
page.on("pageerror", (error) => consoleErrors.push(String(error)));

await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch((error) => consoleErrors.push(`navigation: ${error.message}`));
const clickSelector = flagValue("click");
if (clickSelector) await page.click(clickSelector, { timeout: 10000 }).catch((error) => consoleErrors.push(`click: ${error.message}`));
await page.waitForTimeout(Number(flagValue("wait") ?? 1500));
await page.screenshot({ path: output, fullPage: flags.includes("--full") });
await browser.close();

if (consoleErrors.length) console.log(`console errors:\n${consoleErrors.slice(0, 15).join("\n")}`);
console.log(`saved ${output}`);
