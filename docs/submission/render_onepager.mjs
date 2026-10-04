// Renders onepager.html to Helix_OnePager.pdf with the Playwright install in web/node_modules.
// Run: node docs/submission/render_onepager.mjs
import { chromium } from "/Users/dheeraj/Downloads/alphafold/web/node_modules/playwright/index.mjs";

const dir = "/Users/dheeraj/Downloads/alphafold/docs/submission";

// The printable box Letter leaves at the @page margins set in onepager.html. The viewport has to
// match it, or the text reflows at a different width and the height measured below means nothing.
const printableWidthPx = Math.round((8.5 - 0.62 - 0.62) * 96);
const printableHeightPx = Math.round((11 - 0.58 - 0.44) * 96);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: printableWidthPx, height: printableHeightPx },
});
await page.goto(`file://${dir}/onepager.html`, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.emulateMedia({ media: "print" });

const metrics = await page.evaluate(() => ({
  body: document.body.scrollHeight,
  font: getComputedStyle(document.body).fontFamily,
  bold: document.fonts.check("700 10pt 'IBM Plex Sans'"),
}));
console.log("page metrics:", metrics);
console.log(
  `fits one page: ${metrics.body <= printableHeightPx} (${metrics.body} of ${printableHeightPx}px)`,
);
if (metrics.body > printableHeightPx) {
  console.error("REFUSING: the content is taller than one page. Cut copy and re-render.");
  await browser.close();
  process.exit(1);
}

await page.pdf({
  path: `${dir}/Helix_OnePager.pdf`,
  format: "Letter",
  printBackground: true,
  preferCSSPageSize: true,
});

await browser.close();
console.log("wrote Helix_OnePager.pdf");
