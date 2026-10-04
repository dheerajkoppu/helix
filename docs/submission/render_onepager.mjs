// Renders onepager.html to Helix_OnePager.pdf with the Playwright install in web/node_modules.
// Run: node docs/submission/render_onepager.mjs
import { chromium } from "/Users/dheeraj/Downloads/alphafold/web/node_modules/playwright/index.mjs";

const dir = "/Users/dheeraj/Downloads/alphafold/docs/submission";

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`file://${dir}/onepager.html`, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);

const heights = await page.evaluate(() => ({
  body: document.body.scrollHeight,
  font: getComputedStyle(document.body).fontFamily,
  bold: document.fonts.check("700 10pt 'IBM Plex Sans'"),
}));
console.log("page metrics:", heights);

await page.pdf({
  path: `${dir}/Helix_OnePager.pdf`,
  format: "Letter",
  printBackground: true,
  preferCSSPageSize: true,
});

await browser.close();
console.log("wrote Helix_OnePager.pdf");
