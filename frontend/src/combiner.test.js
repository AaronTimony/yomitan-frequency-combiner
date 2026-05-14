import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { entryKey, parseKey, parseRawEntry, readFrequencies, averageZips, combineZips } from "./combiner";
async function makeZipFile(entries, title = "Test") {
    const zip = new JSZip();
    zip.file("index.json", JSON.stringify({ title, format: 3, revision: `${title} test`, frequencyMode: "rank-based" }));
    zip.file("term_meta_bank_1.json", JSON.stringify(entries));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    return new File([bytes], `${title}.zip`, { type: "application/zip" });
}
async function readOutputBank(blob) {
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    return JSON.parse(await zip.file("term_meta_bank_1.json").async("string"));
}
function readingEntry(bank, expression, reading, wantsMarker) {
    return bank.find((e) => {
        if (e[0] !== expression)
            return false;
        const d = e[2];
        if (!("reading" in d) || d.reading !== reading)
            return false;
        return d.frequency.displayValue.includes("㋕") === wantsMarker;
    });
}
function kanaEntry(bank, expression) {
    return bank.find((e) => e[0] === expression && !("reading" in e[2]));
}
// ---------------------------------------------------------------------------
// entryKey
// ---------------------------------------------------------------------------
describe("entryKey", () => {
    it("returns just the expression for standalone kana entries", () => {
        expect(entryKey("はる", null, false)).toBe("はる");
        expect(entryKey("はる", null, true)).toBe("はる");
    });
    it("returns expression tab reading for kanji entries without the kana marker", () => {
        expect(entryKey("春", "はる", false)).toBe("春\tはる");
    });
    it("appends tab ㋕ for kanji entries with the kana marker", () => {
        expect(entryKey("春", "はる", true)).toBe("春\tはる\t㋕");
    });
    it("produces different keys for the same expression and reading depending on the marker", () => {
        expect(entryKey("春", "はる", false)).not.toBe(entryKey("春", "はる", true));
    });
});
// ---------------------------------------------------------------------------
// parseKey
// ---------------------------------------------------------------------------
describe("parseKey", () => {
    it("parses a standalone kana key", () => {
        expect(parseKey("はる")).toEqual({ expression: "はる", reading: null, hasMarker: false });
    });
    it("parses a kanji key without the kana marker", () => {
        expect(parseKey("春\tはる")).toEqual({ expression: "春", reading: "はる", hasMarker: false });
    });
    it("parses a kanji key with the kana marker", () => {
        expect(parseKey("春\tはる\t㋕")).toEqual({ expression: "春", reading: "はる", hasMarker: true });
    });
    it("round-trips through entryKey", () => {
        expect(parseKey(entryKey("春", "はる", false))).toEqual({ expression: "春", reading: "はる", hasMarker: false });
        expect(parseKey(entryKey("春", "はる", true))).toEqual({ expression: "春", reading: "はる", hasMarker: true });
        expect(parseKey(entryKey("はる", null, true))).toEqual({ expression: "はる", reading: null, hasMarker: false });
    });
});
// ---------------------------------------------------------------------------
// parseRawEntry
// ---------------------------------------------------------------------------
describe("parseRawEntry", () => {
    it("parses a standalone kana entry", () => {
        const result = parseRawEntry("はる", { value: 7762, displayValue: "7762㋕" });
        expect(result.key).toBe("はる");
        expect(result.expression).toBe("はる");
        expect(result.reading).toBeNull();
        expect(result.value).toBe(7762);
        expect(result.hasMarker).toBe(true);
    });
    it("parses a kanji-rank entry (no ㋕)", () => {
        const result = parseRawEntry("春", { reading: "はる", frequency: { value: 2228, displayValue: "2228" } });
        expect(result.key).toBe("春\tはる");
        expect(result.expression).toBe("春");
        expect(result.reading).toBe("はる");
        expect(result.value).toBe(2228);
        expect(result.hasMarker).toBe(false);
    });
    it("parses a kana-rank entry (with ㋕)", () => {
        const result = parseRawEntry("春", { reading: "はる", frequency: { value: 9977, displayValue: "9977㋕" } });
        expect(result.key).toBe("春\tはる\t㋕");
        expect(result.expression).toBe("春");
        expect(result.reading).toBe("はる");
        expect(result.value).toBe(9977);
        expect(result.hasMarker).toBe(true);
    });
    it("gives different keys for kanji-rank and kana-rank entries with the same expression and reading", () => {
        const kanjiRank = parseRawEntry("春", { reading: "はる", frequency: { value: 2228, displayValue: "2228" } });
        const kanaRank = parseRawEntry("春", { reading: "はる", frequency: { value: 9977, displayValue: "9977㋕" } });
        expect(kanjiRank.key).not.toBe(kanaRank.key);
    });
});
// ---------------------------------------------------------------------------
// readFrequencies
// ---------------------------------------------------------------------------
describe("readFrequencies – entry keying", () => {
    it("keeps kanji-rank and kana-rank entries as two separate entries", async () => {
        const file = await makeZipFile([
            ["春", "freq", { reading: "はる", frequency: { value: 2228, displayValue: "2228" } }],
            ["春", "freq", { reading: "はる", frequency: { value: 9977, displayValue: "9977㋕" } }],
        ]);
        const data = await readFrequencies([file]);
        expect(data.entries.size).toBe(2);
        expect(data.entries.get("春\tはる").freqs[0]).toBe(2228);
        expect(data.entries.get("春\tはる\t㋕").freqs[0]).toBe(9977);
    });
    it("keys standalone kana entries by expression only", async () => {
        const file = await makeZipFile([
            ["はる", "freq", { value: 7762, displayValue: "7762㋕" }],
        ]);
        const data = await readFrequencies([file]);
        expect(data.entries.size).toBe(1);
        const entry = data.entries.get("はる");
        expect(entry.reading).toBeNull();
        expect(entry.freqs[0]).toBe(7762);
    });
    it("treats different readings of the same kanji as separate entries", async () => {
        const file = await makeZipFile([
            ["春", "freq", { reading: "はる", frequency: { value: 2228, displayValue: "2228" } }],
            ["春", "freq", { reading: "あずま", frequency: { value: 47110, displayValue: "47110" } }],
        ]);
        const data = await readFrequencies([file]);
        expect(data.entries.size).toBe(2);
        expect(data.entries.has("春\tはる")).toBe(true);
        expect(data.entries.has("春\tあずま")).toBe(true);
    });
});
describe("readFrequencies – multi-dict merging", () => {
    it("records values from both dicts in the freqs array", async () => {
        const file1 = await makeZipFile([["春", "freq", { reading: "はる", frequency: { value: 1000, displayValue: "1000" } }]], "Dict1");
        const file2 = await makeZipFile([["春", "freq", { reading: "はる", frequency: { value: 3000, displayValue: "3000" } }]], "Dict2");
        const data = await readFrequencies([file1, file2]);
        expect(data.entries.get("春\tはる").freqs).toEqual([1000, 3000]);
    });
    it("fills null for dicts that don't have a given entry", async () => {
        const file1 = await makeZipFile([["夏", "freq", { reading: "なつ", frequency: { value: 500, displayValue: "500" } }]], "Dict1");
        const file2 = await makeZipFile([["春", "freq", { reading: "はる", frequency: { value: 1000, displayValue: "1000" } }]], "Dict2");
        const data = await readFrequencies([file1, file2]);
        expect(data.entries.get("夏\tなつ").freqs).toEqual([500, null]);
        expect(data.entries.get("春\tはる").freqs).toEqual([null, 1000]);
    });
    it("keeps kana-rank and kanji-rank entries separate across dicts", async () => {
        const file1 = await makeZipFile([
            ["春", "freq", { reading: "はる", frequency: { value: 2000, displayValue: "2000" } }],
            ["春", "freq", { reading: "はる", frequency: { value: 8000, displayValue: "8000㋕" } }],
        ], "Dict1");
        const file2 = await makeZipFile([
            ["春", "freq", { reading: "はる", frequency: { value: 4000, displayValue: "4000" } }],
        ], "Dict2");
        const data = await readFrequencies([file1, file2]);
        expect(data.entries.get("春\tはる").freqs).toEqual([2000, 4000]);
        expect(data.entries.get("春\tはる\t㋕").freqs).toEqual([8000, null]);
    });
});
// ---------------------------------------------------------------------------
// averageZips
// ---------------------------------------------------------------------------
describe("averageZips – output format", () => {
    it("outputs kanji-rank entry without ㋕", async () => {
        const file = await makeZipFile([["春", "freq", { reading: "はる", frequency: { value: 2228, displayValue: "2228" } }]]);
        const bank = await readOutputBank(await averageZips([file], "Out"));
        const entry = readingEntry(bank, "春", "はる", false);
        expect(entry).toBeDefined();
        expect(entry[2].frequency.displayValue).toBe("2228");
    });
    it("outputs kana-rank entry with ㋕", async () => {
        const file = await makeZipFile([["春", "freq", { reading: "はる", frequency: { value: 9977, displayValue: "9977㋕" } }]]);
        const bank = await readOutputBank(await averageZips([file], "Out"));
        const entry = readingEntry(bank, "春", "はる", true);
        expect(entry).toBeDefined();
        expect(entry[2].frequency.displayValue).toBe("9977㋕");
    });
    it("outputs both kanji-rank and kana-rank entries from the same source dict", async () => {
        const file = await makeZipFile([
            ["春", "freq", { reading: "はる", frequency: { value: 2228, displayValue: "2228" } }],
            ["春", "freq", { reading: "はる", frequency: { value: 9977, displayValue: "9977㋕" } }],
        ]);
        const bank = await readOutputBank(await averageZips([file], "Out"));
        expect(readingEntry(bank, "春", "はる", false)).toBeDefined();
        expect(readingEntry(bank, "春", "はる", true)).toBeDefined();
    });
    it("outputs standalone kana entries with ㋕", async () => {
        const file = await makeZipFile([["はる", "freq", { value: 7762, displayValue: "7762㋕" }]]);
        const bank = await readOutputBank(await averageZips([file], "Out"));
        const entry = kanaEntry(bank, "はる");
        expect(entry[2].displayValue).toBe("7762㋕");
    });
    it("averages values across two dicts and rounds to nearest integer", async () => {
        const file1 = await makeZipFile([["春", "freq", { reading: "はる", frequency: { value: 1000, displayValue: "1000" } }]], "Dict1");
        const file2 = await makeZipFile([["春", "freq", { reading: "はる", frequency: { value: 3001, displayValue: "3001" } }]], "Dict2");
        const bank = await readOutputBank(await averageZips([file1, file2], "Out"));
        // avg(1000, 3001) = 2000.5 → rounds to 2001
        const entry = readingEntry(bank, "春", "はる", false);
        expect(entry[2].frequency.value).toBe(2001);
    });
    it("passes through the value unchanged when an entry is only in one dict", async () => {
        const file1 = await makeZipFile([["夏", "freq", { reading: "なつ", frequency: { value: 500, displayValue: "500" } }]], "Dict1");
        const file2 = await makeZipFile([["春", "freq", { reading: "はる", frequency: { value: 1000, displayValue: "1000" } }]], "Dict2");
        const bank = await readOutputBank(await averageZips([file1, file2], "Out"));
        expect(readingEntry(bank, "夏", "なつ", false)[2].frequency.value).toBe(500);
        expect(readingEntry(bank, "春", "はる", false)[2].frequency.value).toBe(1000);
    });
    it("averages kanji-rank and kana-rank entries independently", async () => {
        const file1 = await makeZipFile([
            ["春", "freq", { reading: "はる", frequency: { value: 2000, displayValue: "2000" } }],
            ["春", "freq", { reading: "はる", frequency: { value: 8000, displayValue: "8000㋕" } }],
        ], "Dict1");
        const file2 = await makeZipFile([
            ["春", "freq", { reading: "はる", frequency: { value: 4000, displayValue: "4000" } }],
        ], "Dict2");
        const bank = await readOutputBank(await averageZips([file1, file2], "Out"));
        // kanji-rank: avg(2000, 4000) = 3000
        expect(readingEntry(bank, "春", "はる", false)[2].frequency.value).toBe(3000);
        // kana-rank: only in Dict1, passes through as 8000
        expect(readingEntry(bank, "春", "はる", true)[2].frequency.value).toBe(8000);
    });
    it("sets the output index title", async () => {
        const file = await makeZipFile([["春", "freq", { reading: "はる", frequency: { value: 1000, displayValue: "1000" } }]]);
        const blob = await averageZips([file], "My Combined Dict");
        const zip = await JSZip.loadAsync(await blob.arrayBuffer());
        const index = JSON.parse(await zip.file("index.json").async("string"));
        expect(index.title).toBe("My Combined Dict");
    });
});
// ---------------------------------------------------------------------------
// combineZips
// ---------------------------------------------------------------------------
describe("combineZips – raw concatenation", () => {
    it("includes all entries from all dicts", async () => {
        const file1 = await makeZipFile([["春", "freq", { reading: "はる", frequency: { value: 1000, displayValue: "1000" } }]], "Dict1");
        const file2 = await makeZipFile([["夏", "freq", { reading: "なつ", frequency: { value: 2000, displayValue: "2000" } }]], "Dict2");
        const bank = await readOutputBank(await combineZips([file1, file2], "Combined"));
        expect(bank.length).toBe(2);
        expect(readingEntry(bank, "春", "はる", false)).toBeDefined();
        expect(readingEntry(bank, "夏", "なつ", false)).toBeDefined();
    });
    it("includes duplicate entries when the same word appears in multiple dicts", async () => {
        const file1 = await makeZipFile([["春", "freq", { reading: "はる", frequency: { value: 1000, displayValue: "1000" } }]], "Dict1");
        const file2 = await makeZipFile([["春", "freq", { reading: "はる", frequency: { value: 3000, displayValue: "3000" } }]], "Dict2");
        const bank = await readOutputBank(await combineZips([file1, file2], "Combined"));
        expect(bank.length).toBe(2);
        const values = bank.map((e) => e[2].frequency.value);
        expect(values).toContain(1000);
        expect(values).toContain(3000);
    });
});
