import { downloadBlob } from "./combiner";
import { deckTitle, fetchDeckYomitanZip, fetchDecks, mediaTypeLabel } from "./jitenApi";
// Renders the first 10 Jiten decks into #page-search, each with a button that
// downloads its Yomitan frequency dictionary. UI is intentionally minimal —
// this is the functional wiring, not the final design.
export function setupSearchPage(searchEl) {
    searchEl.innerHTML = `
    <header class="text-center">
      <h1 class="text-4xl font-black tracking-tight">Jiten Decks</h1>
      <p class="mt-3 text-[rgba(230,250,252,0.85)] text-[1.15rem]">First 10 decks from the Jiten API with Yomitan frequency dictionary downloads.</p>
    </header>
    <ul id="deck-list" class="list-none flex flex-col gap-2 max-w-[600px] mx-auto w-full">
      <li class="text-[rgba(230,250,252,0.6)]">Loading decks…</li>
    </ul>
  `;
    const list = searchEl.querySelector("#deck-list");
    fetchDecks(10)
        .then((decks) => renderDecks(list, decks))
        .catch((err) => {
        list.innerHTML = `<li class="text-[#f87171]">Failed to load decks: ${escapeHtml(err instanceof Error ? err.message : String(err))}</li>`;
    });
}
function renderDecks(list, decks) {
    if (decks.length === 0) {
        list.innerHTML = `<li class="text-[rgba(230,250,252,0.6)]">No decks returned.</li>`;
        return;
    }
    list.replaceChildren();
    for (const deck of decks) {
        const title = deckTitle(deck);
        const li = document.createElement("li");
        li.className =
            "flex items-center justify-between gap-3 bg-[#4a4a4a] border-2 border-[#5a5a5a] rounded-xl py-3 px-3.5";
        const info = document.createElement("div");
        info.className = "flex flex-col gap-0.5 min-w-0";
        const name = document.createElement("span");
        name.className = "text-[#E6FAFC] text-[0.95rem] font-medium truncate";
        name.textContent = title;
        const meta = document.createElement("span");
        meta.className = "text-[rgba(230,250,252,0.5)] text-[0.8rem]";
        meta.textContent = `${mediaTypeLabel(deck.mediaType)} · ${deck.wordCount.toLocaleString()} words · ${deck.uniqueWordCount.toLocaleString()} unique`;
        info.append(name, meta);
        const btn = document.createElement("button");
        btn.className =
            "shrink-0 py-2 px-3.5 border-0 rounded-lg bg-gradient-to-b from-[#7deda4] to-[#1abc7e] text-white text-[0.85rem] font-bold cursor-pointer transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed";
        btn.textContent = "Download Yomitan";
        btn.addEventListener("click", () => downloadDeck(btn, deck, title));
        li.append(info, btn);
        list.append(li);
    }
}
async function downloadDeck(btn, deck, title) {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Downloading…";
    try {
        const blob = await fetchDeckYomitanZip(deck);
        downloadBlob(blob, `freq_${safeFilename(title)}.zip`);
    }
    catch (err) {
        console.error(err);
        alert(`Failed to download: ${err instanceof Error ? err.message : String(err)}`);
    }
    finally {
        btn.textContent = original;
        btn.disabled = false;
    }
}
function safeFilename(name) {
    return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "deck";
}
function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
}
