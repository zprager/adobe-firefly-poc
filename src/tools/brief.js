import fs from "node:fs/promises";
import YAML from "yaml";
// zod is a schema validation library — `z` is its builder namespace.
// Schemas defined below (e.g. BriefSchema) both validate runtime input
// and apply defaults via `.parse()`, throwing on malformed data.
import { z } from "zod";

const GuidelinesSchema = z
  .object({
    follow: z.array(z.string().min(1)).default([]),
    avoid: z.array(z.string().min(1)).default([]),
  })
  .default({});

const BrandSchema = z
  .object({
    primary: z.string().default("#0F172A"),
    accent: z.string().default("#F59E0B"),
    text_on_primary: z.string().default("#FFFFFF"),
    font_heading: z.string().default("Inter, system-ui, sans-serif"),
    font_body: z.string().default("Inter, system-ui, sans-serif"),
    logo_path: z.string().optional(),
    label: z.string().optional(),
    guidelines: GuidelinesSchema,
  })
  .default({});

const HeroSchema = z
  .object({
    style: z
      .string()
      .default(
        "Editorial photography, soft natural light, minimalist composition, muted tones"
      ),
    negative: z.string().default("no text, no logos, no faces unless asked"),
    image: z.string().optional(),
  })
  .default({});

const ProductSchema = z.union([
  z.string().min(1).transform((name) => ({ name })),
  z.object({
    name: z.string().min(1),
    description: z.string().optional(),
  }),
]);

export const BriefSchema = z.object({
  campaign: z.string().min(1),
  company: z.string().min(1).optional(),
  products: z
    .array(ProductSchema)
    .min(2, "Brief must include at least two products"),
  region: z.string().min(1),
  audience: z.string().min(1),
  key_message: z.string().min(1),
  topic: z.string().optional(),
  tone: z.string().default("clear, confident"),
  cta: z.string().optional(),
  brand: BrandSchema,
  hero: HeroSchema,
});

export async function loadBrief(briefPath, overrides = {}) {
  let data = {};
  if (briefPath) {
    const raw = await fs.readFile(briefPath, "utf8");
    data = briefPath.endsWith(".json") ? JSON.parse(raw) : YAML.parse(raw);
  }
  const merged = deepMerge(data, prune(overrides));
  return BriefSchema.parse(merged);
}

// Deep-prune undefined / null / "" values so overrides don't clobber brief fields.
function prune(o) {
  if (Array.isArray(o)) return o;
  if (o && typeof o === "object") {
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      if (v === undefined || v === null || v === "") continue;
      const pv = prune(v);
      if (
        pv &&
        typeof pv === "object" &&
        !Array.isArray(pv) &&
        Object.keys(pv).length === 0
      ) {
        continue;
      }
      out[k] = pv;
    }
    return out;
  }
  return o;
}

function deepMerge(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return b ?? a;
  if (a && b && typeof a === "object" && typeof b === "object") {
    const out = { ...a };
    for (const k of Object.keys(b)) out[k] = deepMerge(a?.[k], b[k]);
    return out;
  }
  return b ?? a;
}
