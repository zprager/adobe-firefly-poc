import fs from "node:fs/promises";

export const RATIOS = {
  "1:1":  { w: 1080, h: 1080 },
  "16:9": { w: 1920, h: 1080 },
  "9:16": { w: 1080, h: 1920 },
};

/**
 * Build an HTML document that composes the hero, scrim, logo, overlay copy, and CTA.
 * Uses absolute file:// URLs so Puppeteer can load local assets.
 */
export function buildHtml({ heroAbsPath, logoAbsPath, overlay, brand, ratio, cta }) {
  const dim = RATIOS[ratio];
  if (!dim) throw new Error(`Unsupported ratio: ${ratio}`);
  const { w, h } = dim;

  const heroUrl = `file://${heroAbsPath}`;
  const logoUrl = logoAbsPath ? `file://${logoAbsPath}` : null;

  // Type scale tuned per surface so headlines read at thumbnail size.
  const titleSize    = ratio === "9:16" ? 96 : ratio === "16:9" ? 100 : 88;
  const subtitleSize = ratio === "9:16" ? 40 : 38;
  const ctaSize      = ratio === "9:16" ? 30 : 30;
  const padding      = ratio === "9:16" ? 80 : 96;
  const logoH        = ratio === "9:16" ? 140 : 120;
  const copyMaxW     = Math.round(w * (ratio === "16:9" ? 0.62 : 0.78));

  const safeTitle    = escapeHtml(overlay.title ?? "");
  const safeSubtitle = escapeHtml(overlay.subtitle ?? "");
  const safeCta      = escapeHtml(cta ?? "");
  const safeLabel    = escapeHtml(brand.label ?? "");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;800&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${w}px; height: ${h}px; }
  body {
    font-family: ${brand.font_body};
    color: ${brand.text_on_primary};
    background: ${brand.primary};
    position: relative;
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
  }
  .hero {
    position: absolute; inset: 0;
    background-image: url('${heroUrl}');
    background-size: cover;
    background-position: center;
  }
  .scrim {
    position: absolute; inset: 0;
    background: linear-gradient(180deg,
      rgba(0,0,0,0.55) 0%,
      rgba(0,0,0,0.15) 40%,
      rgba(0,0,0,0.65) 100%);
  }
  .frame {
    position: absolute; inset: 0;
    padding: ${padding}px;
    display: flex; flex-direction: column; justify-content: space-between;
  }
  .top {
    display: flex; justify-content: space-between; align-items: flex-start;
    gap: 24px;
  }
  .logo {
    height: ${logoH}px; width: auto;
    filter: drop-shadow(0 2px 8px rgba(0,0,0,0.35));
  }
  .pill {
    background: ${brand.accent};
    color: ${brand.primary};
    padding: 10px 18px;
    border-radius: 999px;
    font-family: ${brand.font_heading};
    font-weight: 800;
    font-size: 22px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .copy { max-width: ${copyMaxW}px; }
  .title {
    font-family: ${brand.font_heading};
    font-weight: 800;
    font-size: ${titleSize}px;
    line-height: 1.02;
    letter-spacing: -0.02em;
    text-shadow: 0 4px 24px rgba(0,0,0,0.45);
  }
  .subtitle {
    margin-top: 22px;
    font-family: ${brand.font_body};
    font-size: ${subtitleSize}px;
    line-height: 1.3;
    font-weight: 400;
    opacity: 0.95;
    text-shadow: 0 2px 12px rgba(0,0,0,0.45);
  }
  .cta {
    margin-top: 32px;
    display: inline-block;
    background: ${brand.accent};
    color: ${brand.primary};
    padding: 18px 28px;
    border-radius: 14px;
    font-family: ${brand.font_heading};
    font-weight: 800;
    font-size: ${ctaSize}px;
    letter-spacing: 0.01em;
  }
</style>
</head>
<body>
  <div class="hero"></div>
  <div class="scrim"></div>
  <div class="frame">
    <div class="top">
      ${logoUrl ? `<img class="logo" src="${logoUrl}" alt="" />` : `<div></div>`}
      ${safeLabel ? `<div class="pill">${safeLabel}</div>` : `<div></div>`}
    </div>
    <div class="copy">
      ${safeTitle ? `<div class="title">${safeTitle}</div>` : ""}
      ${safeSubtitle ? `<div class="subtitle">${safeSubtitle}</div>` : ""}
      ${safeCta ? `<div class="cta">${safeCta}</div>` : ""}
    </div>
  </div>
</body>
</html>`;
}

export async function writeHtml(htmlString, outPath) {
  await fs.writeFile(outPath, htmlString, "utf8");
  return outPath;
}

function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
