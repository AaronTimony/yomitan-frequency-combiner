import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import JSZip from "jszip";
import { setupRecommendedPage } from "./recommendedPage";

async function makeFreqZipBytes(title: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("index.json", JSON.stringify({ title, format: 3, revision: `${title} test`, frequencyMode: "rank-based" }));
  zip.file("term_meta_bank_1.json", JSON.stringify([
    ["春", "freq", { reading: "はる", frequency: { value: 1, displayValue: "1" } }],
  ]));
  return zip.generateAsync({ type: "uint8array" });
}

async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("Dictionaries cart merge — fetch options", () => {
  let createObjectURLSpy: ReturnType<typeof vi.fn>;
  let originalCreate: typeof URL.createObjectURL;
  let originalRevoke: typeof URL.revokeObjectURL;

  beforeEach(() => {
    // jsdom doesn't implement CSS.escape — recommendedPage.ts uses it to build
    // an attribute selector. Polyfill with a minimal version sufficient for
    // the URLs in the test (the spec algorithm would be overkill here).
    if (!(globalThis as { CSS?: { escape?: unknown } }).CSS?.escape) {
      (globalThis as { CSS: { escape: (s: string) => string } }).CSS = {
        escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`),
      };
    }

    document.body.innerHTML = `
      <section id="page-dictionaries">
        <article class="rec-article">
          <div>
            <h3>Anime</h3>
            <a href="https://dicts.example.org/overall_dicts/jiten_freq_Anime.zip" download>Download</a>
          </div>
        </article>
        <article class="rec-article">
          <div>
            <h3>Manga</h3>
            <a href="https://dicts.example.org/overall_dicts/jiten_freq_Manga.zip" download>Download</a>
          </div>
        </article>
        <aside id="genre-cart-mount"></aside>
      </section>
    `;
    originalCreate = URL.createObjectURL;
    originalRevoke = URL.revokeObjectURL;
    createObjectURLSpy = vi.fn(() => "blob:test");
    URL.createObjectURL = createObjectURLSpy as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    vi.unstubAllGlobals();
  });

  // Regression guard: the merge button must bypass the browser's HTTP cache.
  // If a user previously clicked the plain "Download" anchor for one of these
  // zips, the browser cached that no-Origin response without CORS headers;
  // a subsequent default-cache fetch() of the same URL is served from that
  // cached entry and gets blocked by CORS. cache: "no-store" forces the
  // request to bypass the local cache and go to the network, where the
  // origin returns the proper CORS headers.
  it("fetches each selected zip with cache: 'no-store'", async () => {
    const animeBytes = await makeFreqZipBytes("Anime");
    const mangaBytes = await makeFreqZipBytes("Manga");

    const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const u = String(url);
      const body = u.includes("Anime") ? animeBytes : mangaBytes;
      // Return a fresh copy each call — body.slice() so consumption doesn't
      // affect the next call.
      return new Response(body.slice().buffer, { status: 200, headers: { "content-type": "application/zip" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    setupRecommendedPage();

    const addBtns = document.querySelectorAll<HTMLButtonElement>("[data-add-media]");
    expect(addBtns).toHaveLength(2);
    addBtns[0].click();
    addBtns[1].click();

    const mergeBtn = document.querySelector<HTMLButtonElement>("[data-merge]")!;
    expect(mergeBtn.disabled).toBe(false);
    mergeBtn.click();

    // Wait for the merge to finish (downloadBlob → URL.createObjectURL).
    await waitFor(() => createObjectURLSpy.mock.calls.length === 1);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({ cache: "no-store" });
    }
  });
});
