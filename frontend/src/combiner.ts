import JSZip from "jszip";

export interface DictSource {
  title: string;
  wordCount: number;
}

interface IndexJson {
  title: string;
  format: number;
  revision: string;
  [key: string]: unknown;
}

type RawFreqData =
  | { value: number; displayValue: string }
  | { reading: string; frequency: { value: number; displayValue: string } };

type RawEntry = [string, "freq", RawFreqData, number?];

export interface FreqEntry {
  expression: string;
  reading: string | null; // null = kana-only (no separate reading)
  freqs: (number | null)[]; // one slot per dict, null = not present in that dict
  sequence: number | null; // from first dict that has this entry; null if dict omits it
  hasMarker: boolean; // true if ANY input dict had ㋕ in the displayValue for this entry
}

export interface FrequencyData {
  dictTitles: string[];
  baseIndex: IndexJson;
  entries: Map<string, FreqEntry>;
}

// Key format for kanji entries without kana marker: "expression\treading"
// Key format for kanji entries with kana marker (㋕):  "expression\treading\t㋕"
// Key format for standalone kana entries:              "expression"
// The ㋕ suffix distinguishes kanji-rank from kana-rank entries for the same expression+reading pair.
export function entryKey(expression: string, reading: string | null, hasMarker: boolean): string {
  if (reading === null) return expression;
  return hasMarker ? `${expression}\t${reading}\t㋕` : `${expression}\t${reading}`;
}

export function parseKey(key: string): { expression: string; reading: string | null; hasMarker: boolean } {
  const parts = key.split("\t");
  if (parts.length === 1) return { expression: parts[0], reading: null, hasMarker: false };
  if (parts.length === 3 && parts[2] === "㋕") return { expression: parts[0], reading: parts[1], hasMarker: true };
  return { expression: parts[0], reading: parts[1], hasMarker: false };
}

export function parseRawEntry(
  term: string,
  data: RawFreqData,
): { key: string; expression: string; reading: string | null; value: number; hasMarker: boolean } {
  if ("reading" in data) {
    const hasMarker = data.frequency.displayValue.includes("㋕");
    return {
      key: entryKey(term, data.reading, hasMarker),
      expression: term,
      reading: data.reading,
      value: data.frequency.value,
      hasMarker,
    };
  }
  const hasMarker = data.displayValue.includes("㋕");
  return {
    key: entryKey(term, null, hasMarker),
    expression: term,
    reading: null,
    value: data.value,
    hasMarker,
  };
}

export async function readFrequencies(files: readonly File[]): Promise<FrequencyData> {
  if (files.length === 0) throw new Error("No files provided");

  const dictTitles: string[] = [];
  const perDictMaps: Map<string, { value: number; sequence: number | null; hasMarker: boolean }>[] = [];
  let baseIndex: IndexJson | null = null;

  for (const file of files) {
    const zip = await JSZip.loadAsync(file);

    const indexFile = zip.file("index.json");
    if (!indexFile) throw new Error(`${file.name}: missing index.json`);
    const index = JSON.parse(await indexFile.async("string")) as IndexJson;
    if (!baseIndex) baseIndex = index;
    dictTitles.push(index.title);

    const bankFiles = Object.keys(zip.files)
      .filter((name) => /^term_meta_bank_\d+\.json$/.test(name))
      .sort(byBankNumber);

    if (bankFiles.length === 0) throw new Error(`${file.name}: no term_meta_bank_*.json found`);

    const dictMap = new Map<string, { value: number; sequence: number | null; hasMarker: boolean }>();

    for (const bankName of bankFiles) {
      const text = await zip.file(bankName)!.async("string");
      const rawEntries = JSON.parse(text) as RawEntry[];
      for (const [term, , data, seq] of rawEntries) {
        const parsed = parseRawEntry(term, data);
        if (!dictMap.has(parsed.key)) {
          dictMap.set(parsed.key, { value: parsed.value, sequence: seq ?? null, hasMarker: parsed.hasMarker });
        }
      }
    }

    perDictMaps.push(dictMap);
  }

  const numDicts = files.length;
  const entries = new Map<string, FreqEntry>();

  for (let dictIdx = 0; dictIdx < numDicts; dictIdx++) {
    for (const [key, { value, sequence, hasMarker }] of perDictMaps[dictIdx]) {
      if (!entries.has(key)) {
        const { expression, reading, hasMarker: keyHasMarker } = parseKey(key);
        entries.set(key, {
          expression,
          reading,
          freqs: new Array<number | null>(numDicts).fill(null),
          sequence,
          hasMarker: keyHasMarker || hasMarker,
        });
      }
      entries.get(key)!.freqs[dictIdx] = value;
    }
  }

  return { dictTitles, baseIndex: baseIndex!, entries };
}

export function logFrequencySample(data: FrequencyData, sampleSize = 8): void {
  const { dictTitles, entries } = data;

  const sample = [...entries.values()]
    .filter((e) => e.freqs.filter((f) => f !== null).length >= 2)
    .slice(0, sampleSize);

  console.log("=== Frequency sample (entries present in ≥2 dicts) ===");
  console.log(
    ["form".padEnd(20), ...dictTitles.map((t) => t.slice(0, 18).padEnd(20)), "avg"].join(" | "),
  );

  for (const entry of sample) {
    const form = entry.reading
      ? `${entry.expression}(${entry.reading})`
      : entry.expression;
    const defined = entry.freqs.filter((f): f is number => f !== null);
    const avg = (defined.reduce((a, b) => a + b, 0) / defined.length).toFixed(1);
    const cols = entry.freqs.map((f) => (f === null ? "—" : String(f)).padEnd(20));
    console.log([form.padEnd(20), ...cols, avg].join(" | "));
  }
}

type OutEntry = [string, "freq", RawFreqData] | [string, "freq", RawFreqData, number];

function pushOut(
  outEntries: OutEntry[],
  term: string,
  data: RawFreqData,
  sequence: number | null,
): void {
  if (sequence !== null) {
    outEntries.push([term, "freq", data, sequence]);
  } else {
    outEntries.push([term, "freq", data]);
  }
}

function buildSummedAndRankedEntries(data: FrequencyData): OutEntry[] {
  const summed = [...data.entries].map(([, entry]) => ({
    entry,
    sum: entry.freqs.reduce<number>((acc, f) => acc + (f ?? 0), 0),
  }));

  summed.sort((a, b) => b.sum - a.sum);

  const outEntries: OutEntry[] = [];
  for (let i = 0; i < summed.length; i++) {
    const rank = i + 1;
    const { entry } = summed[i];
    if (entry.reading !== null) {
      pushOut(
        outEntries,
        entry.expression,
        { reading: entry.reading, frequency: { value: rank, displayValue: entry.hasMarker ? `${rank}㋕` : String(rank) } },
        entry.sequence,
      );
    } else {
      pushOut(outEntries, entry.expression, { value: rank, displayValue: `${rank}㋕` }, entry.sequence);
    }
  }
  return outEntries;
}

export async function mergeJitenDecks(files: readonly File[], title: string, sources?: DictSource[]): Promise<Blob> {
  if (files.length === 0) throw new Error("No files to merge");
  const data = await readFrequencies(files);
  const outEntries = buildSummedAndRankedEntries(data);
  const outIndex: IndexJson = {
    ...data.baseIndex,
    title,
    revision: `${title} ${new Date().toISOString().slice(0, 10)}`,
    ...(sources && {
      sources,
      totalWords: sources.reduce((sum, s) => sum + s.wordCount, 0),
    }),
  };
  const out = new JSZip();
  out.file("index.json", JSON.stringify(outIndex));
  out.file("term_meta_bank_1.json", JSON.stringify(outEntries));
  return out.generateAsync({ type: "blob", compression: "DEFLATE" });
}

function buildAveragedEntries(data: FrequencyData): OutEntry[] {
  const outEntries: OutEntry[] = [];

  for (const entry of data.entries.values()) {
    const defined = entry.freqs.filter((f): f is number => f !== null);
    if (defined.length === 0) continue;

    const avg = Math.round(defined.reduce((a, b) => a + b, 0) / defined.length);

    if (entry.reading !== null) {
      pushOut(
        outEntries,
        entry.expression,
        { reading: entry.reading, frequency: { value: avg, displayValue: entry.hasMarker ? `${avg}㋕` : String(avg) } },
        entry.sequence,
      );
    } else {
      pushOut(outEntries, entry.expression, { value: avg, displayValue: `${avg}㋕` }, entry.sequence);
    }
  }

  outEntries.sort((a, b) => {
    const val = (e: OutEntry) => {
      const d = e[2];
      return "reading" in d ? d.frequency.value : d.value;
    };
    return val(a) - val(b);
  });

  return outEntries;
}

export async function previewAveraged(files: readonly File[]): Promise<void> {
  if (files.length === 0) throw new Error("No files provided");
  const data = await readFrequencies(files);
  const entries = buildAveragedEntries(data);
  const rows = entries.map((e) => JSON.stringify(e)).join(",\n");
  downloadBlob(
    new Blob([`[\n${rows}\n]`], { type: "application/json" }),
    "preview.json",
  );
}

export async function previewTermBank(files: readonly File[]): Promise<void> {
  if (files.length === 0) throw new Error("No files provided");

  const allEntries: unknown[] = [];
  for (const file of files) {
    const zip = await JSZip.loadAsync(file);
    const bankFiles = Object.keys(zip.files)
      .filter((name) => /^term_bank_\d+\.json$/.test(name))
      .sort(byBankNumber);
    for (const name of bankFiles) {
      const entries = JSON.parse(await zip.file(name)!.async("string")) as unknown[];
      for (const e of entries) allEntries.push(e);
    }
  }

  if (allEntries.length === 0) {
    alert("No term_bank_*.json files found in the selected zips.");
    return;
  }

  const rows = allEntries.map((e) => JSON.stringify(e)).join(",\n");
  downloadBlob(
    new Blob([`[\n${rows}\n]`], { type: "application/json" }),
    "term_bank_preview.json",
  );
}

const isMetaBank = (name: string) => /^term_meta_bank_\d+\.json$/.test(name);

export async function averageZips(files: readonly File[], title: string): Promise<Blob> {
  if (files.length === 0) throw new Error("No files to average");

  const data = await readFrequencies(files);
  logFrequencySample(data);

  const out = new JSZip();

  // Copy every non-index, non-meta-bank file from every input zip.
  // First occurrence of a given filename wins (avoids conflicts while keeping all content).
  const seen = new Set<string>();
  for (const file of files) {
    const zip = await JSZip.loadAsync(file);
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      if (name === "index.json") continue;
      if (isMetaBank(name)) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      out.file(name, await entry.async("uint8array"));
    }
  }

  // Replace frequency data with our averaged version
  const outEntries = buildAveragedEntries(data);
  const outIndex: IndexJson = {
    ...data.baseIndex,
    title,
    revision: `${title} ${new Date().toISOString().slice(0, 10)}`,
  };
  out.file("index.json", JSON.stringify(outIndex));
  out.file("term_meta_bank_1.json", JSON.stringify(outEntries));

  return out.generateAsync({ type: "blob", compression: "DEFLATE" });
}

export async function combineZips(files: readonly File[], title: string): Promise<Blob> {
  if (files.length === 0) throw new Error("No files to combine");

  let baseIndex: IndexJson | null = null;
  const allEntries: unknown[] = [];

  for (const file of files) {
    const zip = await JSZip.loadAsync(file);

    const indexFile = zip.file("index.json");
    if (!indexFile) throw new Error(`${file.name}: missing index.json`);
    if (!baseIndex) {
      baseIndex = JSON.parse(await indexFile.async("string")) as IndexJson;
    }

    const bankFiles = Object.keys(zip.files)
      .filter((name) => /^term_meta_bank_\d+\.json$/.test(name))
      .sort(byBankNumber);

    if (bankFiles.length === 0) {
      throw new Error(`${file.name}: no term_meta_bank_*.json found`);
    }

    for (const bankName of bankFiles) {
      const text = await zip.file(bankName)!.async("string");
      const entries = JSON.parse(text) as unknown[];
      for (const entry of entries) allEntries.push(entry);
    }
  }

  const outIndex: IndexJson = {
    ...baseIndex!,
    title,
    revision: `${title} ${new Date().toISOString().slice(0, 10)}`,
  };

  const out = new JSZip();
  out.file("index.json", JSON.stringify(outIndex));
  out.file("term_meta_bank_1.json", JSON.stringify(allEntries));

  return out.generateAsync({ type: "blob", compression: "DEFLATE" });
}

function byBankNumber(a: string, b: string): number {
  const num = (s: string) => Number(s.match(/_(\d+)\.json$/)![1]);
  return num(a) - num(b);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
