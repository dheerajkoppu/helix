import { chromium } from "playwright";
const out = process.argv[2];
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
const page = await context.newPage();
await page.route("**/lab/runs**", async (route) => {
  const response = await route.fetch();
  const body = await response.json();
  // the WAS run changed its answer; give it candidates so both signals land on one run
  for (const run of body.items ?? []) {
    if (run.run_id.includes("WAS-p.Thr45Met") && run.outcome.decision_changed) {
      run.metrics.candidates = 4;
      run.outcome.candidate_molecules = ["A", "B", "C", "D"];
    }
  }
  await route.fulfill({ response, json: body });
});
await page.goto("http://localhost:3000/lab", { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await page.screenshot({ path: out });
console.log("saved", out);
await browser.close();
