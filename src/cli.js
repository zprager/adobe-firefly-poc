#!/usr/bin/env node
// campaign-gen
// CLI: generate a full social campaign asset pack from a brief file.
//
// Usage:
//   campaign-gen generate -b briefs/example.yaml
//   campaign-gen generate -b briefs/example.yaml --products "Acme Calendar,Acme Inbox" --region "EMEA"
//   campaign-gen generate -b briefs/example.yaml --ratios 1:1,9:16

import "dotenv/config";
import path from "node:path";
import { Command } from "commander";
import { loadBrief } from "./tools/brief.js";
import { runCampaign } from "./pipeline.js";
import { writeGallery } from "./tools/gallery.js";
import { log, ensureDir } from "./util.js";

const VALID_RATIOS = new Set(["1:1", "16:9", "9:16"]);

const program = new Command();
program
  .name("campaign-gen")
  .description(
    "Generate social campaign assets: hero image, post copy, overlay copy, rendered post images.",
  )
  .version("0.1.0");

program
  .command("generate")
  .alias("g")
  .description("Run a campaign from a brief file with optional flag overrides.")
  .requiredOption("-b, --brief <path>", "Path to YAML or JSON brief")
  .option("--campaign <name>",  "Override brief.campaign")
  .option("--company <name>",   "Override brief.company")
  .option("--products <list>",  "Override brief.products (comma-separated names)")
  .option("--region <text>",    "Override brief.region")
  .option("--topic <text>",     "Override brief.topic")
  .option("--audience <text>",  "Override brief.audience")
  .option("--tone <text>",      "Override brief.tone")
  .option("--key-message <t>",  "Override brief.key_message")
  .option("--cta <text>",       "Override brief.cta")
  .option("--logo <path>",      "Override brand.logo_path")
  .option("--hero <path>",      "Override hero.image (skip gpt-image-1, use this image)")
  .option("--label <text>",     "Override brand.label (top-right pill)")
  .option("--primary <hex>",    "Override brand.primary color")
  .option("--accent <hex>",     "Override brand.accent color")
  .option(
    "--ratios <list>",
    "Comma-separated ratios from 1:1,16:9,9:16",
    "1:1,16:9,9:16",
  )
  .option("-o, --out <dir>", "Output directory", "./output")
  .action(async (opts) => {
    if (!process.env.OPENAI_API_KEY) {
      log.err(
        "OPENAI_API_KEY is not set. Copy .env.example to .env and add your key.",
      );
      process.exit(1);
    }

    const ratios = opts.ratios
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);
    for (const r of ratios) {
      if (!VALID_RATIOS.has(r)) {
        log.err(`Unsupported ratio "${r}". Valid: 1:1, 16:9, 9:16.`);
        process.exit(1);
      }
    }
    // 16:9 is always produced (used downstream for landscape/web previews).
    if (!ratios.includes("16:9")) ratios.push("16:9");

    const products = opts.products
      ? opts.products
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((name) => ({ name }))
      : undefined;

    const overrides = {
      campaign:    opts.campaign,
      company:     opts.company,
      products,
      region:      opts.region,
      topic:       opts.topic,
      audience:    opts.audience,
      tone:        opts.tone,
      key_message: opts.keyMessage,
      cta:         opts.cta,
      brand: {
        // CLI --logo is resolved against CWD here so it stays an absolute path
        // through the pipeline (which otherwise resolves relative paths against
        // the brief's directory).
        logo_path: opts.logo ? path.resolve(opts.logo) : undefined,
        label:     opts.label,
        primary:   opts.primary,
        accent:    opts.accent,
      },
      hero: {
        image: opts.hero ? path.resolve(opts.hero) : undefined,
      },
    };

    const briefPath = path.resolve(opts.brief);
    const brief = await loadBrief(briefPath, overrides);

    const outDir = path.resolve(opts.out);
    await ensureDir(outDir);

    const manifest = await runCampaign({ brief, briefPath, ratios, outDir });

    log.ok(`Run complete: ${manifest.runDir}`);
    for (const p of manifest.products) {
      log.ok(`  ${p.name}`);
      for (const post of p.posts) {
        log.ok(`    ${post.ratio.padEnd(5)} -> ${path.relative(process.cwd(), post.image)}`);
      }
    }

    const galleryPath = await writeGallery(manifest);
    const galleryUrl = `file://${galleryPath}`;
    // OSC 8 hyperlink so terminals that support it render the URL as a clickable
    // label; terminals that don't will still show the raw file:// URL on the
    // next line.
    const OSC = "]8;;";
    const ST = "\\";
    const linked = `${OSC}${galleryUrl}${ST}Open campaign gallery${OSC}${ST}`;
    log.ok(`Gallery: ${linked}`);
    log.ok(galleryUrl);
  });

program.parseAsync(process.argv).catch((e) => {
  log.err(e?.stack || e?.message || String(e));
  process.exit(1);
});
