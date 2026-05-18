import { averageZips, downloadBlob } from "./combiner";

interface SourceEntry {
  title: string;
  wordCount: number;
}

interface SourcesJson {
  genre: string;
  totalWords: number;
  searched: number;
  matched: number;
  sources: SourceEntry[];
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "combined";
}

function renderSourcesList(panel: HTMLElement, data: SourcesJson): void {
  const list = document.createElement("div");
  list.className = "sources-list flex flex-col max-h-56 overflow-y-auto border-t border-[#5a5a5a] pt-2 pr-4";

  for (const entry of data.sources) {
    const row = document.createElement("div");
    row.className = "flex items-center justify-between py-1.5 text-xs border-b border-[rgba(90,90,90,0.4)] last:border-0";
    row.innerHTML = `
      <span class="text-[rgba(230,250,252,0.75)] truncate mr-4">${esc(entry.title)}</span>
      <span class="text-[rgba(230,250,252,0.35)] shrink-0">${entry.wordCount.toLocaleString()}</span>
    `;
    list.append(row);
  }

  panel.append(list);
}

async function attachSourcesPanel(article: HTMLElement): Promise<void> {
  const sourcesUrl = article.dataset.sourcesUrl!;
  const cacheKey = `sources-v1-${sourcesUrl}`;

  const statsEl = document.createElement("div");
  statsEl.className = "flex gap-6";
  statsEl.innerHTML = `<span class="text-[rgba(230,250,252,0.3)] text-xs">Loading…</span>`;

  const toggleBtn = document.createElement("button");
  toggleBtn.className = "self-start text-xs text-[rgba(230,250,252,0.4)] hover:text-[rgba(230,250,252,0.7)] font-semibold bg-transparent border-0 cursor-pointer p-0 transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed";
  toggleBtn.textContent = "▾ See all media";
  toggleBtn.disabled = true;

  const panel = document.createElement("div");
  panel.className = "hidden flex-col";

  article.append(statsEl, toggleBtn, panel);

  let data: SourcesJson;
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      data = JSON.parse(cached) as SourcesJson;
    } else {
      const res = await fetch(sourcesUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json() as SourcesJson;
      sessionStorage.setItem(cacheKey, JSON.stringify(data));
    }
  } catch {
    statsEl.innerHTML = `<span class="text-[rgba(230,250,252,0.25)] text-xs">Sources unavailable</span>`;
    return;
  }

  statsEl.innerHTML = `
    <div class="flex flex-col gap-0.5">
      <span class="text-[#FB923C] text-[0.65rem] font-bold uppercase tracking-wider">Words</span>
      <span class="text-[#E6FAFC] font-bold text-sm">${data.totalWords.toLocaleString()}</span>
    </div>
    <div class="flex flex-col gap-0.5">
      <span class="text-[#FB923C] text-[0.65rem] font-bold uppercase tracking-wider">Decks</span>
      <span class="text-[#E6FAFC] font-bold text-sm">${data.sources.length.toLocaleString()}</span>
    </div>
  `;

  toggleBtn.disabled = false;

  toggleBtn.addEventListener("click", () => {
    const isOpen = !panel.classList.contains("hidden");
    if (isOpen) {
      panel.classList.add("hidden");
      panel.classList.remove("flex");
      toggleBtn.textContent = "▾ See all media";
    } else {
      panel.classList.remove("hidden");
      panel.classList.add("flex");
      toggleBtn.textContent = "▴ Hide media";
      if (panel.children.length === 0) renderSourcesList(panel, data);
    }
  });
}

async function loadGenreRow(row: HTMLElement): Promise<void> {
  const sourcesUrl = row.dataset.genreUrl!;
  const cacheKey = `sources-v1-${sourcesUrl}`;
  const wordsEl = row.querySelector<HTMLElement>('[data-stat="words"]')!;
  const decksEl = row.querySelector<HTMLElement>('[data-stat="decks"]')!;
  const addBtn = row.querySelector<HTMLButtonElement>("[data-add-genre]");

  try {
    let data: SourcesJson;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      data = JSON.parse(cached) as SourcesJson;
    } else {
      const res = await fetch(sourcesUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json() as SourcesJson;
      sessionStorage.setItem(cacheKey, JSON.stringify(data));
    }
    wordsEl.textContent = data.totalWords.toLocaleString();
    decksEl.textContent = String(data.matched);
    row.dataset.words = String(data.totalWords);
    row.dataset.decks = String(data.matched);
    if (addBtn) addBtn.disabled = false;
  } catch {
    wordsEl.textContent = "—";
    decksEl.textContent = "—";
  }
}

interface CartEntry {
  zipUrl: string;
  name: string;
  words: number;
  decks: number;
  row: HTMLElement;
}

function setupGenreCart(listId: string): void {
  const list = document.getElementById(listId);
  if (!list) return;
  const rowsWrap = list.querySelector<HTMLElement>("#genre-rows");
  if (!rowsWrap) return;

  const cart = document.createElement("div");
  cart.style.flex = "0 0 20rem";
  cart.className = "flex flex-col gap-3 min-w-0 self-stretch";
  cart.innerHTML = `
    <div class="flex items-center justify-between shrink-0">
      <h2 class="text-[#FB923C] text-[0.7rem] font-bold uppercase tracking-[0.12em]">Selected Genres</h2>
      <button data-clear class="hidden text-xs text-[rgba(230,250,252,0.35)] hover:text-[#fb7185] font-semibold cursor-pointer border-0 bg-transparent p-0 transition-colors duration-150">Clear All</button>
    </div>
    <div data-cart-list class="genre-cart-list flex flex-col gap-2 overflow-y-auto flex-1 min-h-[6rem] max-h-72 pr-1">
      <span class="text-[rgba(230,250,252,0.4)] text-sm">No genres added yet.</span>
    </div>
    <div class="flex flex-col gap-2.5 border-t border-[#5a5a5a] pt-3 shrink-0">
      <div class="flex items-stretch gap-2">
        <div class="flex flex-col gap-0.5 flex-1">
          <span class="text-[#FB923C] text-[0.6rem] font-bold uppercase tracking-wider">Total Words</span>
          <span data-total-words class="text-[#E6FAFC] font-black text-lg">0</span>
        </div>
        <div class="flex flex-col gap-0.5 flex-1">
          <span class="text-[#FB923C] text-[0.6rem] font-bold uppercase tracking-wider">Total Decks</span>
          <span data-total-decks class="text-[#E6FAFC] font-black text-lg">0</span>
        </div>
      </div>
      <input data-name type="text" placeholder="Dictionary name…" maxlength="80"
        class="w-full bg-[#3a3a3a] border border-[#5a5a5a] rounded-xl py-2 px-3 text-[#E6FAFC] text-sm placeholder:text-[rgba(230,250,252,0.3)] outline-none focus:border-[#1abc7e]/60 transition-colors duration-150" />
      <button data-merge disabled
        class="w-full py-3 border-0 rounded-2xl bg-gradient-to-b from-[#7deda4] to-[#1abc7e] text-white text-sm font-extrabold tracking-[0.01em] cursor-pointer shadow-[0_4px_15px_rgba(26,188,126,0.4)] transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none">
        Merge &amp; Download
      </button>
      <p data-status class="text-xs text-[rgba(230,250,252,0.55)] text-center -mt-0.5">Add at least 2 genres to merge.</p>
    </div>
  `;
  list.append(cart);

  const cartList = cart.querySelector<HTMLElement>("[data-cart-list]")!;
  const totalWordsEl = cart.querySelector<HTMLElement>("[data-total-words]")!;
  const totalDecksEl = cart.querySelector<HTMLElement>("[data-total-decks]")!;
  const nameInput = cart.querySelector<HTMLInputElement>("[data-name]")!;
  const mergeBtn = cart.querySelector<HTMLButtonElement>("[data-merge]")!;
  const statusEl = cart.querySelector<HTMLElement>("[data-status]")!;
  const clearBtn = cart.querySelector<HTMLButtonElement>("[data-clear]")!;

  const entries = new Map<string, CartEntry>();

  function setRowAdded(row: HTMLElement, added: boolean): void {
    const btn = row.querySelector<HTMLButtonElement>("[data-add-genre]");
    if (!btn) return;
    btn.textContent = added ? "✓ Added" : "Add to list";
    btn.classList.toggle("border-[#1abc7e]", added);
    btn.classList.toggle("text-[#1abc7e]", added);
  }

  function render(): void {
    cartList.innerHTML = "";
    if (entries.size === 0) {
      cartList.innerHTML = `<span class="text-[rgba(230,250,252,0.4)] text-sm">No genres added yet.</span>`;
    } else {
      for (const [key, e] of entries) {
        const item = document.createElement("div");
        item.className = "flex items-center justify-between gap-2 bg-[#3a3a3a] border border-[#5a5a5a] rounded-xl px-3 py-2";
        item.innerHTML = `
          <div class="flex flex-col min-w-0">
            <span class="text-[#E6FAFC] font-semibold text-sm truncate">${esc(e.name)}</span>
            <span class="text-[rgba(230,250,252,0.5)] text-xs">${e.words.toLocaleString()} words · ${e.decks.toLocaleString()} decks</span>
          </div>
          <button data-remove class="shrink-0 text-[rgba(230,250,252,0.35)] hover:text-[#fb7185] text-lg leading-none bg-transparent border-0 cursor-pointer transition-colors duration-150" aria-label="Remove ${esc(e.name)}">×</button>
        `;
        item.querySelector("[data-remove]")!.addEventListener("click", () => {
          setRowAdded(e.row, false);
          entries.delete(key);
          render();
        });
        cartList.append(item);
      }
    }

    let totalWords = 0;
    let totalDecks = 0;
    for (const e of entries.values()) {
      totalWords += e.words;
      totalDecks += e.decks;
    }
    totalWordsEl.textContent = totalWords.toLocaleString();
    totalDecksEl.textContent = totalDecks.toLocaleString();
    clearBtn.classList.toggle("hidden", entries.size === 0);
    mergeBtn.disabled = entries.size < 2;

    if (entries.size === 0) statusEl.textContent = "Add at least 2 genres to merge.";
    else if (entries.size === 1) statusEl.textContent = "Add 1 more genre to merge.";
    else statusEl.textContent = `${entries.size} genres ready to merge.`;
  }

  rowsWrap.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-add-genre]");
    if (!btn || btn.disabled) return;
    const row = btn.closest<HTMLElement>("[data-zip-url]");
    if (!row) return;

    const key = row.dataset.zipUrl!;
    if (entries.has(key)) {
      entries.delete(key);
      setRowAdded(row, false);
    } else {
      entries.set(key, {
        zipUrl: key,
        name: row.querySelector<HTMLElement>("[data-genre-name]")?.textContent?.trim() ?? "Genre",
        words: Number(row.dataset.words ?? "0"),
        decks: Number(row.dataset.decks ?? "0"),
        row,
      });
      setRowAdded(row, true);
    }
    render();
  });

  clearBtn.addEventListener("click", () => {
    for (const e of entries.values()) setRowAdded(e.row, false);
    entries.clear();
    render();
  });

  mergeBtn.addEventListener("click", async () => {
    if (entries.size < 2) return;
    const selected = [...entries.values()];

    mergeBtn.disabled = true;
    try {
      const blobs: Blob[] = [];
      for (let i = 0; i < selected.length; i++) {
        statusEl.textContent = `Downloading ${i + 1}/${selected.length}: ${selected[i].name}…`;
        const res = await fetch(selected[i].zipUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status} — is ${selected[i].name} in /dicts/?`);
        blobs.push(await res.blob());
      }

      statusEl.textContent = "Merging…";
      const name = nameInput.value.trim() || "Combined Anime Frequency";
      const files = blobs.map((blob, i) => new File([blob], `dict_${i}.zip`));
      const result = await averageZips(files, name);
      downloadBlob(result, `${safeFilename(name)}.zip`);
      statusEl.textContent = "Done! Downloaded.";
    } catch (err) {
      statusEl.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      mergeBtn.disabled = entries.size < 2;
    }
  });

  render();
}

function setupMediaDropdowns(): void {
  document.querySelectorAll<HTMLElement>("[data-media-toggle]").forEach((btn) => {
    const listId = btn.dataset.mediaToggle!;
    const list = document.getElementById(listId);
    if (!list) return;

    const label = btn.querySelector<HTMLElement>("[data-toggle-label]");
    const chevron = btn.querySelector<HTMLElement>("[data-toggle-chevron]");

    btn.addEventListener("click", () => {
      const isOpen = !list.classList.contains("hidden");
      if (isOpen) {
        list.classList.add("hidden");
        list.classList.remove("flex");
        if (label) label.textContent = "Browse genres";
        chevron?.classList.remove("rotate-180");
      } else {
        list.classList.remove("hidden");
        list.classList.add("flex");
        if (label) label.textContent = "Hide genres";
        chevron?.classList.add("rotate-180");
        list.querySelectorAll<HTMLElement>("[data-genre-url]").forEach((row) => {
          if (!row.dataset.loaded) {
            row.dataset.loaded = "true";
            loadGenreRow(row);
          }
        });
      }
    });
  });
}

export function setupRecommendedPage(): void {
  document.querySelectorAll<HTMLElement>("article[data-sources-url]").forEach(attachSourcesPanel);
  setupMediaDropdowns();
  setupGenreCart("anime-genre-list");
}
