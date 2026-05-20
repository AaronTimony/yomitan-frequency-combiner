import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import JSZip from "jszip";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "../../output_freq_dicts");
const DECKS_CACHE_DIR = join(OUTPUT_DIR, "decks");
const MANIFEST_PATH = join(OUTPUT_DIR, "manifest.json");
const GENRE_DICTS_DIR = join(__dirname, "../../genre_dictionaries");
const JITEN_API = "https://api.jiten.moe/api";

// Jiten media-type IDs (see frontend/src/jitenApi.ts). Key is the --media arg.
const MEDIA_CONFIG = {
  anime: { jitenMediaType: 1, label: "Anime" },
  manga: { jitenMediaType: 9, label: "Manga" },
  videogame: { jitenMediaType: 6, label: "Video Game" },
  visualnovel: { jitenMediaType: 7, label: "Visual Novel" },
  novel: { jitenMediaType: 4, label: "Novel" },
  drama: { jitenMediaType: 2, label: "Drama" },
  movie: { jitenMediaType: 3, label: "Movie" },
};

// Jiten Genre enum (from its OpenAPI spec) → readable names.
const GENRE_NAMES = {
  1: "Action",
  2: "Adventure",
  3: "Comedy",
  4: "Drama",
  5: "Ecchi",
  6: "Fantasy",
  7: "Horror",
  8: "Mecha",
  9: "Music",
  10: "Mystery",
  11: "Psychological",
  12: "Romance",
  13: "Sci-Fi",
  14: "Slice of Life",
  15: "Sports",
  16: "Supernatural",
  17: "Thriller",
  18: "Adult Only",
};

// Jiten tag.percentage is the share of voters who agreed the tag applies.
// Below this a tag is mostly noise, so it doesn't earn its own bucket.
// Stored losslessly in the manifest; this only gates the build step.
const MIN_TAG_PCT = Number(process.env.MIN_TAG_PCT ?? 50);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sanitize(name) {
  return name.replace(/\s+/g, "_").replace(/[\\/:*?"<>|]/g, "_");
}

function mediaPrefix(label) {
  return label.toLowerCase().replace(/\s+/g, "") + "_dicts";
}

function parseRawEntry(term, data) {
  if ("reading" in data) {
    const hasMarker = data.frequency.displayValue.includes("㋕");
    const key = hasMarker ? `${term}\t${data.reading}\t㋕` : `${term}\t${data.reading}`;
    return { key, expression: term, reading: data.reading, value: data.frequency.value, hasMarker };
  }
  const hasMarker = data.displayValue.includes("㋕");
  return { key: term, expression: term, reading: null, value: data.value, hasMarker };
}

function byBankNumber(a, b) {
  const num = (s) => Number(s.match(/_(\d+)\.json$/)[1]);
  return num(a) - num(b);
}

async function aggregateDecks(items) {
  const entries = new Map();
  let baseIndex = null;
  let usedDecks = 0;

  let processed = 0;
  for (const { zipPath, title } of items) {
    processed++;
    if (processed % 50 === 0 || processed === items.length) {
      process.stdout.write(`\r    [${processed}/${items.length}] ${entries.size.toLocaleString()} unique entries`.padEnd(80));
    }
    try {
      const buf = readFileSync(zipPath);
      const zip = await JSZip.loadAsync(buf);

      const indexFile = zip.file("index.json");
      if (!indexFile) throw new Error("missing index.json");
      const index = JSON.parse(await indexFile.async("string"));
      if (!baseIndex) baseIndex = index;

      const bankFiles = Object.keys(zip.files)
        .filter((name) => /^term_meta_bank_\d+\.json$/.test(name))
        .sort(byBankNumber);

      if (bankFiles.length === 0) throw new Error("no term_meta_bank_*.json found");

      const seenInThisDeck = new Set();
      for (const bankName of bankFiles) {
        const text = await zip.file(bankName).async("string");
        const rawEntries = JSON.parse(text);
        for (const [term, , data, seq] of rawEntries) {
          const parsed = parseRawEntry(term, data);
          if (seenInThisDeck.has(parsed.key)) continue;
          seenInThisDeck.add(parsed.key);
          let entry = entries.get(parsed.key);
          if (!entry) {
            entry = {
              expression: parsed.expression,
              reading: parsed.reading,
              sum: 0,
              sequence: seq ?? null,
              hasMarker: parsed.hasMarker,
            };
            entries.set(parsed.key, entry);
          } else if (parsed.hasMarker) {
            entry.hasMarker = true;
          }
          entry.sum += parsed.value;
        }
      }
      usedDecks++;
    } catch (err) {
      console.warn(`    skipping "${title}": ${err.message}`);
    }
  }

  process.stdout.write("\n");
  if (usedDecks === 0 || !baseIndex) {
    throw new Error("no usable decks after parsing");
  }

  const sorted = [...entries.values()];
  sorted.sort((a, b) => b.sum - a.sum);
  return { sorted, baseIndex };
}

async function buildZip(sorted, baseIndex, dictTitle, sources, mode) {
  const outEntries = new Array(sorted.length);
  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    const value = mode === "rank" ? i + 1 : entry.sum;
    const display = String(value);
    const freqData =
      entry.reading !== null
        ? { reading: entry.reading, frequency: { value, displayValue: entry.hasMarker ? `${display}㋕` : display } }
        : { value, displayValue: `${display}㋕` };
    outEntries[i] = entry.sequence !== null
      ? [entry.expression, "freq", freqData, entry.sequence]
      : [entry.expression, "freq", freqData];
  }

  const outIndex = {
    ...baseIndex,
    title: dictTitle,
    revision: `${dictTitle} ${new Date().toISOString().slice(0, 10)}`,
    sources,
    totalWords: sources.reduce((sum, s) => sum + s.wordCount, 0),
  };

  const out = new JSZip();
  out.file("index.json", JSON.stringify(outIndex));
  out.file("term_meta_bank_1.json", JSON.stringify(outEntries));
  return out.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

// ---------------------------------------------------------------------------
// Jiten
// ---------------------------------------------------------------------------

async function fetchAllJitenDecks(jitenMediaType, maxPages = Infinity) {
  const allDecks = [];
  let offset = 0;
  let totalItems = Infinity;
  let pages = 0;

  while (offset < totalItems && pages < maxPages) {
    const params = new URLSearchParams({
      mediaType: String(jitenMediaType),
      offset: String(offset),
    });
    const res = await fetch(`${JITEN_API}/media-deck/get-media-decks?${params}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Jiten HTTP ${res.status}`);
    const body = await res.json();
    totalItems = body.totalItems;
    const batch = body.data ?? [];
    allDecks.push(...batch);
    offset += batch.length;
    pages++;
    process.stdout.write(`\rFetched ${allDecks.length} / ${totalItems} Jiten decks...`);
    if (batch.length === 0) break;
    if (offset < totalItems && pages < maxPages) await sleep(300);
  }
  console.log();
  return allDecks;
}

async function downloadDeckZip(deckId, attempt = 0) {
  try {
    const res = await fetch(`${JITEN_API}/media-deck/${deckId}/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: 5 }),
    });
    if (!res.ok) throw new Error(`Download HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    if (attempt >= 3) throw err;
    await sleep(2000 * (attempt + 1));
    return downloadDeckZip(deckId, attempt + 1);
  }
}

function mapGenres(ids) {
  return (ids ?? []).map((id) => GENRE_NAMES[id]).filter(Boolean);
}

function mapTags(tags) {
  return (tags ?? [])
    .filter((t) => t && t.name)
    .map((t) => ({ name: t.name, percentage: t.percentage ?? 0 }));
}

// ---------------------------------------------------------------------------
// Phase 1: harvest — download every deck once, record its Jiten genres + tags.
// ---------------------------------------------------------------------------

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) return { generatedAt: null, decks: [] };
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  } catch {
    return { generatedAt: null, decks: [] };
  }
}

async function harvest(opts) {
  mkdirSync(DECKS_CACHE_DIR, { recursive: true });

  const mediaKeys = opts.media === "all" ? Object.keys(MEDIA_CONFIG) : [opts.media];
  for (const k of mediaKeys) {
    if (!MEDIA_CONFIG[k]) {
      console.error(`Unknown --media "${k}" (one of: ${Object.keys(MEDIA_CONFIG).join(", ")}, all)`);
      process.exit(1);
    }
  }

  const manifest = loadManifest();
  const byId = new Map(manifest.decks.map((d) => [d.deckId, d]));

  for (const mediaArg of mediaKeys) {
    const { jitenMediaType, label } = MEDIA_CONFIG[mediaArg];
    console.log(`\n=== Harvesting ${label} ===`);

    console.log(`Fetching Jiten ${label} decks (with genres + tags)...`);
    const decks = await fetchAllJitenDecks(jitenMediaType, opts.jitenPages);

    for (let i = 0; i < decks.length; i++) {
      const deck = decks[i];
      const display = deck.englishTitle || deck.romajiTitle || deck.originalTitle || `deck ${deck.deckId}`;
      const zipRel = join("decks", `${deck.deckId}.zip`);
      const zipAbs = join(OUTPUT_DIR, zipRel);

      if (!existsSync(zipAbs)) {
        process.stdout.write(`[${i + 1}/${decks.length}] ${display} — downloading... `);
        const buf = await downloadDeckZip(deck.deckId);
        writeFileSync(zipAbs, buf);
        console.log("done");
        await sleep(6000);
      } else {
        process.stdout.write(`\r[${i + 1}/${decks.length}] ${display} — cached`.padEnd(80));
      }

      byId.set(deck.deckId, {
        deckId: deck.deckId,
        title: display,
        titleJp: deck.originalTitle ?? null,
        titleRomaji: deck.romajiTitle ?? null,
        titleEn: deck.englishTitle ?? null,
        mediaType: label,
        wordCount: deck.wordCount,
        genres: mapGenres(deck.genres),
        tags: mapTags(deck.tags),
        zip: zipRel,
      });
    }
    console.log(`\nProcessed ${decks.length} ${label} decks`);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    minTagPct: MIN_TAG_PCT,
    decks: [...byId.values()],
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(out, null, 2));
  console.log(`\nWrote manifest: ${MANIFEST_PATH} (${out.decks.length} decks)`);
}

// ---------------------------------------------------------------------------
// Phase 2: build — group cached decks into genre + tag buckets, merge locally.
// ---------------------------------------------------------------------------

async function buildBucket(kind, mediaLabel, name, decks) {
  const baseName = `${sanitize(name)}_${sanitize(mediaLabel)}_${kind}`;
  const sources = decks
    .map((d) => ({ title: d.title, wordCount: d.wordCount }))
    .sort((a, b) => b.wordCount - a.wordCount);
  const totalWords = sources.reduce((s, x) => s + x.wordCount, 0);

  const items = [];
  for (const d of decks) {
    const zipAbs = join(OUTPUT_DIR, d.zip);
    if (!existsSync(zipAbs)) {
      console.warn(`  missing cached zip for "${d.title}" (${d.zip}) — skipping`);
      continue;
    }
    items.push({ zipPath: zipAbs, title: d.title });
  }
  if (items.length === 0) {
    console.warn(`  ${kind} "${name}" (${mediaLabel}): no usable decks — skipped`);
    return;
  }

  const dictTitle = `${name} ${mediaLabel} Frequency`;
  let aggregated;
  try {
    aggregated = await aggregateDecks(items);
  } catch (err) {
    console.warn(`  ${kind} "${name}" (${mediaLabel}): ${err.message} — skipped`);
    return;
  }

  const rankBuffer = await buildZip(aggregated.sorted, aggregated.baseIndex, dictTitle, sources, "rank");
  const countBuffer = await buildZip(aggregated.sorted, aggregated.baseIndex, `${dictTitle} (Counts)`, sources, "count");

  const sourcesJson = JSON.stringify(
    {
      genre: name,
      bucketType: kind,
      mediaType: mediaLabel,
      totalWords,
      searched: decks.length,
      matched: items.length,
      sources,
    },
    null,
    2,
  );

  const mediaDir = join(GENRE_DICTS_DIR, mediaPrefix(mediaLabel));
  mkdirSync(mediaDir, { recursive: true });
  writeFileSync(join(mediaDir, `${baseName}.zip`), rankBuffer);
  writeFileSync(join(mediaDir, `${baseName}_count.zip`), countBuffer);
  writeFileSync(join(mediaDir, `${baseName}_sources.json`), sourcesJson);
  console.log(
    `  ${kind} "${name}" (${mediaLabel}): ${items.length} decks, ${totalWords.toLocaleString()} words → ${baseName}.zip + _count.zip`,
  );
}

async function build(opts) {
  const manifest = loadManifest();
  if (manifest.decks.length === 0) {
    console.error("Manifest is empty. Run `harvest` first.");
    process.exit(1);
  }

  mkdirSync(GENRE_DICTS_DIR, { recursive: true });

  const mediaFilter = opts.media ? MEDIA_CONFIG[opts.media]?.label ?? null : null;
  if (opts.media && !mediaFilter) {
    console.error(`Unknown --media "${opts.media}"`);
    process.exit(1);
  }
  const minPct = opts.minTagPct ?? MIN_TAG_PCT;

  // bucket key: `${kind}\t${mediaLabel}\t${name}` -> deck[]
  const buckets = new Map();
  const add = (kind, media, name, deck) => {
    const key = `${kind}\t${media}\t${name}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(deck);
  };

  for (const deck of manifest.decks) {
    const media = deck.mediaType;
    if (mediaFilter && media !== mediaFilter) continue;
    if (opts.kind !== "tag") {
      for (const g of deck.genres ?? []) add("genre", media, g, deck);
    }
    if (opts.kind !== "genre") {
      for (const t of deck.tags ?? []) {
        if ((t.percentage ?? 0) >= minPct) add("tag", media, t.name, deck);
      }
    }
  }

  if (buckets.size === 0) {
    console.log("No buckets matched the given filters.");
    return;
  }

  console.log(`Building ${buckets.size} buckets (min tag pct: ${minPct})...\n`);
  for (const [key, decks] of [...buckets.entries()].sort()) {
    const [kind, media, name] = key.split("\t");
    if (opts.only && name.toLowerCase() !== opts.only) continue;
    await buildBucket(kind, media, name, decks);
  }
  console.log("\nDone.");
}

// ---------------------------------------------------------------------------

function parseHarvestOpts(argv) {
  const opts = { media: "all", jitenPages: Infinity };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--media") opts.media = argv[++i]?.toLowerCase() ?? "all";
    else if (argv[i] === "--jiten-pages") opts.jitenPages = Number(argv[++i]);
  }
  return opts;
}

function parseBuildOpts(argv) {
  const opts = { media: null, kind: null, only: null, minTagPct: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--media") opts.media = argv[++i]?.toLowerCase() ?? null;
    else if (argv[i] === "--kind") opts.kind = argv[++i]?.toLowerCase() ?? null;
    else if (argv[i] === "--only") opts.only = argv[++i]?.toLowerCase() ?? null;
    else if (argv[i] === "--min-tag-pct") opts.minTagPct = Number(argv[++i]);
  }
  return opts;
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const cmd = process.argv[2];

  if (cmd === "harvest") {
    await harvest(parseHarvestOpts(process.argv.slice(3)));
  } else if (cmd === "build") {
    await build(parseBuildOpts(process.argv.slice(3)));
  } else {
    console.error(
      [
        "Usage:",
        "  node scripts/build_freq_dicts.mjs harvest [--media <type>|all] [--jiten-pages N]",
        `      Download Jiten decks once and record genres + tags → manifest.json`,
        `      <type>: ${Object.keys(MEDIA_CONFIG).join(", ")}. Default: all.`,
        "",
        "  node scripts/build_freq_dicts.mjs build [--media <type>] [--kind genre|tag] [--only <name>] [--min-tag-pct N]",
        "      Merge cached decks into per genre/tag frequency dictionaries",
      ].join("\n"),
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
