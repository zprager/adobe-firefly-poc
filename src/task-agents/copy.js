import OpenAI from "openai";

const openai = new OpenAI();

const SYSTEM = `You are a senior social copywriter. You write punchy, scroll-stopping
campaign copy that respects the requested tone and audience. You return ONLY valid
JSON matching the requested schema. No markdown, no commentary, no trailing text.`;

/**
 * Generates overlay copy (title/subtitle), post copy (caption + hashtags),
 * and alt text for ONE product within a campaign brief. Sibling products are
 * passed only as portfolio context — the returned copy must focus on `product`.
 *
 * @param {object} brief    Validated campaign brief.
 * @param {object} product  { name, description? } — the product to write copy for.
 */
export async function generateCopy(brief, product) {
  const siblingNames = brief.products
    .filter((p) => p.name !== product.name)
    .map((p) => p.name);
  const portfolioLine = siblingNames.length
    ? `\n- Other products in the campaign portfolio (context only — do NOT mention): ${siblingNames.join(", ")}`
    : "";

  const { follow = [], avoid = [] } = brief.brand.guidelines ?? {};
  const guidelinesBlock =
    follow.length || avoid.length
      ? `

Brand guidelines (HARD constraints — every line of copy must respect these):
${follow.length ? `- Follow: ${follow.join(", ")}` : ""}
${avoid.length ? `- Avoid: ${avoid.join(", ")}` : ""}`.replace(/\n\n/g, "\n").trimEnd()
      : "";

  const userPrompt = `Brief:
- Company: ${brief.company ?? "(not specified)"}
- Product (focus this asset on this product only): ${product.name}${product.description ? ` — ${product.description}` : ""}${portfolioLine}
- Region / market: ${brief.region}
- Audience: ${brief.audience}
- Tone: ${brief.tone}
- Campaign message: ${brief.key_message}
- Topic: ${brief.topic ?? "(infer from campaign message)"}
- CTA: ${brief.cta ?? "(infer a short CTA)"}${guidelinesBlock}

Return a JSON object with this exact shape:
{
  "overlay": {
    "title": "string, <= 6 words, bold and punchy, no trailing punctuation unless a question",
    "subtitle": "string, <= 14 words, supports the title"
  },
  "post": {
    "caption": "string, 2-4 short paragraphs separated by \\n\\n. Hook, value, soft CTA. No hashtags inline.",
    "hashtags": ["array of 5-8 relevant hashtags, lowercase, no # prefix, no spaces"]
  },
  "alt_text": "string, one sentence describing the image for accessibility"
}`;

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.85,
  });

  const json = JSON.parse(res.choices[0].message.content);

  // Light validation / shape guarantees so the renderer never blows up.
  json.overlay ??= { title: "", subtitle: "" };
  json.overlay.title ??= "";
  json.overlay.subtitle ??= "";
  json.post ??= { caption: "", hashtags: [] };
  json.post.caption ??= "";
  json.post.hashtags = Array.isArray(json.post.hashtags) ? json.post.hashtags : [];
  json.alt_text ??= "";
  return json;
}
