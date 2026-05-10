import puppeteer from "puppeteer";
import { RATIOS } from "./html.js";

/**
 * Render a saved HTML file to a PNG at the size implied by ratio.
 * The HTML must already be written to disk so file:// references resolve.
 */
export async function htmlToImage({ htmlPath, ratio, outPath }) {
  const dim = RATIOS[ratio];
  if (!dim) throw new Error(`Unsupported ratio: ${ratio}`);
  const { w, h } = dim;

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--allow-file-access-from-files",
      "--font-render-hinting=none",
    ],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle0" });
    // Make sure web fonts are settled before screenshotting.
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await page.screenshot({ path: outPath, type: "png", omitBackground: false });
    return outPath;
  } finally {
    await browser.close();
  }
}
