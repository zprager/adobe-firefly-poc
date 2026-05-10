import fs from "node:fs/promises";
import OpenAI from "openai";
import { log, sleep } from "../util.js";

const openai = new OpenAI();

// gpt-image-1 occasionally returns 404-no-body when rate-limited (instead of 429).
// Retry on transient/rate-limit responses with exponential backoff.
async function generateWithRetry(params, { maxAttempts = 3, baseDelayMs = 8000 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await openai.images.generate(params);
    } catch (err) {
      lastErr = err;
      const status = err?.status ?? err?.response?.status;
      const retriable = status === 404 || status === 429 || (status >= 500 && status < 600);
      if (!retriable || attempt === maxAttempts) break;
      const delayMs = baseDelayMs * attempt;
      log.warn(`gpt-image-1 attempt ${attempt}/${maxAttempts} failed (status ${status ?? "?"}); retrying in ${delayMs / 1000}s...`);
      await sleep(delayMs);
    }
  }
  const status = lastErr?.status ?? lastErr?.response?.status ?? "?";
  const headers = lastErr?.headers ?? {};
  const rl = Object.fromEntries(
    Object.entries(headers).filter(([k]) => k.toLowerCase().includes("ratelimit")),
  );
  const ctx = Object.keys(rl).length ? ` ratelimit=${JSON.stringify(rl)}` : "";
  throw new Error(
    `gpt-image-1 failed after ${maxAttempts} attempts (status ${status})${ctx}: ${lastErr?.message || lastErr}`,
  );
}

// gpt-image-1 supports: 1024x1024, 1024x1536 (portrait), 1536x1024 (landscape).
// We pick the closest match for the target ratio; final canvas is composed in HTML.
const SIZE_FOR_RATIO = {
  "1:1":  "1024x1024",
  "16:9": "1536x1024",
  "9:16": "1024x1536",
};

/**
 * Provide the hero image for a (product, ratio) pair. If userHeroPath is set,
 * copy the user's file to outPath and skip the API call. Otherwise, generate
 * via gpt-image-1.
 *
 * @param {object} args
 * @param {object} args.brief    Loaded brief.
 * @param {object} args.product  { name, description? } — featured product.
 * @param {"1:1"|"16:9"|"9:16"} args.ratio
 * @param {string} args.outPath  Where to write the PNG.
 * @param {string} [args.userHeroPath]  Absolute path to a user-supplied hero image.
 */
export async function generateHero({ brief, product, ratio, outPath, userHeroPath }) {
  if (userHeroPath) {
    await fs.copyFile(userHeroPath, outPath);
    return { path: outPath, source: "user", userHeroPath };
  }

  const size = SIZE_FOR_RATIO[ratio] ?? "1024x1024";

  const productLine = product.description
    ? `Product featured: ${product.name} — ${product.description}.`
    : `Product featured: ${product.name}.`;

  const features = Array.isArray(product.features) ? product.features.filter(Boolean) : [];
  const featuresLine = features.length
    ? `Visually emphasize these product-specific features so this hero is unmistakably about ${product.name} and not another product in the same family: ${features.join("; ")}. Translate these features into concrete on-set objects, props, surfaces, lighting choices, or scene details — not literal UI screenshots.`
    : "";

  const prompt = [
    `Hero image for a social media campaign with campaign message: ${brief.key_message}.`,
    brief.topic ? `Topic: ${brief.topic}.` : "",
    productLine,
    featuresLine,
    `Region / market: ${brief.region}.`,
    `Audience: ${brief.audience}.`,
    `Visual style: ${brief.hero.style}.`,
    `Composition: leave generous negative space (top-left or center-left) for a headline overlay added in post-processing. Do NOT render any text, words, letters, captions, or watermarks inside the image.`,
    `Avoid: ${brief.hero.negative}.`,
  ]
    .filter(Boolean)
    .join(" ");

  const res = await generateWithRetry({
    model: "gpt-image-1",
    prompt,
    size,
    n: 1,
  });

  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error("gpt-image-1 returned no image data");
  const buf = Buffer.from(b64, "base64");
  await fs.writeFile(outPath, buf);

  return { path: outPath, size, prompt };
}
