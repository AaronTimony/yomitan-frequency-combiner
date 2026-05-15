import { downloadBlob } from "./combiner";
import { MEDIA_TYPES, fetchDecks, fetchDeckYomitanZip, mediaTypeLabel } from "./jitenApi";
function deckTitleByLang(deck, lang) {
    switch (lang) {
        case "original": return deck.originalTitle || deck.romajiTitle || deck.englishTitle || `Deck ${deck.deckId}`;
        case "romaji": return deck.romajiTitle || deck.originalTitle || deck.englishTitle || `Deck ${deck.deckId}`;
        case "english": return deck.englishTitle || deck.romajiTitle || deck.originalTitle || `Deck ${deck.deckId}`;
    }
}
export function setupSearchPage(searchEl) {
    const addedDecks = [];
    const cardResets = new Map();
    searchEl.innerHTML = `
    <header class="text-center">
      <h1 class="text-4xl font-black tracking-tight">Search Decks</h1>
      <p class="mt-3 text-[rgba(230,250,252,0.85)] text-[1.15rem]">Find decks and add their Yomitan frequency dictionaries.</p>
    </header>
    <div class="flex gap-6 flex-1 min-h-0">
      <div class="flex flex-col gap-4 flex-1 min-w-0">
        <div class="flex items-stretch bg-[#3a3a3a] border border-[#5a5a5a] rounded-xl overflow-hidden">
          <div class="flex flex-col gap-2 px-3 py-2.5 flex-1">
            <span class="text-[#FB923C] text-[0.65rem] font-bold uppercase tracking-[0.12em]">Media Type</span>
            <div id="media-type-chips" class="flex flex-wrap gap-1.5"></div>
          </div>
          <div class="w-px bg-[#5a5a5a] shrink-0"></div>
          <div class="flex flex-col gap-2 px-3 py-2.5 shrink-0">
            <span class="text-[#FB923C] text-[0.65rem] font-bold uppercase tracking-[0.12em]">Title Language</span>
            <div id="title-lang-chips" class="flex gap-1.5"></div>
          </div>
        </div>
        <input id="jiten-search" type="text" placeholder="Search decks…"
          class="w-full bg-[#4a4a4a] border-2 border-[#5a5a5a] rounded-xl py-3 px-4 text-[#E6FAFC] text-[0.95rem] placeholder:text-[rgba(230,250,252,0.4)] outline-none focus:border-[#FB923C]/60 transition-colors duration-150" />
        <div id="deck-grid" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div class="col-span-full text-[rgba(230,250,252,0.6)] text-sm">Loading…</div>
        </div>
        <div id="pagination"></div>
      </div>
      <div style="flex: 0 0 22rem; min-width: 0;" class="sticky top-6 self-start max-h-[calc(100vh-3rem)] flex flex-col gap-3 overflow-hidden">
        <h2 class="text-[#FB923C] text-[0.7rem] font-bold uppercase tracking-[0.12em] shrink-0">Selected Decks</h2>
        <div id="added-panel" class="flex flex-col gap-2 overflow-y-auto flex-1 min-h-0 bg-[#2a2a2a]">
          <span class="text-[rgba(230,250,252,0.4)] text-sm">No decks selected.</span>
        </div>
        <div class="flex flex-col gap-2.5 border-t border-[#5a5a5a] pt-3 shrink-0">
          <div class="flex flex-col gap-1.5">
            <div class="flex items-baseline justify-between gap-2">
              <span id="total-words" class="text-2xl font-black text-[rgba(230,250,252,0.3)] transition-colors duration-300">0</span>
              <span class="text-[rgba(230,250,252,0.55)] text-sm shrink-0">Total Words</span>
            </div>
            <div class="relative h-1.5 bg-[#3a3a3a] rounded-full overflow-visible">
              <div id="progress-fill" class="h-full rounded-full transition-all duration-300 bg-[rgba(230,250,252,0.2)]" style="width:0%"></div>
              <div class="absolute top-1/2 -translate-y-1/2 w-px h-3 bg-[rgba(230,250,252,0.25)]" style="left:20%"></div>
            </div>
            <div class="flex justify-between text-xs text-[rgba(230,250,252,0.55)] font-medium">
              <span>Min. 1M</span>
              <span>Recommended 5M</span>
            </div>
          </div>
          <button id="merge-btn" disabled
            class="w-full py-3 border-0 rounded-2xl bg-gradient-to-b from-[#7deda4] to-[#1abc7e] text-white text-sm font-extrabold tracking-[0.01em] cursor-pointer shadow-[0_4px_15px_rgba(26,188,126,0.4)] transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none">
            Merge &amp; Download
          </button>
          <p id="merge-hint" class="text-xs text-[rgba(230,250,252,0.55)] text-center -mt-1">Add decks to reach the 1M word minimum.</p>
        </div>
      </div>
    </div>
  `;
    const grid = searchEl.querySelector("#deck-grid");
    const paginationEl = searchEl.querySelector("#pagination");
    const input = searchEl.querySelector("#jiten-search");
    const panel = searchEl.querySelector("#added-panel");
    const chipsEl = searchEl.querySelector("#media-type-chips");
    const titleLangChipsEl = searchEl.querySelector("#title-lang-chips");
    const mc = {
        totalWordsEl: searchEl.querySelector("#total-words"),
        progressFill: searchEl.querySelector("#progress-fill"),
        mergeBtn: searchEl.querySelector("#merge-btn"),
        mergeHint: searchEl.querySelector("#merge-hint"),
    };
    let currentQuery = "";
    let currentMediaType = undefined;
    let currentTitleLang = "original";
    let currentPage = 1;
    function goToPage(page, scroll = true) {
        currentPage = page;
        if (scroll)
            window.scrollTo({ top: 0, behavior: "smooth" });
        cardResets.clear();
        loadDecks(currentQuery, page, currentMediaType, currentTitleLang, grid, paginationEl, addedDecks, cardResets, panel, mc, goToPage);
    }
    buildMediaTypeChips(chipsEl, (mediaType) => {
        currentMediaType = mediaType;
        goToPage(1);
    });
    buildTitleLangChips(titleLangChipsEl, (lang) => {
        currentTitleLang = lang;
        syncPanel(panel, addedDecks, cardResets, mc, currentTitleLang);
        goToPage(currentPage, false);
    });
    goToPage(1, false);
    let debounce;
    input.addEventListener("input", () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
            currentQuery = input.value.trim();
            goToPage(1, false);
        }, 300);
    });
}
async function loadDecks(query, page, mediaType, titleLang, grid, paginationEl, addedDecks, cardResets, panel, mc, onPageChange) {
    grid.replaceChildren(...Array.from({ length: 10 }, makeSkeletonCard));
    paginationEl.replaceChildren();
    try {
        const result = await fetchDecks(query, page, mediaType);
        if (result.decks.length === 0 && page === 1) {
            grid.innerHTML = `<div class="col-span-full text-[rgba(230,250,252,0.6)] text-sm">No results.</div>`;
        }
        else {
            grid.replaceChildren(...result.decks.map((d) => makeDeckCard(d, addedDecks, cardResets, panel, mc, titleLang)));
        }
        paginationEl.replaceChildren(makePagination(page, result.hasMore, onPageChange));
    }
    catch (err) {
        grid.innerHTML = `<div class="col-span-full text-[#f87171] text-sm">${escapeHtml(String(err))}</div>`;
    }
}
function makeDeckCard(deck, addedDecks, cardResets, panel, mc, titleLang) {
    const title = deckTitleByLang(deck, titleLang);
    const card = document.createElement("div");
    card.className = [
        "group relative bg-[#4a4a4a] border-2 border-[#3a3a3a] rounded-xl overflow-hidden",
        "transition-all duration-200 hover:-translate-y-0.5",
        "hover:border-[#FB923C]/30 hover:shadow-[0_8px_24px_rgba(251,146,60,0.1)]",
    ].join(" ");
    const titleRow = document.createElement("div");
    titleRow.className = "px-3 py-2.5";
    const titleEl = document.createElement("h3");
    titleEl.className = "text-[#E6FAFC] font-bold text-xs truncate";
    titleEl.textContent = title;
    titleRow.append(titleEl);
    const imgWrap = document.createElement("div");
    imgWrap.className = "relative w-full aspect-[2/3] overflow-hidden bg-[#3a3a3a]";
    if (deck.coverName) {
        const img = document.createElement("img");
        img.src = deck.coverName;
        img.alt = title;
        img.loading = "lazy";
        img.className = "w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]";
        imgWrap.append(img);
    }
    else {
        const ph = document.createElement("div");
        ph.className = "w-full h-full flex items-center justify-center p-4";
        ph.innerHTML = `<span class="text-[#7deda4] font-black text-2xl text-center leading-tight">${escapeHtml(title)}</span>`;
        imgWrap.append(ph);
    }
    const overlay = document.createElement("div");
    overlay.className =
        "absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-all duration-200";
    const addBtn = document.createElement("button");
    const baseClasses = [
        "rounded-full w-[3.75rem] h-[3.75rem] flex items-center justify-center border-none",
        "opacity-0 group-hover:opacity-100 transition-all duration-200",
    ].join(" ");
    const greenClasses = "cursor-pointer bg-gradient-to-b from-[#7deda4] to-[#1abc7e] hover:from-[#8ff5b3] hover:to-[#1fd98d] shadow-[0_4px_15px_rgba(26,188,126,0.4)] hover:shadow-[0_4px_20px_rgba(26,188,126,0.6)]";
    const redClasses = "cursor-pointer bg-gradient-to-b from-[#fb7185] to-[#be123c] hover:from-[#f43f5e] hover:to-[#9f1239] shadow-[0_4px_15px_rgba(190,18,60,0.35)] hover:shadow-[0_4px_20px_rgba(190,18,60,0.5)]";
    function markAdded() {
        addBtn.className = `${baseClasses} ${redClasses}`;
        addBtn.innerHTML = minusIcon();
    }
    function markRemoved() {
        addBtn.className = `${baseClasses} ${greenClasses}`;
        addBtn.innerHTML = plusIcon();
    }
    if (addedDecks.some((d) => d.deckId === deck.deckId)) {
        markAdded();
    }
    else {
        markRemoved();
    }
    cardResets.set(deck.deckId, markRemoved);
    addBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (addedDecks.some((d) => d.deckId === deck.deckId)) {
            addedDecks.splice(addedDecks.findIndex((d) => d.deckId === deck.deckId), 1);
            markRemoved();
        }
        else {
            addedDecks.push(deck);
            markAdded();
        }
        syncPanel(panel, addedDecks, cardResets, mc, titleLang);
    });
    overlay.append(addBtn);
    imgWrap.append(overlay);
    const stats = document.createElement("div");
    stats.className = "grid grid-cols-3 divide-x divide-[#5a5a5a] border-t border-[#5a5a5a] bg-[#4a4a4a]";
    stats.append(statItem("Total", deck.wordCount.toLocaleString()), statItem("Unique", deck.uniqueWordCount.toLocaleString()), statItem("Type", mediaTypeLabel(deck.mediaType)));
    card.append(titleRow, imgWrap, stats);
    return card;
}
function statItem(label, value) {
    const el = document.createElement("div");
    el.className = "flex flex-col items-center justify-center py-2 px-1 min-w-0";
    el.innerHTML = `
    <span class="text-[#FB923C] text-[9px] font-bold tracking-wider mb-0.5 w-full text-center uppercase truncate">${escapeHtml(label)}</span>
    <span class="text-[#E6FAFC] text-xs font-black leading-none pb-0.5 w-full text-center truncate">${escapeHtml(value)}</span>
  `;
    return el;
}
const MIN_WORDS = 1000000;
const REC_WORDS = 5000000;
function syncPanel(panel, addedDecks, cardResets, mc, titleLang) {
    panel.replaceChildren();
    if (addedDecks.length === 0) {
        const empty = document.createElement("span");
        empty.className = "text-[rgba(230,250,252,0.4)] text-sm";
        empty.textContent = "No decks selected.";
        panel.append(empty);
    }
    else {
        for (const deck of addedDecks) {
            panel.append(makeAddedRow(deck, addedDecks, cardResets, panel, mc, titleLang));
        }
    }
    updateMergeControls(mc, addedDecks);
}
function updateMergeControls(mc, addedDecks) {
    const total = addedDecks.reduce((sum, d) => sum + d.wordCount, 0);
    const pct = Math.min(total / REC_WORDS, 1) * 100;
    mc.totalWordsEl.textContent = total.toLocaleString();
    let color;
    if (total === 0)
        color = "rgba(230,250,252,0.3)";
    else if (total < MIN_WORDS)
        color = "#f87171";
    else if (total < REC_WORDS)
        color = "#FB923C";
    else
        color = "#7deda4";
    mc.totalWordsEl.style.color = color;
    mc.progressFill.style.width = `${pct}%`;
    mc.progressFill.style.backgroundColor = total === 0 ? "rgba(230,250,252,0.15)" : color;
    mc.mergeBtn.disabled = total < MIN_WORDS;
    if (total === 0)
        mc.mergeHint.textContent = "Add decks to reach the 1M word minimum.";
    else if (total < MIN_WORDS)
        mc.mergeHint.textContent = `${(MIN_WORDS - total).toLocaleString()} more words needed to unlock.`;
    else if (total < REC_WORDS)
        mc.mergeHint.textContent = `Good — recommended is ${REC_WORDS.toLocaleString()} words.`;
    else
        mc.mergeHint.textContent = "Recommended word count reached!";
}
function makeAddedRow(deck, addedDecks, cardResets, panel, mc, titleLang) {
    const title = deckTitleByLang(deck, titleLang);
    const row = document.createElement("div");
    row.className = "flex items-center gap-2 bg-[#4a4a4a] border border-[#5a5a5a] rounded-xl px-3 py-2.5";
    if (deck.coverName) {
        const thumb = document.createElement("img");
        thumb.src = deck.coverName;
        thumb.alt = title;
        thumb.className = "w-8 h-12 object-cover rounded shrink-0";
        row.append(thumb);
    }
    const info = document.createElement("div");
    info.className = "flex flex-col gap-0.5 min-w-0 flex-1";
    info.innerHTML = `
    <span class="text-[#E6FAFC] text-xs font-bold truncate">${escapeHtml(title)}</span>
    <span class="text-[rgba(230,250,252,0.7)] text-xs">${escapeHtml(mediaTypeLabel(deck.mediaType))} · ${deck.wordCount.toLocaleString()} words</span>
  `;
    const dlBtn = document.createElement("button");
    dlBtn.className =
        "shrink-0 py-1.5 px-2.5 border-0 rounded-lg bg-gradient-to-b from-[#7deda4] to-[#1abc7e] text-white text-[0.75rem] font-bold cursor-pointer disabled:opacity-40";
    dlBtn.title = "Download Yomitan";
    dlBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13M5 15l7 7 7-7"/><line x1="3" y1="22" x2="21" y2="22"/></svg>`;
    dlBtn.addEventListener("click", () => downloadDeck(dlBtn, deck, title));
    const removeBtn = document.createElement("button");
    removeBtn.className =
        "shrink-0 w-6 h-6 flex items-center justify-center rounded-full border-0 bg-[#5a5a5a] hover:bg-[#be123c] cursor-pointer transition-colors duration-150";
    removeBtn.title = "Remove";
    removeBtn.innerHTML = `<svg width="10" height="2" viewBox="0 0 10 2" fill="none"><rect width="10" height="2" rx="1" fill="rgba(255,255,255,0.85)"/></svg>`;
    removeBtn.addEventListener("click", () => {
        addedDecks.splice(addedDecks.findIndex((d) => d.deckId === deck.deckId), 1);
        cardResets.get(deck.deckId)?.();
        syncPanel(panel, addedDecks, cardResets, mc, titleLang);
    });
    row.append(info, dlBtn, removeBtn);
    return row;
}
async function downloadDeck(btn, deck, title) {
    const prev = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" stroke-dasharray="56" stroke-dashoffset="14"/></svg>`;
    try {
        const blob = await fetchDeckYomitanZip(deck);
        downloadBlob(blob, `freq_${safeFilename(title)}.zip`);
    }
    catch (err) {
        alert(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    finally {
        btn.innerHTML = prev;
        btn.disabled = false;
    }
}
function makeSkeletonCard() {
    const card = document.createElement("div");
    card.className = "bg-[#4a4a4a] border-2 border-[#3a3a3a] rounded-2xl overflow-hidden animate-pulse";
    const titleBar = document.createElement("div");
    titleBar.className = "px-4 py-3 flex items-center gap-2";
    const titlePh = document.createElement("div");
    titlePh.className = "h-4 bg-[#5a5a5a] rounded-md flex-1";
    titleBar.append(titlePh);
    const imgPh = document.createElement("div");
    imgPh.className = "w-full aspect-[2/3] bg-[#3a3a3a]";
    const statsRow = document.createElement("div");
    statsRow.className = "grid grid-cols-3 divide-x divide-[#5a5a5a] border-t border-[#5a5a5a]";
    for (let i = 0; i < 3; i++) {
        const cell = document.createElement("div");
        cell.className = "flex flex-col items-center justify-center py-2 px-1 gap-1";
        const label = document.createElement("div");
        label.className = "h-2 w-8 bg-[#5a5a5a] rounded-sm";
        const value = document.createElement("div");
        value.className = "h-3 w-10 bg-[#5a5a5a] rounded-sm";
        cell.append(label, value);
        statsRow.append(cell);
    }
    card.append(titleBar, imgPh, statsRow);
    return card;
}
function buildMediaTypeChips(container, onSelect) {
    const allTypes = [
        { id: undefined, label: "All" },
        ...MEDIA_TYPES,
    ];
    for (const { id, label } of allTypes) {
        const btn = document.createElement("button");
        btn.dataset.mediaType = id !== undefined ? String(id) : "";
        btn.textContent = label;
        btn.className = chipClass(id === undefined);
        btn.addEventListener("click", () => {
            setActiveChip(container, "mediaType", id !== undefined ? String(id) : "");
            onSelect(id);
        });
        container.append(btn);
    }
}
function buildTitleLangChips(container, onSelect) {
    const langs = [
        { id: "original", label: "日本語" },
        { id: "romaji", label: "Romaji" },
        { id: "english", label: "English" },
    ];
    for (const { id, label } of langs) {
        const btn = document.createElement("button");
        btn.dataset.titleLang = id;
        btn.textContent = label;
        btn.className = chipClass(id === "original");
        btn.addEventListener("click", () => {
            setActiveChip(container, "titleLang", id);
            onSelect(id);
        });
        container.append(btn);
    }
}
function setActiveChip(container, dataKey, activeValue) {
    // dataset keys are camelCase but CSS attribute selectors need kebab-case (e.g. titleLang → title-lang)
    const attrName = dataKey.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    container.querySelectorAll(`button[data-${attrName}]`).forEach((btn) => {
        btn.className = chipClass((btn.dataset[dataKey] ?? "") === activeValue);
    });
}
function chipClass(active) {
    const base = "px-3 py-1 rounded-full text-sm font-semibold border-0 cursor-pointer transition-all duration-150 whitespace-nowrap";
    return active
        ? `${base} bg-[#FB923C] text-white shadow-[0_2px_10px_rgba(251,146,60,0.35)]`
        : `${base} bg-[#4a4a4a] text-[rgba(230,250,252,0.65)] hover:bg-[#5a5a5a] hover:text-[#E6FAFC]`;
}
function makePagination(curPage, hasMore, onPageChange) {
    const nav = document.createElement("div");
    nav.className = "flex items-center justify-center gap-3 py-6";
    let pages;
    if (curPage <= 3) {
        pages = Array.from({ length: curPage }, (_, i) => i + 1);
    }
    else {
        pages = [curPage - 2, curPage - 1, curPage];
    }
    if (curPage > 1) {
        const prev = document.createElement("button");
        prev.className =
            "px-5 py-2.5 rounded-full bg-[#4a4a4a] text-[rgba(230,250,252,0.7)] hover:bg-[#FB923C] hover:text-white transition-all font-semibold border-0 cursor-pointer";
        prev.textContent = "← Prev";
        prev.addEventListener("click", () => onPageChange(curPage - 1));
        nav.append(prev);
    }
    for (const page of pages) {
        const btn = document.createElement("button");
        const active = page === curPage;
        btn.className = [
            "w-11 h-11 rounded-full flex items-center justify-center font-bold transition-all border-0",
            active
                ? "bg-[#FB923C] text-white shadow-[0_4px_15px_rgba(251,146,60,0.4)] cursor-default"
                : "bg-[#4a4a4a] text-[rgba(230,250,252,0.7)] hover:bg-[#FB923C]/30 hover:text-[#E6FAFC] cursor-pointer",
        ].join(" ");
        btn.textContent = String(page);
        if (!active)
            btn.addEventListener("click", () => onPageChange(page));
        nav.append(btn);
    }
    if (hasMore) {
        const dots = document.createElement("span");
        dots.className = "text-[rgba(230,250,252,0.3)] font-bold";
        dots.textContent = "...";
        nav.append(dots);
        const next = document.createElement("button");
        next.className =
            "px-5 py-2.5 rounded-full bg-[#4a4a4a] text-[rgba(230,250,252,0.7)] hover:bg-[#FB923C] hover:text-white transition-all font-semibold border-0 cursor-pointer";
        next.textContent = "Next →";
        next.addEventListener("click", () => onPageChange(curPage + 1));
        nav.append(next);
    }
    return nav;
}
function plusIcon() {
    return `<svg width="26" height="26" viewBox="0 0 40 40" fill="none"><rect x="18" y="6" width="4" height="28" rx="2" fill="rgba(255,255,255,0.85)"/><rect x="6" y="18" width="28" height="4" rx="2" fill="rgba(255,255,255,0.85)"/></svg>`;
}
function minusIcon() {
    return `<svg width="26" height="26" viewBox="0 0 40 40" fill="none"><rect x="8" y="18" width="24" height="4" rx="2" fill="rgba(255,255,255,0.9)"/></svg>`;
}
function safeFilename(name) {
    return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "deck";
}
function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
