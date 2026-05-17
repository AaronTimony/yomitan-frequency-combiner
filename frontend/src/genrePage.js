import { fetchDecks, deckTitle, fetchDeckYomitanZip } from "./jitenApi";
import { mergeJitenDecks, downloadBlob } from "./combiner";
const ANILIST_QUERY = `
query ($genre: String, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(genre: $genre, type: ANIME, format: TV, status_in: [FINISHED, RELEASING], sort: POPULARITY_DESC) {
      id
      title { romaji english native }
    }
  }
}
`;
// Persists across navigations so a paused run can be resumed
let savedState = null;
async function fetchAniListPage(genre, page, attempt = 0) {
    try {
        const res = await fetch("https://graphql.anilist.co", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: ANILIST_QUERY, variables: { genre, page } }),
        });
        if (res.status === 429) {
            if (attempt >= 5)
                throw new Error("AniList rate limit — too many retries");
            const retryAfter = Number(res.headers.get("Retry-After") ?? 60);
            await sleep(retryAfter * 1000);
            return fetchAniListPage(genre, page, attempt + 1);
        }
        if (!res.ok)
            throw new Error(`AniList HTTP ${res.status}`);
        const json = await res.json();
        const p = json.data.Page;
        return { media: p.media, hasNextPage: p.pageInfo.hasNextPage };
    }
    catch (err) {
        // Retry TypeError: Failed to fetch (network blip, CORS timeout, etc.)
        if (err instanceof TypeError && attempt < 5) {
            await sleep(2000 * (attempt + 1));
            return fetchAniListPage(genre, page, attempt + 1);
        }
        throw err;
    }
}
async function searchJiten(title, attempt = 0) {
    try {
        const { decks } = await fetchDecks(title, 1, 1 /* Anime */);
        return decks[0] ?? null;
    }
    catch {
        if (attempt >= 4)
            return null;
        await sleep(3000 * (attempt + 1));
        return searchJiten(title, attempt + 1);
    }
}
async function downloadWithRetry(deck, attempt = 0) {
    try {
        return await fetchDeckYomitanZip(deck);
    }
    catch (err) {
        if (attempt >= 3)
            throw err;
        await sleep(2000 * (attempt + 1));
        return downloadWithRetry(deck, attempt + 1);
    }
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function safeFilename(name) {
    return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "genre";
}
function makeMatchRow(m) {
    const row = document.createElement("div");
    row.className = "grid grid-cols-2 gap-4 px-4 py-3 rounded-xl bg-[#4a4a4a] border border-[#5a5a5a] text-sm";
    row.innerHTML = `
    <div>
      <div class="font-semibold text-[#E6FAFC]">${esc(m.anilistDisplay)}</div>
      <div class="text-[rgba(230,250,252,0.4)] text-xs mt-0.5">${esc(m.anilistRomaji)}</div>
    </div>
    <div class="flex items-center gap-2">
      <span class="text-[#1abc7e] font-bold shrink-0">✓</span>
      <div>
        <div class="text-[#E6FAFC]">${esc(deckTitle(m.deck))}</div>
        <div class="text-[rgba(230,250,252,0.4)] text-xs">${m.deck.wordCount.toLocaleString()} words</div>
      </div>
    </div>
  `;
    return row;
}
function renderResultsHeader(results) {
    results.innerHTML = `
    <div class="grid grid-cols-2 gap-4 px-4 py-2 text-xs font-bold uppercase tracking-widest text-[rgba(230,250,252,0.4)]">
      <span>AniList title</span><span>Jiten match</span>
    </div>
  `;
}
export function setupGenrePage(section) {
    section.innerHTML = `
    <header class="text-center">
      <h1 class="text-4xl font-black tracking-tight">Genre Search</h1>
      <p class="mt-3 text-[rgba(230,250,252,0.85)] text-[1.15rem]">Find anime by genre and build a frequency dictionary.</p>
    </header>
    <div class="flex gap-3 max-w-[500px] mx-auto w-full">
      <div class="flex-1 bg-[#4a4a4a] border-2 border-[#5a5a5a] rounded-xl overflow-hidden transition-colors duration-150">
        <input id="genre-input" type="text" value="Slice of Life" placeholder="Genre (e.g. Slice of Life)"
          class="w-full bg-transparent border-0 outline-none text-[#E6FAFC] text-[0.95rem] font-medium py-3 px-3.5 placeholder:text-[rgba(230,250,252,0.4)]" />
      </div>
      <button id="genre-run-btn" class="shrink-0 px-7 py-3 rounded-xl bg-gradient-to-b from-[#7deda4] to-[#1abc7e] text-white font-extrabold shadow-[0_4px_15px_rgba(26,188,126,0.4)] transition-all duration-200 hover:shadow-[0_4px_20px_rgba(26,188,126,0.6)]">
        Run
      </button>
      <button id="genre-resume-btn" class="hidden shrink-0 px-5 py-3 rounded-xl bg-[#4a4a4a] border border-[#5a5a5a] text-[#E6FAFC] font-bold transition-all duration-200 hover:bg-[#5a5a5a]">
        Resume
      </button>
    </div>
    <div id="genre-status" class="hidden text-center text-sm text-[rgba(230,250,252,0.5)]"></div>
    <div id="genre-summary" class="hidden text-center flex flex-col gap-2">
      <p id="genre-summary-match" class="text-[#E6FAFC] font-bold text-lg"></p>
      <p id="genre-summary-words" class="text-[rgba(230,250,252,0.6)] text-sm"></p>
      <div class="flex flex-col gap-2 max-w-[400px] mx-auto w-full mt-1">
        <input id="genre-dict-title" type="text" placeholder="Dictionary name…" maxlength="80"
          class="w-full bg-[#3a3a3a] border border-[#5a5a5a] rounded-xl py-2 px-3 text-[#E6FAFC] text-sm placeholder:text-[rgba(230,250,252,0.3)] outline-none focus:border-[#FB923C]/60 transition-colors duration-150" />
        <button id="genre-merge-btn"
          class="w-full py-3 border-0 rounded-2xl bg-gradient-to-b from-[#7deda4] to-[#1abc7e] text-white text-sm font-extrabold tracking-[0.01em] cursor-pointer shadow-[0_4px_15px_rgba(26,188,126,0.4)] transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none">
          Merge &amp; Download
        </button>
      </div>
    </div>
    <div id="genre-results" class="flex flex-col gap-2 max-w-[860px] mx-auto w-full"></div>
  `;
    const input = document.getElementById("genre-input");
    const btn = document.getElementById("genre-run-btn");
    const resumeBtn = document.getElementById("genre-resume-btn");
    const statusEl = document.getElementById("genre-status");
    const summary = document.getElementById("genre-summary");
    const summaryMatch = document.getElementById("genre-summary-match");
    const summaryWords = document.getElementById("genre-summary-words");
    const results = document.getElementById("genre-results");
    const mergeBtn = document.getElementById("genre-merge-btn");
    const dictTitleInput = document.getElementById("genre-dict-title");
    // Restore state if the user navigated away and came back
    if (savedState) {
        input.value = savedState.genre;
        renderResultsHeader(results);
        for (const m of savedState.matched)
            results.appendChild(makeMatchRow(m));
        if (savedState.matched.length > 0) {
            statusEl.classList.remove("hidden");
            summary.classList.remove("hidden");
            if (savedState.paused) {
                statusEl.textContent = "Paused — click Resume to continue from where it stopped";
                summaryMatch.textContent = `${savedState.matched.length} matched so far (paused at ${savedState.jitenDone} searched)`;
                resumeBtn.classList.remove("hidden");
            }
            else {
                statusEl.textContent = "Done";
                summaryMatch.textContent = `${savedState.matched.length} / ${savedState.jitenDone} titles matched`;
            }
            summaryWords.textContent = `${savedState.totalWords.toLocaleString()} total words across matched decks`;
        }
    }
    mergeBtn.addEventListener("click", async () => {
        if (!savedState || savedState.matched.length === 0)
            return;
        const genre = savedState.genre;
        const title = dictTitleInput.value.trim() || `${genre} Frequency`;
        mergeBtn.disabled = true;
        const decks = savedState.matched.map((m) => m.deck);
        try {
            const blobs = [];
            for (let i = 0; i < decks.length; i++) {
                mergeBtn.textContent = `Downloading ${i + 1} / ${decks.length}…`;
                blobs.push(await downloadWithRetry(decks[i]));
                if (i < decks.length - 1)
                    await sleep(500);
            }
            mergeBtn.textContent = "Merging…";
            const files = blobs.map((blob, i) => new File([blob], `deck_${decks[i].deckId}.zip`));
            const sources = savedState.matched.map((m) => ({
                title: m.anilistDisplay,
                wordCount: m.deck.wordCount,
            }));
            const blob = await mergeJitenDecks(files, title, sources);
            downloadBlob(blob, `${safeFilename(title)}.zip`);
            const sourcesJson = JSON.stringify({
                genre: savedState.genre,
                totalWords: savedState.totalWords,
                searched: savedState.jitenDone,
                matched: savedState.matched.length,
                sources,
            }, null, 2);
            downloadBlob(new Blob([sourcesJson], { type: "application/json" }), `${safeFilename(title)}_sources.json`);
        }
        catch (err) {
            alert(`Merge failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        finally {
            mergeBtn.textContent = "Merge & Download";
            mergeBtn.disabled = false;
        }
    });
    btn.addEventListener("click", () => startRun(false));
    resumeBtn.addEventListener("click", () => startRun(true));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter")
        startRun(false); });
    async function startRun(resume) {
        const genre = input.value.trim();
        if (!genre)
            return;
        let state;
        if (resume && savedState && savedState.genre === genre) {
            state = savedState;
            state.paused = false;
        }
        else {
            state = { genre, matched: [], nextAniPage: 1, jitenDone: 0, totalWords: 0, paused: false };
            savedState = state;
            renderResultsHeader(results);
        }
        btn.disabled = true;
        input.disabled = true;
        resumeBtn.classList.add("hidden");
        statusEl.classList.remove("hidden");
        summary.classList.add("hidden");
        try {
            let hasNextPage = true;
            while (hasNextPage) {
                statusEl.textContent = `Fetching AniList page ${state.nextAniPage}…`;
                const page = await fetchAniListPage(genre, state.nextAniPage);
                hasNextPage = page.hasNextPage;
                state.nextAniPage++;
                for (const anime of page.media) {
                    const searchTitle = anime.title.romaji ?? anime.title.english ?? "";
                    state.jitenDone++;
                    statusEl.textContent = `Searched ${state.jitenDone} · ${state.matched.length} matched…`;
                    const match = await searchJiten(searchTitle);
                    if (match) {
                        const m = {
                            anilistDisplay: anime.title.english ?? anime.title.romaji ?? "Unknown",
                            anilistRomaji: anime.title.romaji ?? "",
                            deck: match,
                        };
                        state.matched.push(m);
                        state.totalWords += match.wordCount;
                        results.appendChild(makeMatchRow(m));
                    }
                    await sleep(200);
                }
            }
            statusEl.textContent = "Done";
            state.paused = false;
            summary.classList.remove("hidden");
            summaryMatch.textContent = `${state.matched.length} / ${state.jitenDone} titles matched`;
            summaryWords.textContent = `${state.totalWords.toLocaleString()} total words across matched decks`;
        }
        catch (err) {
            state.paused = true;
            statusEl.textContent = `Paused — ${err}`;
            resumeBtn.classList.remove("hidden");
            console.error(err);
            if (state.matched.length > 0) {
                summary.classList.remove("hidden");
                summaryMatch.textContent = `${state.matched.length} matched so far (paused at ${state.jitenDone} searched)`;
                summaryWords.textContent = `${state.totalWords.toLocaleString()} total words`;
            }
        }
        btn.disabled = false;
        input.disabled = false;
    }
}
