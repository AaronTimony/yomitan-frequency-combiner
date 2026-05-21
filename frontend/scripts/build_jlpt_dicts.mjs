import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import JSZip from "jszip";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "../../jlpt_dicts");
const DECKS_CACHE_DIR = join(OUTPUT_DIR, "decks");
const JITEN_API = "https://api.jiten.moe/api";

// Jiten currently only hosts N1, N2, N3 (no N4/N5). If those appear later,
// add their deckIds here.
const JLPT_DECKS = [
  { level: "N1", deckId: 107267 },
  { level: "N2", deckId: 107268 },
  { level: "N3", deckId: 107269 },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

let cachedListing = null;
async function fetchDeckMetadata(deckId) {
  if (!cachedListing) {
    const res = await fetch(`${JITEN_API}/media-deck/get-media-decks?titleFilter=JLPT`);
    if (!res.ok) throw new Error(`Listing HTTP ${res.status}`);
    const body = await res.json();
    cachedListing = new Map((body.data ?? []).map((d) => [d.deckId, d]));
  }
  const meta = cachedListing.get(deckId);
  if (!meta) throw new Error(`deck ${deckId} not found in JLPT listing`);
  return meta;
}

async function parseDeckEntries(zipBuf) {
  const zip = await JSZip.loadAsync(zipBuf);
  const indexFile = zip.file("index.json");
  if (!indexFile) throw new Error("missing index.json");
  const baseIndex = JSON.parse(await indexFile.async("string"));

  const bankFiles = Object.keys(zip.files)
    .filter((name) => /^term_meta_bank_\d+\.json$/.test(name))
    .sort(byBankNumber);
  if (bankFiles.length === 0) throw new Error("no term_meta_bank_*.json found");

  // The Jiten deck zip is itself a single source. Dedupe keys within the deck
  // so the same (expression, reading) doesn't appear twice.
  const entries = new Map();
  for (const bankName of bankFiles) {
    const text = await zip.file(bankName).async("string");
    const rawEntries = JSON.parse(text);
    for (const [term, , data, seq] of rawEntries) {
      const parsed = parseRawEntry(term, data);
      if (entries.has(parsed.key)) continue;
      entries.set(parsed.key, {
        expression: parsed.expression,
        reading: parsed.reading,
        sum: parsed.value,
        sequence: seq ?? null,
        hasMarker: parsed.hasMarker,
      });
    }
  }

  const sorted = [...entries.values()].sort((a, b) => b.sum - a.sum);
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

async function buildLevel({ level, deckId }) {
  console.log(`\n=== JLPT ${level} (deck ${deckId}) ===`);

  const cacheRel = join("decks", `${deckId}.zip`);
  const cacheAbs = join(OUTPUT_DIR, cacheRel);
  mkdirSync(dirname(cacheAbs), { recursive: true });

  let zipBuf;
  if (existsSync(cacheAbs)) {
    console.log(`  using cached ${cacheRel}`);
    zipBuf = readFileSync(cacheAbs);
  } else {
    console.log(`  downloading...`);
    zipBuf = await downloadDeckZip(deckId);
    writeFileSync(cacheAbs, zipBuf);
    console.log(`  cached → ${cacheRel}`);
    await sleep(6000);
  }

  const meta = await fetchDeckMetadata(deckId);
  const sourceTitle = meta.englishTitle || meta.romajiTitle || meta.originalTitle || `JLPT ${level}`;
  const wordCount = meta.wordCount ?? 0;
  const sources = [{ title: sourceTitle, wordCount }];

  const { sorted, baseIndex } = await parseDeckEntries(zipBuf);
  console.log(`  ${sorted.length.toLocaleString()} unique entries, ${wordCount.toLocaleString()} words`);

  const dictTitle = `JLPT ${level} Frequency`;
  const rankBuffer = await buildZip(sorted, baseIndex, dictTitle, sources, "rank");
  const countBuffer = await buildZip(sorted, baseIndex, `${dictTitle} (Counts)`, sources, "count");

  const sourcesJson = JSON.stringify(
    {
      genre: level,
      bucketType: "jlpt",
      mediaType: "JLPT",
      totalWords: wordCount,
      searched: 1,
      matched: 1,
      sources,
    },
    null,
    2,
  );

  const baseName = level;
  writeFileSync(join(OUTPUT_DIR, `${baseName}.zip`), rankBuffer);
  writeFileSync(join(OUTPUT_DIR, `${baseName}_count.zip`), countBuffer);
  writeFileSync(join(OUTPUT_DIR, `${baseName}_sources.json`), sourcesJson);
  console.log(`  wrote ${baseName}.zip + ${baseName}_count.zip + ${baseName}_sources.json`);
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const deck of JLPT_DECKS) {
    await buildLevel(deck);
  }
  console.log(`\nDone. Upload contents of ${OUTPUT_DIR} (except decks/) to R2 under jlpt_dicts/`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
