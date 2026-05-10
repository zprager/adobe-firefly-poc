import OpenAI from "openai";

const openai = new OpenAI();

const SYSTEM = `You are a senior brand editor. You review draft social copy against
explicit brand guidelines. You surface direct contradictions, soft misalignments,
and concrete improvements. You are blunt, specific, and actionable — no flattery,
no padding. When you flag something, you quote the exact offending phrase.

You return ONLY valid JSON matching the requested schema. No markdown, no
commentary, no trailing text.`;

/**
 * Score generated copy against brand guidelines and surface contradictions
 * + suggestions. Runs as a single batched call covering every product.
 *
 * Returns { skipped: true, reason } when no guidelines are defined.
 *
 * @param {object} args
 * @param {object} args.brief          Validated campaign brief.
 * @param {Array}  args.productCopies  [{ product, productSlug, copy }, ...]
 */
export async function reviewCopy({ brief, productCopies }) {
  const { follow = [], avoid = [] } = brief.brand.guidelines ?? {};

  if (!follow.length && !avoid.length) {
    return {
      skipped: true,
      reason: "No brand guidelines defined; nothing to score against.",
    };
  }

  const productBlocks = productCopies
    .map(
      ({ product, copy }) => `### ${product.name}
overlay.title:    ${JSON.stringify(copy.overlay?.title ?? "")}
overlay.subtitle: ${JSON.stringify(copy.overlay?.subtitle ?? "")}
post.caption:     ${JSON.stringify(copy.post?.caption ?? "")}
post.hashtags:    ${JSON.stringify(copy.post?.hashtags ?? [])}
alt_text:         ${JSON.stringify(copy.alt_text ?? "")}`,
    )
    .join("\n\n");

  const userPrompt = `Campaign: ${brief.campaign}
Company: ${brief.company ?? "(not specified)"}
Tone: ${brief.tone}
Audience: ${brief.audience}
Key message: ${brief.key_message}

Brand guidelines:
- Follow: ${follow.length ? follow.join(", ") : "(none specified)"}
- Avoid:  ${avoid.length ? avoid.join(", ") : "(none specified)"}

Drafts to review:

${productBlocks}

Score every product and the campaign as a whole against the brand guidelines.
Be specific: when you flag a contradiction, quote the EXACT offending phrase
from the copy and name the guideline it violates. When you suggest an
improvement, include the rewritten line. When you suggest brief-level
additions, name the field and value (e.g. "Add to brand.guidelines.follow:
'use second-person voice'").

Return a JSON object with this exact shape:
{
  "overall_score": "integer 0-100. 100 = perfect alignment; 70-89 = solid with minor nits; 50-69 = several soft violations; below 50 = direct contradictions present",
  "summary": "string, 1-3 sentences — the headline of how the campaign performs vs the guidelines",
  "products": [
    {
      "product": "string — product name exactly as given",
      "score": "integer 0-100, same rubric as overall_score",
      "contradictions": [
        {
          "field": "one of: overlay.title | overlay.subtitle | post.caption | post.hashtags | alt_text",
          "quote": "string — the exact offending phrase quoted verbatim from the draft",
          "violates": "string — the specific guideline (Follow or Avoid item) that this contradicts",
          "explanation": "string — one sentence on why this is a contradiction"
        }
      ],
      "suggestions": [
        {
          "field": "same enum as contradictions.field",
          "current": "string — the current value (or excerpt)",
          "suggested": "string — the rewritten value",
          "rationale": "string — one sentence on what this fixes"
        }
      ]
    }
  ],
  "brief_suggestions": [
    "string — concrete additions to the brief that would tighten future runs. Examples: 'Add to brand.guidelines.follow: use second-person voice (you, your)', 'Add brief.audience detail: include team size range', 'Add brand.guidelines.avoid: vague claims like world-class, best-in-class'"
  ]
}`;

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.2,
  });

  const json = JSON.parse(res.choices[0].message.content);

  json.overall_score = Number.isFinite(json.overall_score) ? json.overall_score : 0;
  json.summary ??= "";
  json.products = Array.isArray(json.products) ? json.products : [];
  json.brief_suggestions = Array.isArray(json.brief_suggestions)
    ? json.brief_suggestions
    : [];
  return json;
}
