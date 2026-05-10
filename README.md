# campaign-gen

CLI that turns a campaign brief into a full pack of social assets: per-product post copy, overlay copy, hero images (generated or supplied), and rendered post PNGs at 1:1, 16:9, and 9:16. A browsable HTML gallery is emitted at the end of every run.

Repo: https://github.com/zprager/adobe-firefly-poc

---

## Part 1 — Install, set up, and run

### Requirements

- Node.js >= 20
- An OpenAI API key with access to `gpt-4o-mini` (copy + review) and `gpt-image-1` (hero generation)
- macOS / Linux (Puppeteer downloads a Chromium build on install; ~170MB)

### Install

```bash
git clone https://github.com/zprager/adobe-firefly-poc.git
cd adobe-firefly-poc/campaign-gen
npm install
```

### Configure

Copy the example env file and add your key:

```bash
cp .env.example .env
# then edit .env:
# OPENAI_API_KEY=sk-...
```

The CLI reads `.env` automatically via `dotenv`. If `OPENAI_API_KEY` is missing, the CLI exits with a clear error before any work starts.

### Run

The `generate` command is the only entrypoint. Point it at a YAML or JSON brief; everything else is optional.

```bash
# Minimal — uses everything from the brief
node src/cli.js generate -b briefs/example.yaml

# npm script equivalent
npm run generate -- -b briefs/example.yaml
```

Output is written to `./output/<campaign-slug>-<timestamp>/` and includes:

- `manifest.json` — the full run record (brief, copy, review, posts, paths)
- `review.json` — brand-guideline scoring + contradictions (when guidelines are defined)
- `gallery.html` — clickable index of every rendered post, hero, and copy block
- `products/<product-slug>/` — per-product `copy.json`, `post.txt`, `post-<ratio>.html`, and `images/hero-*.png` + `images/post-*.png`

The CLI prints the gallery path as a clickable `file://` link when it finishes.

### More example commands

```bash
# Override the products list (skips brief.products entirely)
node src/cli.js generate -b briefs/example.yaml \
  --products "Acme Calendar,Acme Inbox" \
  --region "EMEA"

# Limit which ratios get rendered (16:9 is always added; required downstream)
node src/cli.js generate -b briefs/example.yaml --ratios 1:1,9:16

# Skip gpt-image-1 and supply your own hero (single image used for any ratio
# that doesn't have a more specific asset)
node src/cli.js generate -b briefs/example.yaml --hero ./my-hero.png

# Override brand bits without touching the YAML
node src/cli.js generate -b briefs/example.yaml \
  --primary "#0F172A" --accent "#F59E0B" --label NEW \
  --logo ./assets/company/logo.png

# Override the campaign message + CTA inline
node src/cli.js generate -b briefs/example.yaml \
  --key-message "Stop dragging your week around. Acme drafts it for you." \
  --cta "Try free for 14 days"

# Custom output directory
node src/cli.js generate -b briefs/example.yaml -o ./runs
```

Every flag is optional and only overrides the corresponding brief field; everything not passed falls back to the brief value (or its schema default).

### Bringing your own hero images

To skip `gpt-image-1` for a given (product, ratio), drop a PNG at any of these locations (resolved relative to the brief file):

1. `assets/<product-slug>/hero-1x1.png` / `hero-16x9.png` / `hero-9x16.png` — most specific
2. `assets/company/hero-1x1.png` / `hero-16x9.png` / `hero-9x16.png` — campaign-wide
3. `brief.hero.image` (or `--hero <path>`) — single fallback used for any ratio still missing
4. Otherwise `gpt-image-1` is called

Product slugs are the `name` field run through `slug()` — e.g. `Acme Calendar AI` → `acme-calendar-ai`.

---

## Part 2 — What happens on a run

A single `generate` invocation runs the pipeline in [src/pipeline.js](src/pipeline.js). The phases below describe what executes, in order, for one brief.

### Step 0 — Parse CLI flags and load the brief

[src/cli.js](src/cli.js) parses flags via `commander`, validates `--ratios` against `{1:1, 16:9, 9:16}`, and force-adds `16:9` if it was omitted (it is the canonical landscape format used in the gallery preview).

Flags are folded into an `overrides` object and passed to [`loadBrief`](src/tools/brief.js#L64) along with the brief path. `loadBrief` reads the YAML/JSON, deep-merges overrides on top (after pruning `undefined` / `null` / `""` so empty flags don't clobber brief values), and validates the result against a `zod` schema. The schema enforces:

- `campaign`, `region`, `audience`, `key_message` are required
- `products` must have at least 2 entries (string or `{name, description?}`)
- Brand colors, fonts, and guidelines have sensible defaults so a minimal brief still works

### Step 1 — Resolve hero image sources

Before any API call, the pipeline walks the four-tier hero precedence (per-product, company-wide, brief-level, generated) and stamps a `productHeros[productSlug][ratio]` lookup. Files that don't exist are silently dropped to `null` so the next tier wins. Missing logo files emit a warning but don't abort — the renderer just skips the logo block.

This step is pure filesystem checks; nothing is generated yet. The point is to know up-front for each (product, ratio) pair whether the run will hit `gpt-image-1`, which controls throttling later.

### Step 2 — Generate copy per product (gpt-4o-mini)

For each product, [`generateCopy`](src/task-agents/copy.js) makes one `gpt-4o-mini` call with `response_format: json_object` and returns:

```jsonc
{
  "overlay":  { "title": "...", "subtitle": "..." },
  "post":     { "caption": "...", "hashtags": ["...", "..."] },
  "alt_text": "..."
}
```

The prompt feeds the model:
- The focused product with **full detail** — `name` plus `description` if the brief provides one — and an instruction that this is the only product the asset should mention
- Sibling products as **names only**, framed as portfolio context the model must not mention. Their descriptions are intentionally withheld so each per-product asset stays focused on one product
- Region, audience, tone, key message, CTA
- The brand's `guidelines.follow` and `guidelines.avoid` lists, framed as HARD constraints

Output is written to `products/<slug>/copy.json` plus a flat `post.txt` (caption + hashtags) for easy copy-paste into a scheduler. Light shape-guarantees are applied so a malformed model response can't crash the renderer downstream.

### Step 3 — Review copy against brand guidelines (gpt-4o-mini)

If the brief defines `brand.guidelines.follow` or `brand.guidelines.avoid`, [`reviewCopy`](src/task-agents/review.js) runs a single batched call covering every product. The reviewer is instructed to:

- Score each product and the campaign overall (0–100)
- Quote the **exact** offending phrase when flagging a contradiction
- Name the specific guideline that was violated
- Suggest concrete rewrites and (optionally) tightening additions to the brief

This phase runs synchronously between copy generation and image generation on purpose — the user sees scores and contradictions before the slow image work starts, so they can `Ctrl+C` and edit the brief if the copy is off-brand. Result is written to `review.json` at the run root and embedded in the manifest. The gallery uses the contradiction quotes to highlight offending phrases inline.

If no guidelines are defined the review is skipped with a `{ skipped: true, reason }` record.

### Step 4 — Generate or copy hero per (product, ratio)

The pipeline iterates over the cartesian product of `products × ratios`. For each pair:

- If a user-supplied hero was resolved in Step 1, [`generateHero`](src/task-agents/image.js) just `fs.copyFile`s it into the run folder — no API call.
- Otherwise it calls `gpt-image-1` at the closest supported size for the ratio (`1024x1024`, `1536x1024`, `1024x1536`) with a prompt assembled from `brief.key_message`, `brief.topic`, the focused product, region, audience, the brief's `hero.style`, and `hero.negative`. The prompt explicitly reserves negative space for the headline overlay and forbids the model from rendering text inside the image (text is composed in HTML, not baked into the hero).

Image calls go through `generateWithRetry` — exponential backoff on 404/429/5xx, surfacing rate-limit headers in the final error message. Between *consecutive* `gpt-image-1` calls, the pipeline sleeps `IMAGE_THROTTLE_MS` (2s) so a multi-product, multi-ratio run stays under the per-minute rate limit. The throttle is skipped when either side of the pair uses a user-supplied hero.

### Step 5 — Compose HTML

[`buildHtml`](src/tools/html.js) builds a self-contained HTML document for each (product, ratio):

- Canvas size is locked to the ratio (`1080×1080`, `1920×1080`, `1080×1920`)
- Hero is set as a `background-image` via a `file://` URL
- A vertical scrim improves headline contrast
- Overlay title + subtitle are placed in the safe zone, with a font-size scale tuned per ratio so headlines stay readable at thumbnail size
- Optional logo (top-left) and brand-label pill (top-right) render only when supplied
- CTA pill is placed bottom-left in the brand's accent color
- All user strings are HTML-escaped via `escapeHtml`

The HTML is written to `products/<slug>/post-<ratio-tag>.html` so the renderer can load it from disk (file:// hero references resolve correctly).

### Step 6 — Render HTML to PNG (Puppeteer)

[`htmlToImage`](src/tools/render.js) launches headless Chromium with `--allow-file-access-from-files`, sets the viewport to the canvas size, navigates to the `file://` URL, waits for `networkidle0` and `document.fonts.ready` (so the imported Inter web font is settled), then screenshots to `images/post-<ratio-tag>.png`.

Browser is closed in a `finally` so a render error doesn't leak Chromium processes.

### Step 7 — Write manifest and gallery

After all jobs complete, [src/pipeline.js](src/pipeline.js) writes `manifest.json` containing the brief, the resolved ratios, the review, and a per-product list of `{ ratio, hero, html, image }` paths.

Back in the CLI, [`writeGallery`](src/tools/gallery.js) consumes the manifest and emits `gallery.html`: a single browsable page with each product's overlay copy, post caption, hashtags, hero, and rendered post images side-by-side per ratio. Reviewer contradiction quotes are highlighted inline with `<mark class="violation">` so brand mismatches jump out visually.

The CLI prints the gallery path as an OSC-8 hyperlink for terminals that support clickable links, with a plain `file://` fallback on the next line.

---

## Project layout

```
campaign-gen/
├── briefs/
│   ├── example.yaml          # sample brief
│   └── assets/               # optional pre-supplied heroes + logo
│       ├── company/          # campaign-wide assets (logo.png, hero-*.png)
│       └── <product-slug>/   # per-product hero overrides
├── output/                   # one folder per run; safe to delete
└── src/
    ├── cli.js                # commander entrypoint
    ├── pipeline.js           # orchestrates copy -> review -> hero -> html -> render
    ├── util.js               # log, slug, ts, ensureDir, sleep
    ├── task-agents/          # one file per LLM-driven step
    │   ├── copy.js           # gpt-4o-mini: per-product copy
    │   ├── image.js          # gpt-image-1: hero generation (with retry)
    │   └── review.js         # gpt-4o-mini: brand-guideline review
    └── tools/                # deterministic, non-LLM helpers
        ├── brief.js          # YAML/JSON load + zod validation + override merge
        ├── html.js           # compose post HTML
        ├── render.js         # puppeteer: HTML -> PNG
        └── gallery.js        # build gallery.html for the whole run
```
