import { writeFileSync, mkdirSync, readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import JSZip from "jszip";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "../../output_freq_dicts");
const PUBLIC_SOURCES_DIR = join(__dirname, "../public/sources");
const PUBLIC_DICTS_DIR = join(__dirname, "../public/dicts");
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
    if (res.status === 400) return { media: [], hasNextPage: false };
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

async function fetchAllJitenDecks(jitenMediaType) {
  const allDecks = [];
  let offset = 0;
  let totalItems = Infinity;

  while (offset < totalItems) {
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
    allDecks.push(...(body.data ?? []));
    offset += 25;
    process.stdout.write(`\rFetched ${allDecks.length} / ${totalItems} Jiten decks...`);
    if (offset < totalItems) await sleep(300);
  }
  console.log();
  return allDecks;
}

function buildJitenIndex(decks) {
  const index = new Map();
  for (const deck of decks) {
    for (const title of [deck.originalTitle, deck.romajiTitle, deck.englishTitle]) {
      if (title) index.set(title.toLowerCase().trim(), deck);
    }
  }
  return index;
}

function findMatch(searchTitle, index) {
  const needle = searchTitle.toLowerCase().trim();
  if (index.has(needle)) return index.get(needle);
  for (const [key, deck] of index) {
    if (key.includes(needle) || needle.includes(key)) return deck;
  }
  return null;
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

function matchCachePath(baseName) {
  return join(OUTPUT_DIR, `${baseName}_match.json`);
}

// Find a previously-saved match cache for this media type, if any. The match
// (AniList ↔ Jiten) is the slow, flaky part; once it's on disk we can resume
// straight to zip downloads without hitting AniList or Jiten again.
function loadMatchCache(label) {
  try {
    const file = readdirSync(OUTPUT_DIR).find((f) => f.endsWith(`_${label}_match.json`));
    if (!file) return null;
    const data = JSON.parse(readFileSync(join(OUTPUT_DIR, file), "utf8"));
    if (!Array.isArray(data.matched) || data.matched.length === 0) return null;
    return data;
  } catch {
    return null;
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
  mkdirSync(PUBLIC_SOURCES_DIR, { recursive: true });
  mkdirSync(PUBLIC_DICTS_DIR, { recursive: true });

  const fresh = process.argv.includes("--fresh");
  const cache = fresh ? null : loadMatchCache(label);

  let genre;
  let searchedCount;
  let matched;
  let totalWords;

  if (cache) {
    genre = cache.genre;
    searchedCount = cache.searched;
    totalWords = cache.totalWords;
    matched = cache.matched.map((m) => ({ display: m.display, deck: m.deck }));
    console.log(`Found cached match for "${genre}" ${label}: ${matched.length} decks, ${totalWords.toLocaleString()} words.`);
    console.log("Skipping AniList + Jiten matching (pass --fresh to rebuild it).\n");
  } else {
    console.log("Fetching genres from AniList...");
    const genres = await fetchGenres();
    console.log(`Available genres: ${genres.join(", ")}`);

    genre = genres[0];
    console.log(`\nUsing first genre: "${genre}"`);

    const allTitles = [];
    let aniPage = 1;
    let hasNextPage = true;
    while (hasNextPage && aniPage <= 100) {
      console.log(`Fetching ${anilistType} page ${aniPage} for genre "${genre}"...`);
      const page = await fetchAniListPage(genre, anilistType, aniPage);
      allTitles.push(...page.media);
      hasNextPage = page.hasNextPage;
      aniPage++;
      if (hasNextPage) await sleep(1000);
    }
    console.log(`Got ${allTitles.length} titles total\n`);

    console.log("Fetching all Jiten decks...");
    const jitenDecks = await fetchAllJitenDecks(jitenMediaType);
    const jitenIndex = buildJitenIndex(jitenDecks);
    console.log(`Built index of ${jitenIndex.size} titles\n`);

    matched = [];
    totalWords = 0;
    const seen = new Set();

    for (const item of allTitles) {
      const searchTitle = item.title.romaji ?? item.title.english ?? "";
      const deck = findMatch(searchTitle, jitenIndex)
        ?? findMatch(item.title.english ?? "", jitenIndex)
        ?? findMatch(item.title.native ?? "", jitenIndex);

      if (deck && !seen.has(deck.deckId)) {
        seen.add(deck.deckId);
        const display = item.title.english ?? item.title.romaji ?? "Unknown";
        matched.push({ display, deck });
        totalWords += deck.wordCount;
      }
    }

    searchedCount = allTitles.length;
    console.log(`Matched ${matched.length} / ${searchedCount} — ${totalWords.toLocaleString()} total words`);

    if (matched.length === 0) {
      console.log("No matches — nothing to save.");
      return;
    }
  }

  const baseName = `${genre.replace(/\s+/g, "_")}_${label}`;
  const sources = matched.map((m) => ({ title: m.display, wordCount: m.deck.wordCount }));
  const sourcesJson = JSON.stringify(
    { genre, mediaType: label, totalWords, searched: searchedCount, matched: matched.length, sources },
    null,
    2,
  );

  const sourcesPath = join(OUTPUT_DIR, `${baseName}_sources.json`);
  const publicSourcesPath = join(PUBLIC_SOURCES_DIR, `${baseName}_sources.json`);

  // Persist the match (with deck IDs) and the sources JSON BEFORE the slow zip
  // downloads. If a download fails or is slow, a re-run reads this back and
  // resumes straight to downloading instead of redoing AniList + Jiten.
  if (!cache) {
    const matchCache = {
      genre,
      mediaType: label,
      jitenMediaType,
      searched: searchedCount,
      totalWords,
      matched: matched.map((m) => ({
        display: m.display,
        deck: {
          deckId: m.deck.deckId,
          wordCount: m.deck.wordCount,
          originalTitle: m.deck.originalTitle ?? "",
          englishTitle: m.deck.englishTitle ?? "",
        },
      })),
    };
    writeFileSync(matchCachePath(baseName), JSON.stringify(matchCache, null, 2));
    console.log(`\nSaved match cache: ${matchCachePath(baseName)}`);
  }
  writeFileSync(sourcesPath, sourcesJson);
  writeFileSync(publicSourcesPath, sourcesJson);
  console.log(`Saved sources: ${sourcesPath}`);
  console.log(`Saved sources: ${publicSourcesPath} (served with app)\n`);

  console.log("Downloading deck zips...");
  const buffers = [];
  for (let i = 0; i < matched.length; i++) {
    const { deck } = matched[i];
    process.stdout.write(`[${i + 1}/${matched.length}] ${deck.originalTitle || deck.englishTitle}... `);
    buffers.push(await downloadDeckZip(deck.deckId));
    console.log("done");
    if (i < matched.length - 1) await sleep(6000);
  }

  console.log("\nMerging...");
  const dictTitle = `${genre} ${label} Frequency`;
  const outBuffer = await mergeDecks(buffers, dictTitle, sources);

  const zipPath = join(OUTPUT_DIR, `${baseName}.zip`);
  const publicZipPath = join(PUBLIC_DICTS_DIR, `${baseName}.zip`);
  writeFileSync(zipPath, outBuffer);
  writeFileSync(publicZipPath, outBuffer);

  console.log(`\nSaved:`);
  console.log(`  ${zipPath}`);
  console.log(`  ${publicZipPath} (served with app)`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
