import { downloadBlob } from "./combiner";
import { deckTitle, fetchDecks, fetchDeckYomitanZip, mediaTypeLabel, type JitenDeck } from "./jitenApi";

export function setupSearchPage(searchEl: HTMLElement): void {
  const addedDecks: JitenDeck[] = [];

  searchEl.innerHTML = `
    <header class="text-center">
      <h1 class="text-4xl font-black tracking-tight">Search Decks</h1>
      <p class="mt-3 text-[rgba(230,250,252,0.85)] text-[1.15rem]">Find decks and add their Yomitan frequency dictionaries.</p>
    </header>
    <div class="flex gap-6 flex-1 min-h-0">
      <div class="flex flex-col gap-4 flex-1 min-w-0">
        <input id="jiten-search" type="text" placeholder="Search decks…"
          class="w-full bg-[#4a4a4a] border-2 border-[#5a5a5a] rounded-xl py-3 px-4 text-[#E6FAFC] text-[0.95rem] placeholder:text-[rgba(230,250,252,0.4)] outline-none focus:border-[#FB923C]/60 transition-colors duration-150" />
        <div id="deck-grid" class="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
          <div class="col-span-full text-[rgba(230,250,252,0.6)] text-sm">Loading…</div>
        </div>
      </div>
      <div class="w-64 shrink-0 flex flex-col gap-3">
        <h2 class="text-[#FB923C] text-[0.7rem] font-bold uppercase tracking-[0.12em]">Selected Decks</h2>
        <div id="added-panel" class="flex flex-col gap-2">
          <span id="added-empty" class="text-[rgba(230,250,252,0.4)] text-sm">No decks selected.</span>
        </div>
      </div>
    </div>
  `;

  const grid = searchEl.querySelector<HTMLDivElement>("#deck-grid")!;
  const input = searchEl.querySelector<HTMLInputElement>("#jiten-search")!;
  const panel = searchEl.querySelector<HTMLDivElement>("#added-panel")!;

  loadDecks("", grid, addedDecks, panel);

  let debounce: ReturnType<typeof setTimeout>;
  input.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => loadDecks(input.value.trim(), grid, addedDecks, panel), 300);
  });
}

async function loadDecks(
  query: string,
  grid: HTMLElement,
  addedDecks: JitenDeck[],
  panel: HTMLElement,
): Promise<void> {
  grid.innerHTML = `<div class="col-span-full text-[rgba(230,250,252,0.6)] text-sm">Loading…</div>`;
  try {
    const decks = await fetchDecks(query, 10);
    renderGrid(grid, decks, addedDecks, panel);
  } catch (err) {
    grid.innerHTML = `<div class="col-span-full text-[#f87171] text-sm">${escapeHtml(String(err))}</div>`;
  }
}

function renderGrid(
  grid: HTMLElement,
  decks: JitenDeck[],
  addedDecks: JitenDeck[],
  panel: HTMLElement,
): void {
  if (decks.length === 0) {
    grid.innerHTML = `<div class="col-span-full text-[rgba(230,250,252,0.6)] text-sm">No results.</div>`;
    return;
  }
  grid.replaceChildren(...decks.map((d) => makeDeckCard(d, addedDecks, panel)));
}

function makeDeckCard(deck: JitenDeck, addedDecks: JitenDeck[], panel: HTMLElement): HTMLElement {
  const title = deckTitle(deck);

  const card = document.createElement("div");
  card.className = [
    "group relative bg-[#4a4a4a] border-2 border-[#3a3a3a] rounded-xl overflow-hidden",
    "transition-all duration-200 hover:-translate-y-0.5",
    "hover:border-[#FB923C]/30 hover:shadow-[0_8px_24px_rgba(251,146,60,0.1)]",
  ].join(" ");

  // Title strip
  const titleRow = document.createElement("div");
  titleRow.className = "px-3 py-2.5";
  const titleEl = document.createElement("h3");
  titleEl.className = "text-[#E6FAFC] font-bold text-xs truncate";
  titleEl.textContent = title;
  titleRow.append(titleEl);

  // Image + overlay
  const imgWrap = document.createElement("div");
  imgWrap.className = "relative w-full aspect-[2/3] overflow-hidden bg-[#3a3a3a]";

  if (deck.coverName) {
    const img = document.createElement("img");
    img.src = deck.coverName;
    img.alt = title;
    img.loading = "lazy";
    img.className = "w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]";
    imgWrap.append(img);
  } else {
    const ph = document.createElement("div");
    ph.className = "w-full h-full flex items-center justify-center p-4";
    ph.innerHTML = `<span class="text-[#7deda4] font-black text-2xl text-center leading-tight">${escapeHtml(title)}</span>`;
    imgWrap.append(ph);
  }

  const overlay = document.createElement("div");
  overlay.className = "absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-all duration-200";

  const addBtn = document.createElement("button");
  addBtn.className = [
    "rounded-full w-12 h-12 cursor-pointer flex items-center justify-center border-none",
    "opacity-0 group-hover:opacity-100 transition-all duration-200",
    "bg-gradient-to-b from-[#7deda4] to-[#1abc7e]",
    "hover:from-[#8ff5b3] hover:to-[#1fd98d]",
    "shadow-[0_4px_15px_rgba(26,188,126,0.4)] hover:shadow-[0_4px_20px_rgba(26,188,126,0.6)]",
  ].join(" ");
  addBtn.innerHTML = plusIcon();

  addBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (addedDecks.some((d) => d.deckId === deck.deckId)) return;
    addedDecks.push(deck);
    syncPanel(panel, addedDecks);
    // Switch to checkmark
    addBtn.innerHTML = checkIcon();
    addBtn.classList.replace("from-[#7deda4]", "from-[#6b7280]");
    addBtn.classList.replace("to-[#1abc7e]", "to-[#4b5563]");
    addBtn.classList.add("cursor-not-allowed");
  });

  overlay.append(addBtn);
  imgWrap.append(overlay);

  // Stats row
  const stats = document.createElement("div");
  stats.className = "grid grid-cols-3 divide-x divide-[#5a5a5a] border-t border-[#5a5a5a] bg-[#4a4a4a]";
  stats.append(
    statItem("Total", deck.wordCount.toLocaleString()),
    statItem("Unique", deck.uniqueWordCount.toLocaleString()),
    statItem("Type", mediaTypeLabel(deck.mediaType)),
  );

  card.append(titleRow, imgWrap, stats);
  return card;
}

function statItem(label: string, value: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "flex flex-col items-center justify-center py-2 px-1 min-w-0";
  el.innerHTML = `
    <span class="text-[#FB923C] text-[9px] font-bold tracking-wider mb-0.5 w-full text-center uppercase truncate">${escapeHtml(label)}</span>
    <span class="text-[#E6FAFC] text-xs font-black leading-none pb-0.5 w-full text-center truncate">${escapeHtml(value)}</span>
  `;
  return el;
}

function syncPanel(panel: HTMLElement, addedDecks: JitenDeck[]): void {
  panel.replaceChildren();
  if (addedDecks.length === 0) {
    const empty = document.createElement("span");
    empty.id = "added-empty";
    empty.className = "text-[rgba(230,250,252,0.4)] text-sm";
    empty.textContent = "No decks selected.";
    panel.append(empty);
    return;
  }
  for (const deck of addedDecks) {
    panel.append(makeAddedRow(deck, addedDecks, panel));
  }
}

function makeAddedRow(deck: JitenDeck, addedDecks: JitenDeck[], panel: HTMLElement): HTMLElement {
  const title = deckTitle(deck);

  const row = document.createElement("div");
  row.className = "flex items-center gap-2 bg-[#4a4a4a] border border-[#5a5a5a] rounded-xl px-3 py-2.5";

  // Thumbnail
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
    <span class="text-[rgba(230,250,252,0.5)] text-[10px]">${escapeHtml(mediaTypeLabel(deck.mediaType))}</span>
  `;

  const dlBtn = document.createElement("button");
  dlBtn.className = "shrink-0 py-1.5 px-2.5 border-0 rounded-lg bg-gradient-to-b from-[#7deda4] to-[#1abc7e] text-white text-[0.75rem] font-bold cursor-pointer disabled:opacity-40";
  dlBtn.title = "Download Yomitan";
  dlBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13M5 15l7 7 7-7"/><line x1="3" y1="22" x2="21" y2="22"/></svg>`;
  dlBtn.addEventListener("click", () => downloadDeck(dlBtn, deck, title));

  const removeBtn = document.createElement("button");
  removeBtn.className = "shrink-0 w-6 h-6 flex items-center justify-center rounded-full border-0 bg-[#5a5a5a] hover:bg-[#be123c] cursor-pointer transition-colors duration-150";
  removeBtn.title = "Remove";
  removeBtn.innerHTML = `<svg width="10" height="2" viewBox="0 0 10 2" fill="none"><rect width="10" height="2" rx="1" fill="rgba(255,255,255,0.85)"/></svg>`;
  removeBtn.addEventListener("click", () => {
    const idx = addedDecks.findIndex((d) => d.deckId === deck.deckId);
    if (idx !== -1) addedDecks.splice(idx, 1);
    syncPanel(panel, addedDecks);
  });

  row.append(info, dlBtn, removeBtn);
  return row;
}

async function downloadDeck(btn: HTMLButtonElement, deck: JitenDeck, title: string): Promise<void> {
  const prev = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="animate-spin"><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0"/></svg>`;
  try {
    const blob = await fetchDeckYomitanZip(deck);
    downloadBlob(blob, `freq_${safeFilename(title)}.zip`);
  } catch (err) {
    alert(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    btn.innerHTML = prev;
    btn.disabled = false;
  }
}

function plusIcon(): string {
  return `<svg width="20" height="20" viewBox="0 0 40 40" fill="none"><rect x="18" y="6" width="4" height="28" rx="2" fill="rgba(255,255,255,0.85)"/><rect x="6" y="18" width="28" height="4" rx="2" fill="rgba(255,255,255,0.85)"/></svg>`;
}

function checkIcon(): string {
  return `<svg width="22" height="22" viewBox="0 0 28 28" fill="none"><path d="M5 14.5L11 20.5L23 8" stroke="rgba(255,255,255,0.9)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "deck";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
