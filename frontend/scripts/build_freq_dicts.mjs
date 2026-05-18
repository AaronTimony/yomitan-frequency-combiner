import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import JSZip from "jszip";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "../../output_freq_dicts");
const JITEN_API = "https://api.jiten.moe/api";

const MEDIA_CONFIG = {
  anime: { anilistType: "ANIME", jitenMediaType: 1, label: "Anime" },
  manga: { anilistType: "MANGA", jitenMediaType: 9, label: "Manga" },
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseKey(key) {
  const parts = key.split("\t");
  if (parts.length === 1) return { expression: parts[0], reading: null, hasMarker: false };
  if (parts.length === 3 && parts[2] === "㋕") return { expression: parts[0], reading: parts[1], hasMarker: true };
  return { expression: parts[0], reading: parts[1], hasMarker: false };
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

async function mergeDecks(buffers, dictTitle, sources) {
  const numDicts = buffers.length;
  const perDictMaps = [];
  let baseIndex = null;

  for (const buf of buffers) {
    const zip = await JSZip.loadAsync(buf);

    const indexFile = zip.file("index.json");
    if (!indexFile) throw new Error("missing index.json");
    const index = JSON.parse(await indexFile.async("string"));
    if (!baseIndex) baseIndex = index;

    const bankFiles = Object.keys(zip.files)
      .filter((name) => /^term_meta_bank_\d+\.json$/.test(name))
      .sort(byBankNumber);

    if (bankFiles.length === 0) throw new Error("no term_meta_bank_*.json found");

    const dictMap = new Map();
    for (const bankName of bankFiles) {
      const text = await zip.file(bankName).async("string");
      const rawEntries = JSON.parse(text);
      for (const [term, , data, seq] of rawEntries) {
        const parsed = parseRawEntry(term, data);
        if (!dictMap.has(parsed.key)) {
          dictMap.set(parsed.key, { value: parsed.value, sequence: seq ?? null, hasMarker: parsed.hasMarker });
        }
      }
    }
    perDictMaps.push(dictMap);
  }

  const entries = new Map();
  for (let dictIdx = 0; dictIdx < numDicts; dictIdx++) {
    for (const [key, { value, sequence, hasMarker }] of perDictMaps[dictIdx]) {
      if (!entries.has(key)) {
        const { expression, reading, hasMarker: keyHasMarker } = parseKey(key);
        entries.set(key, {
          expression,
          reading,
          freqs: new Array(numDicts).fill(null),
          sequence,
          hasMarker: keyHasMarker || hasMarker,
        });
      }
      entries.get(key).freqs[dictIdx] = value;
    }
  }

  const summed = [...entries.values()].map((entry) => ({
    entry,
    sum: entry.freqs.reduce((acc, f) => acc + (f ?? 0), 0),
  }));
  summed.sort((a, b) => b.sum - a.sum);

  const outEntries = [];
  for (let i = 0; i < summed.length; i++) {
    const rank = i + 1;
    const { entry } = summed[i];
    const freqData =
      entry.reading !== null
        ? { reading: entry.reading, frequency: { value: rank, displayValue: entry.hasMarker ? `${rank}㋕` : String(rank) } }
        : { value: rank, displayValue: `${rank}㋕` };
    const row = entry.sequence !== null
      ? [entry.expression, "freq", freqData, entry.sequence]
      : [entry.expression, "freq", freqData];
    outEntries.push(row);
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

async function fetchGenres() {
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "{ GenreCollection }" }),
  });
  if (!res.ok) throw new Error(`AniList GenreCollection HTTP ${res.status}`);
  const json = await res.json();
  return json.data.GenreCollection;
}

async function fetchAniListPage(genre, anilistType, page, attempt = 0) {
  const query = `
    query ($genre: String, $page: Int) {
      Page(page: $page, perPage: 50) {
        pageInfo { hasNextPage }
        media(genre: $genre, type: ${anilistType}, sort: POPULARITY_DESC) {
          id
          title { romaji english native }
        }
      }
    }
  `;
  try {
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { genre, page } }),
    });
    if (res.status === 429) {
      if (attempt >= 5) throw new Error("AniList rate limit — too many retries");
      const retryAfter = Number(res.headers.get("Retry-After") ?? 60);
      await sleep(retryAfter * 1000);
      return fetchAniListPage(genre, anilistType, page, attempt + 1);
    }
    if (!res.ok) throw new Error(`AniList HTTP ${res.status}`);
    const json = await res.json();
    const p = json.data.Page;
    return { media: p.media, hasNextPage: p.pageInfo.hasNextPage };
  } catch (err) {
    if (err instanceof TypeError && attempt < 5) {
      await sleep(2000 * (attempt + 1));
      return fetchAniListPage(genre, anilistType, page, attempt + 1);
    }
    throw err;
  }
}

async function searchJiten(title, jitenMediaType, attempt = 0) {
  try {
    const params = new URLSearchParams({
      titleFilter: title,
      mediaType: String(jitenMediaType),
      offset: "0",
    });
    const res = await fetch(`${JITEN_API}/media-deck/get-media-decks?${params}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Jiten HTTP ${res.status}`);
    const body = await res.json();
    return body.data?.[0] ?? null;
  } catch {
    if (attempt >= 4) return null;
    await sleep(3000 * (attempt + 1));
    return searchJiten(title, jitenMediaType, attempt + 1);
  }
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

async function main() {
  const mediaArg = process.argv[2]?.toLowerCase();
  if (!mediaArg || !MEDIA_CONFIG[mediaArg]) {
    console.error("Usage: node scripts/build_freq_dicts.mjs <anime|manga>");
    process.exit(1);
  }

  const { anilistType, jitenMediaType, label } = MEDIA_CONFIG[mediaArg];
  mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log("Fetching genres from AniList...");
  const genres = await fetchGenres();
  console.log(`Available genres: ${genres.join(", ")}`);

  const genre = genres[0];
  console.log(`\nUsing first genre: "${genre}"`);

  console.log(`Fetching ${anilistType} page 1 for genre "${genre}"...`);
  const page = await fetchAniListPage(genre, anilistType, 1);
  console.log(`Got ${page.media.length} titles`);

  const titles = page.media.slice(0, 10);
  const matched = [];
  let totalWords = 0;

  for (let i = 0; i < titles.length; i++) {
    const item = titles[i];
    const searchTitle = item.title.romaji ?? item.title.english ?? "";
    process.stdout.write(`[${i + 1}/${titles.length}] "${searchTitle}" → `);

    const deck = await searchJiten(searchTitle, jitenMediaType);
    if (deck) {
      const display = item.title.english ?? item.title.romaji ?? "Unknown";
      matched.push({ display, deck });
      totalWords += deck.wordCount;
      console.log(`matched "${deck.originalTitle || deck.englishTitle}" (${deck.wordCount.toLocaleString()} words)`);
    } else {
      console.log("no match");
    }

    await sleep(500);
  }

  console.log(`\nMatched ${matched.length} / ${titles.length} — ${totalWords.toLocaleString()} total words`);

  if (matched.length === 0) {
    console.log("No matches — nothing to save.");
    return;
  }

  console.log("\nDownloading deck zips...");
  const buffers = [];
  for (let i = 0; i < matched.length; i++) {
    const { deck } = matched[i];
    process.stdout.write(`[${i + 1}/${matched.length}] ${deck.originalTitle || deck.englishTitle}... `);
    buffers.push(await downloadDeckZip(deck.deckId));
    console.log("done");
    if (i < matched.length - 1) await sleep(2500);
  }

  console.log("\nMerging...");
  const dictTitle = `${genre} ${label} Frequency`;
  const sources = matched.map((m) => ({ title: m.display, wordCount: m.deck.wordCount }));
  const outBuffer = await mergeDecks(buffers, dictTitle, sources);

  const baseName = `${genre.replace(/\s+/g, "_")}_${label}`;
  const zipPath = join(OUTPUT_DIR, `${baseName}.zip`);
  const sourcesPath = join(OUTPUT_DIR, `${baseName}_sources.json`);

  writeFileSync(zipPath, outBuffer);
  writeFileSync(
    sourcesPath,
    JSON.stringify({ genre, mediaType: label, totalWords, searched: titles.length, matched: matched.length, sources }, null, 2),
  );

  console.log(`\nSaved:`);
  console.log(`  ${zipPath}`);
  console.log(`  ${sourcesPath}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
