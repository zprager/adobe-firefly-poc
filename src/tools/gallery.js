import fs from "node:fs/promises";
import path from "node:path";

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Escape `text`, wrapping any verbatim occurrence of a string in `quotes`
// with <mark class="violation">. Longest-first so e.g. "world-class scheduling"
// wins over "world-class". Quotes that don't appear in `text` are skipped
// silently — the reviewer occasionally paraphrases.
function highlightAndEscape(text, quotes) {
  const raw = String(text ?? "");
  const list = (quotes ?? []).map((q) => String(q ?? "")).filter(Boolean);
  if (!raw) return "";
  if (!list.length) return escapeHtml(raw);
  const sorted = list.slice().sort((a, b) => b.length - a.length);
  let out = "";
  let i = 0;
  while (i < raw.length) {
    let matchStart = -1;
    let matchLen = 0;
    for (const q of sorted) {
      const idx = raw.indexOf(q, i);
      if (idx !== -1 && (matchStart === -1 || idx < matchStart)) {
        matchStart = idx;
        matchLen = q.length;
      }
    }
    if (matchStart === -1) {
      out += escapeHtml(raw.slice(i));
      break;
    }
    out += escapeHtml(raw.slice(i, matchStart));
    out += `<mark class="violation">${escapeHtml(raw.slice(matchStart, matchStart + matchLen))}</mark>`;
    i = matchStart + matchLen;
  }
  return out;
}

function highlightCaption(text, quotes) {
  return highlightAndEscape(text, quotes).replace(/\n/g, "<br/>");
}

function scoreClass(score) {
  if (!Number.isFinite(score)) return "score-mid";
  if (score >= 80) return "score-high";
  if (score >= 60) return "score-mid";
  return "score-low";
}

function scoreBadge(score) {
  if (!Number.isFinite(score)) return "";
  return `<span class="score ${scoreClass(score)}">${score}/100</span>`;
}

/**
 * Write a static gallery page (gallery.html) at the run directory root,
 * showing each product's overlay/post copy alongside thumbnails of the
 * rendered post images, plus the brand-review verdict (overall score,
 * per-product contradictions in red, suggested rewrites, and brief
 * tightening ideas). Image paths are relative to runDir so the file
 * is portable.
 *
 * @param {object} manifest  Manifest returned from runCampaign.
 * @returns {Promise<string>} Absolute path to the written gallery.html.
 */
export async function writeGallery(manifest) {
  const { runDir, brief, products, review } = manifest;
  const rel = (abs) => path.relative(runDir, abs);

  const reviewByProduct = new Map();
  if (review && !review.skipped) {
    for (const r of review.products ?? []) {
      reviewByProduct.set(r.product, r);
    }
  }

  const productSections = products.map((p) => {
    const pr = reviewByProduct.get(p.name);
    const contradictions = pr?.contradictions ?? [];
    const suggestions = pr?.suggestions ?? [];

    // Group quotes by the field they live in so we only highlight inside the
    // matching surface (a "world-class" in caption shouldn't bleed into alt).
    const quotesByField = {};
    for (const c of contradictions) {
      const f = c.field ?? "";
      (quotesByField[f] ??= []).push(c.quote);
    }
    const quotesFor = (field) => quotesByField[field] ?? [];

    const hashtagViolations = new Set(
      quotesFor("post.hashtags").flatMap((q) => {
        const stripped = String(q ?? "").replace(/^#/, "").trim();
        return stripped ? [stripped] : [];
      }),
    );
    const hashtags = (p.copy?.post?.hashtags ?? [])
      .map((h) => {
        const isViolation = hashtagViolations.has(h);
        const cls = isViolation ? "tag violation" : "tag";
        return `<span class="${cls}">#${escapeHtml(h)}</span>`;
      })
      .join(" ");

    const posts = p.posts
      .slice()
      .sort((a, b) => a.ratio.localeCompare(b.ratio))
      .map((post) => {
        const src = rel(post.image);
        return `
        <figure class="post">
          <a href="${escapeHtml(src)}" target="_blank" rel="noopener">
            <img src="${escapeHtml(src)}" alt="${escapeHtml(p.copy?.alt_text ?? p.name)}" loading="lazy" />
          </a>
          <figcaption>${escapeHtml(post.ratio)}</figcaption>
        </figure>`;
      })
      .join("\n");

    const reviewBlock = pr
      ? `
      <div class="review">
        <div class="review-head">
          <h4>Brand review</h4>
          ${scoreBadge(pr.score)}
        </div>
        ${
          contradictions.length
            ? `<ul class="violations">
                ${contradictions
                  .map(
                    (c) => `
                  <li class="contradiction">
                    <div class="field">${escapeHtml(c.field ?? "")}</div>
                    <div class="quote">&ldquo;${escapeHtml(c.quote ?? "")}&rdquo;</div>
                    <div class="violates">violates: ${escapeHtml(c.violates ?? "")}</div>
                    ${c.explanation ? `<div class="explanation">${escapeHtml(c.explanation)}</div>` : ""}
                  </li>`,
                  )
                  .join("")}
              </ul>`
            : `<p class="muted">No contradictions flagged.</p>`
        }
        ${
          suggestions.length
            ? `<h5>Suggested rewrites</h5>
              <ul class="suggestions">
                ${suggestions
                  .map(
                    (s) => `
                  <li class="suggestion">
                    <div class="field">${escapeHtml(s.field ?? "")}</div>
                    <div class="current"><span class="lbl">current</span> ${escapeHtml(s.current ?? "")}</div>
                    <div class="suggested"><span class="lbl">suggested</span> ${escapeHtml(s.suggested ?? "")}</div>
                    ${s.rationale ? `<div class="rationale">${escapeHtml(s.rationale)}</div>` : ""}
                  </li>`,
                  )
                  .join("")}
              </ul>`
            : ""
        }
      </div>`
      : "";

    return `
    <section class="product">
      <header>
        <h2>${escapeHtml(p.name)}${pr ? " " + scoreBadge(pr.score) : ""}</h2>
      </header>
      <div class="grid">
        <div class="copy">
          <h3 class="overlay-title">${highlightAndEscape(p.copy?.overlay?.title ?? "", quotesFor("overlay.title"))}</h3>
          <p class="overlay-subtitle">${highlightAndEscape(p.copy?.overlay?.subtitle ?? "", quotesFor("overlay.subtitle"))}</p>
          <hr/>
          <p class="caption">${highlightCaption(p.copy?.post?.caption ?? "", quotesFor("post.caption"))}</p>
          <p class="hashtags">${hashtags}</p>
          ${p.copy?.alt_text ? `<p class="alt"><em>Alt:</em> ${highlightAndEscape(p.copy.alt_text, quotesFor("alt_text"))}</p>` : ""}
          ${reviewBlock}
        </div>
        <div class="posts">
          ${posts}
        </div>
      </div>
    </section>`;
  }).join("\n");

  let reviewSummary = "";
  if (review?.skipped) {
    reviewSummary = `
    <section class="review-summary skipped">
      <h2>Brand review <span class="muted">— skipped</span></h2>
      <p>${escapeHtml(review.reason ?? "")}</p>
    </section>`;
  } else if (review) {
    const briefList = (review.brief_suggestions ?? [])
      .map((s) => `<li>${escapeHtml(s)}</li>`)
      .join("");
    reviewSummary = `
    <section class="review-summary">
      <div class="review-head">
        <h2>Brand review</h2>
        ${scoreBadge(review.overall_score)}
      </div>
      ${review.summary ? `<p>${escapeHtml(review.summary)}</p>` : ""}
      ${
        briefList
          ? `<details class="brief-suggestions">
              <summary>Brief tightening ideas (${review.brief_suggestions.length})</summary>
              <ul>${briefList}</ul>
            </details>`
          : ""
      }
    </section>`;
  }

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(brief.campaign)} — ${escapeHtml(brief.company)}</title>
<style>
  :root {
    --bg: #0b0d12;
    --surface: #151823;
    --border: #232838;
    --text: #e7eaf2;
    --muted: #9aa3b8;
    --accent: ${escapeHtml(brief.brand?.accent ?? "#F59E0B")};
    --danger: #ef4444;
    --danger-soft: rgba(239, 68, 68, 0.12);
    --danger-text: #fca5a5;
    --warn-soft: rgba(245, 158, 11, 0.08);
    --good: #34d399;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); }
  body { font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif; }
  .wrap { max-width: 1200px; margin: 0 auto; padding: 48px 24px 96px; }
  .hero h1 { font-size: 32px; margin: 0 0 4px; letter-spacing: -0.01em; }
  .hero p { color: var(--muted); margin: 0 0 32px; }
  .review-summary { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 20px 24px; margin-bottom: 28px; }
  .review-summary h2 { font-size: 18px; margin: 0; }
  .review-summary p { margin: 8px 0 0; color: var(--muted); }
  .review-summary.skipped { opacity: 0.85; }
  .review-head { display: flex; align-items: center; gap: 12px; }
  .brief-suggestions { margin-top: 14px; }
  .brief-suggestions summary { cursor: pointer; color: var(--muted); font-size: 14px; }
  .brief-suggestions ul { margin: 8px 0 0 18px; color: var(--text); font-size: 14px; }
  .brief-suggestions li { margin-bottom: 4px; }
  .product { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 24px; margin-bottom: 28px; }
  .product header h2 { font-size: 22px; margin: 0 0 16px; display: flex; align-items: center; gap: 10px; }
  .grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); gap: 24px; }
  @media (max-width: 820px) { .grid { grid-template-columns: 1fr; } }
  .copy h3 { font-size: 18px; margin: 0 0 6px; }
  .copy .overlay-subtitle { color: var(--muted); margin: 0 0 14px; }
  .copy hr { border: none; border-top: 1px solid var(--border); margin: 14px 0; }
  .copy .caption { white-space: normal; }
  .hashtags { margin-top: 12px; }
  .tag { display: inline-block; color: var(--accent); margin-right: 6px; font-size: 14px; }
  .tag.violation { color: var(--danger-text); background: var(--danger-soft); border-bottom: 2px solid var(--danger); padding: 0 4px; border-radius: 3px; }
  .alt { color: var(--muted); font-size: 13px; margin-top: 14px; }
  mark.violation { background: var(--danger-soft); color: #fecaca; padding: 0 2px; border-radius: 3px; border-bottom: 2px solid var(--danger); }
  .review { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--border); }
  .review h4 { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; margin: 0; }
  .review h5 { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; margin: 14px 0 6px; }
  .review ul { list-style: none; padding: 0; margin: 8px 0 0; }
  .review .muted { color: var(--muted); font-size: 13px; margin: 8px 0 0; }
  .contradiction { background: var(--danger-soft); border-left: 3px solid var(--danger); padding: 8px 12px; border-radius: 6px; margin-bottom: 8px; font-size: 14px; }
  .contradiction .field { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 2px; }
  .contradiction .quote { color: var(--danger-text); font-weight: 500; }
  .contradiction .violates { color: var(--danger-text); font-size: 13px; margin-top: 4px; }
  .contradiction .explanation { color: var(--muted); font-size: 13px; margin-top: 2px; }
  .suggestion { background: var(--warn-soft); border-left: 3px solid var(--accent); padding: 8px 12px; border-radius: 6px; margin-bottom: 8px; font-size: 14px; }
  .suggestion .field { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 2px; }
  .suggestion .lbl { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; margin-right: 6px; }
  .suggestion .current { color: var(--muted); }
  .suggestion .suggested { color: var(--text); margin-top: 2px; }
  .suggestion .rationale { color: var(--muted); font-size: 13px; margin-top: 4px; }
  .score { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; line-height: 1.6; }
  .score-high { background: rgba(52, 211, 153, 0.15); color: var(--good); }
  .score-mid  { background: rgba(245, 158, 11, 0.15); color: #fcd34d; }
  .score-low  { background: var(--danger-soft); color: var(--danger-text); }
  .posts { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; align-content: start; }
  .post { margin: 0; background: var(--bg); border-radius: 10px; overflow: hidden; border: 1px solid var(--border); }
  .post a { display: block; }
  .post img { display: block; width: 100%; height: auto; }
  .post figcaption { padding: 6px 8px; font-size: 12px; color: var(--muted); background: var(--surface); border-top: 1px solid var(--border); }
  footer { color: var(--muted); font-size: 12px; margin-top: 32px; text-align: center; }
</style>
</head>
<body>
  <main class="wrap">
    <div class="hero">
      <h1>${escapeHtml(brief.campaign)} — ${escapeHtml(brief.company)}</h1>
      <p>${escapeHtml(brief.region ?? "")}${brief.region ? " · " : ""}${products.length} product${products.length === 1 ? "" : "s"} · generated ${escapeHtml(manifest.generatedAt)}</p>
    </div>
    ${reviewSummary}
    ${productSections}
    <footer>campaign-gen · click any image to open the full-size PNG</footer>
  </main>
</body>
</html>
`;

  const outPath = path.join(runDir, "gallery.html");
  await fs.writeFile(outPath, html, "utf8");
  return outPath;
}
