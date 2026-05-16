import JSZip from "jszip";
// Key format for kanji entries without kana marker: "expression\treading"
// Key format for kanji entries with kana marker (㋕):  "expression\treading\t㋕"
// Key format for standalone kana entries:              "expression"
// The ㋕ suffix distinguishes kanji-rank from kana-rank entries for the same expression+reading pair.
export function entryKey(expression, reading, hasMarker) {
    if (reading === null)
        return expression;
    return hasMarker ? `${expression}\t${reading}\t㋕` : `${expression}\t${reading}`;
}
export function parseKey(key) {
    const parts = key.split("\t");
    if (parts.length === 1)
        return { expression: parts[0], reading: null, hasMarker: false };
    if (parts.length === 3 && parts[2] === "㋕")
        return { expression: parts[0], reading: parts[1], hasMarker: true };
    return { expression: parts[0], reading: parts[1], hasMarker: false };
}
export function parseRawEntry(term, data) {
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
export async function readFrequencies(files) {
    if (files.length === 0)
        throw new Error("No files provided");
    const dictTitles = [];
    const perDictMaps = [];
    let baseIndex = null;
    for (const file of files) {
        const zip = await JSZip.loadAsync(file);
        const indexFile = zip.file("index.json");
        if (!indexFile)
            throw new Error(`${file.name}: missing index.json`);
        const index = JSON.parse(await indexFile.async("string"));
        if (!baseIndex)
            baseIndex = index;
        dictTitles.push(index.title);
        const bankFiles = Object.keys(zip.files)
            .filter((name) => /^term_meta_bank_\d+\.json$/.test(name))
            .sort(byBankNumber);
        if (bankFiles.length === 0)
            throw new Error(`${file.name}: no term_meta_bank_*.json found`);
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
    const numDicts = files.length;
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
    return { dictTitles, baseIndex: baseIndex, entries };
}
export function logFrequencySample(data, sampleSize = 8) {
    const { dictTitles, entries } = data;
    const sample = [...entries.values()]
        .filter((e) => e.freqs.filter((f) => f !== null).length >= 2)
        .slice(0, sampleSize);
    console.log("=== Frequency sample (entries present in ≥2 dicts) ===");
    console.log(["form".padEnd(20), ...dictTitles.map((t) => t.slice(0, 18).padEnd(20)), "avg"].join(" | "));
    for (const entry of sample) {
        const form = entry.reading
            ? `${entry.expression}(${entry.reading})`
            : entry.expression;
        const defined = entry.freqs.filter((f) => f !== null);
        const avg = (defined.reduce((a, b) => a + b, 0) / defined.length).toFixed(1);
        const cols = entry.freqs.map((f) => (f === null ? "—" : String(f)).padEnd(20));
        console.log([form.padEnd(20), ...cols, avg].join(" | "));
    }
}
function pushOut(outEntries, term, data, sequence) {
    if (sequence !== null) {
        outEntries.push([term, "freq", data, sequence]);
    }
    else {
        outEntries.push([term, "freq", data]);
    }
}
function buildSummedAndRankedEntries(data) {
    const summed = [...data.entries].map(([, entry]) => ({
        entry,
        sum: entry.freqs.reduce((acc, f) => acc + (f ?? 0), 0),
    }));
    summed.sort((a, b) => b.sum - a.sum);
    const outEntries = [];
    for (let i = 0; i < summed.length; i++) {
        const rank = i + 1;
        const { entry } = summed[i];
        if (entry.reading !== null) {
            pushOut(outEntries, entry.expression, { reading: entry.reading, frequency: { value: rank, displayValue: entry.hasMarker ? `${rank}㋕` : String(rank) } }, entry.sequence);
        }
        else {
            pushOut(outEntries, entry.expression, { value: rank, displayValue: `${rank}㋕` }, entry.sequence);
        }
    }
    return outEntries;
}
export async function mergeJitenDecks(files, title) {
    if (files.length === 0)
        throw new Error("No files to merge");
    const data = await readFrequencies(files);
    const outEntries = buildSummedAndRankedEntries(data);
    const outIndex = {
        ...data.baseIndex,
        title,
        revision: `${title} ${new Date().toISOString().slice(0, 10)}`,
    };
    const out = new JSZip();
    out.file("index.json", JSON.stringify(outIndex));
    out.file("term_meta_bank_1.json", JSON.stringify(outEntries));
    return out.generateAsync({ type: "blob", compression: "DEFLATE" });
}
function buildAveragedEntries(data) {
    const outEntries = [];
    for (const entry of data.entries.values()) {
        const defined = entry.freqs.filter((f) => f !== null);
        if (defined.length === 0)
            continue;
        const avg = Math.round(defined.reduce((a, b) => a + b, 0) / defined.length);
        if (entry.reading !== null) {
            pushOut(outEntries, entry.expression, { reading: entry.reading, frequency: { value: avg, displayValue: entry.hasMarker ? `${avg}㋕` : String(avg) } }, entry.sequence);
        }
        else {
            pushOut(outEntries, entry.expression, { value: avg, displayValue: `${avg}㋕` }, entry.sequence);
        }
    }
    outEntries.sort((a, b) => {
        const val = (e) => {
            const d = e[2];
            return "reading" in d ? d.frequency.value : d.value;
        };
        return val(a) - val(b);
    });
    return outEntries;
}
export async function previewAveraged(files) {
    if (files.length === 0)
        throw new Error("No files provided");
    const data = await readFrequencies(files);
    const entries = buildAveragedEntries(data);
    const rows = entries.map((e) => JSON.stringify(e)).join(",\n");
    downloadBlob(new Blob([`[\n${rows}\n]`], { type: "application/json" }), "preview.json");
}
export async function previewTermBank(files) {
    if (files.length === 0)
        throw new Error("No files provided");
    const allEntries = [];
    for (const file of files) {
        const zip = await JSZip.loadAsync(file);
        const bankFiles = Object.keys(zip.files)
            .filter((name) => /^term_bank_\d+\.json$/.test(name))
            .sort(byBankNumber);
        for (const name of bankFiles) {
            const entries = JSON.parse(await zip.file(name).async("string"));
            for (const e of entries)
                allEntries.push(e);
        }
    }
    if (allEntries.length === 0) {
        alert("No term_bank_*.json files found in the selected zips.");
        return;
    }
    const rows = allEntries.map((e) => JSON.stringify(e)).join(",\n");
    downloadBlob(new Blob([`[\n${rows}\n]`], { type: "application/json" }), "term_bank_preview.json");
}
const isMetaBank = (name) => /^term_meta_bank_\d+\.json$/.test(name);
export async function averageZips(files, title) {
    if (files.length === 0)
        throw new Error("No files to average");
    const data = await readFrequencies(files);
    logFrequencySample(data);
    const out = new JSZip();
    // Copy every non-index, non-meta-bank file from every input zip.
    // First occurrence of a given filename wins (avoids conflicts while keeping all content).
    const seen = new Set();
    for (const file of files) {
        const zip = await JSZip.loadAsync(file);
        for (const [name, entry] of Object.entries(zip.files)) {
            if (entry.dir)
                continue;
            if (name === "index.json")
                continue;
            if (isMetaBank(name))
                continue;
            if (seen.has(name))
                continue;
            seen.add(name);
            out.file(name, await entry.async("uint8array"));
        }
    }
    // Replace frequency data with our averaged version
    const outEntries = buildAveragedEntries(data);
    const outIndex = {
        ...data.baseIndex,
        title,
        revision: `${title} ${new Date().toISOString().slice(0, 10)}`,
    };
    out.file("index.json", JSON.stringify(outIndex));
    out.file("term_meta_bank_1.json", JSON.stringify(outEntries));
    return out.generateAsync({ type: "blob", compression: "DEFLATE" });
}
export async function combineZips(files, title) {
    if (files.length === 0)
        throw new Error("No files to combine");
    let baseIndex = null;
    const allEntries = [];
    for (const file of files) {
        const zip = await JSZip.loadAsync(file);
        const indexFile = zip.file("index.json");
        if (!indexFile)
            throw new Error(`${file.name}: missing index.json`);
        if (!baseIndex) {
            baseIndex = JSON.parse(await indexFile.async("string"));
        }
        const bankFiles = Object.keys(zip.files)
            .filter((name) => /^term_meta_bank_\d+\.json$/.test(name))
            .sort(byBankNumber);
        if (bankFiles.length === 0) {
            throw new Error(`${file.name}: no term_meta_bank_*.json found`);
        }
        for (const bankName of bankFiles) {
            const text = await zip.file(bankName).async("string");
            const entries = JSON.parse(text);
            for (const entry of entries)
                allEntries.push(entry);
        }
    }
    const outIndex = {
        ...baseIndex,
        title,
        revision: `${title} ${new Date().toISOString().slice(0, 10)}`,
    };
    const out = new JSZip();
    out.file("index.json", JSON.stringify(outIndex));
    out.file("term_meta_bank_1.json", JSON.stringify(allEntries));
    return out.generateAsync({ type: "blob", compression: "DEFLATE" });
}
function byBankNumber(a, b) {
    const num = (s) => Number(s.match(/_(\d+)\.json$/)[1]);
    return num(a) - num(b);
}
export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}
