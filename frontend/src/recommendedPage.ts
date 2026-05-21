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

function setupGenreCart(): void {
  const mount = document.getElementById("genre-cart-mount");
  if (!mount) return;
  const scope = document.getElementById("page-recommended");
  if (!scope) return;

  const cart = document.createElement("div");
  cart.className = "flex flex-col gap-3 w-full min-h-0 flex-1";
  cart.innerHTML = `
    <div class="flex items-center justify-between shrink-0">
      <h2 class="text-[#FB923C] text-[0.7rem] font-bold uppercase tracking-[0.12em]">Selected Lists</h2>
      <button data-clear class="hidden text-xs text-[rgba(230,250,252,0.35)] hover:text-[#fb7185] font-semibold cursor-pointer border-0 bg-transparent p-0 transition-colors duration-150">Clear All</button>
    </div>
    <div data-cart-list class="genre-cart-list flex flex-col gap-2 overflow-y-auto flex-1 min-h-[6rem] pr-1">
      <span class="text-[rgba(230,250,252,0.4)] text-sm">No lists added yet.</span>
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
      <p data-status class="text-xs text-[rgba(230,250,252,0.55)] text-center -mt-0.5">Add at least 2 lists to merge.</p>
    </div>
  `;
  mount.append(cart);

  const cartList = cart.querySelector<HTMLElement>("[data-cart-list]")!;
  const totalWordsEl = cart.querySelector<HTMLElement>("[data-total-words]")!;
  const totalDecksEl = cart.querySelector<HTMLElement>("[data-total-decks]")!;
  const nameInput = cart.querySelector<HTMLInputElement>("[data-name]")!;
  const mergeBtn = cart.querySelector<HTMLButtonElement>("[data-merge]")!;
  const statusEl = cart.querySelector<HTMLElement>("[data-status]")!;
  const clearBtn = cart.querySelector<HTMLButtonElement>("[data-clear]")!;

  const entries = new Map<string, CartEntry>();

  function setRowAdded(row: HTMLElement, added: boolean): void {
    const zipUrl = row.dataset.zipUrl;
    if (!zipUrl) return;
    // Same genre appears in both the featured grid and the "Show All Genres"
    // list — update every row that points at this zip so their buttons stay
    // in sync regardless of which one the user interacted with.
    scope!.querySelectorAll<HTMLElement>(`[data-zip-url="${CSS.escape(zipUrl)}"]`).forEach((r) => {
      const btn = r.querySelector<HTMLButtonElement>("[data-add-genre]");
      if (!btn) return;
      btn.textContent = added ? "✓ Added" : "Add to list";
      btn.classList.toggle("border-[#1abc7e]", added);
      btn.classList.toggle("text-[#1abc7e]", added);
    });
  }

  function render(): void {
    cartList.innerHTML = "";
    if (entries.size === 0) {
      cartList.innerHTML = `<span class="text-[rgba(230,250,252,0.4)] text-sm">No lists added yet.</span>`;
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

    if (entries.size === 0) statusEl.textContent = "Add at least 2 lists to merge.";
    else if (entries.size === 1) statusEl.textContent = "Add 1 more list to merge.";
    else statusEl.textContent = `${entries.size} lists ready to merge.`;
  }

  scope.addEventListener("click", (ev) => {
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
        if (!res.ok) throw new Error(`HTTP ${res.status} — could not fetch ${selected[i].name} from ${DICT_BASE_URL}`);
        blobs.push(await res.blob());
      }

      statusEl.textContent = "Merging…";
      const name = nameInput.value.trim() || "Combined Frequency";
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

const ALL_GENRES = [
  "Action", "Adventure", "Comedy", "Drama", "Ecchi", "Fantasy",
  "Horror", "Mecha", "Music", "Mystery", "Psychological", "Romance",
  "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller", "Adult Only",
];

const MEDIA_TYPES: { id: string; label: string; fileLabel: string; prefix: string; genres?: readonly string[] }[] = [
  { id: "anime", label: "Anime", fileLabel: "Anime", prefix: "anime_dicts/" },
  { id: "manga", label: "Manga", fileLabel: "Manga", prefix: "manga_dicts/" },
  { id: "drama", label: "Drama", fileLabel: "Drama", prefix: "drama_dicts/", genres: ["Action", "Comedy", "Drama", "Mystery", "Sci-Fi"] },
  { id: "novel", label: "Novel", fileLabel: "Novel", prefix: "novel_dicts/" },
  { id: "videogame", label: "Video Game", fileLabel: "Video_Game", prefix: "videogame_dicts/", genres: ["Action", "Adventure", "Comedy", "Fantasy", "Mystery", "Sci-Fi", "Sports", "Thriller"] },
  { id: "visualnovel", label: "Visual Novel", fileLabel: "Visual_Novel", prefix: "visualnovel_dicts/", genres: ["Action", "Adult Only", "Comedy", "Drama", "Fantasy", "Horror", "Mecha", "Music", "Mystery", "Psychological", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Thriller"] },
];

const DICT_BASE_URL = "https://dicts.yomitanfrequencies.org";

function genreFileSlug(genre: string): string {
  return genre.replace(/\s+/g, "_");
}

function populateFeaturedGrids(): void {
  const mediaById = new Map(MEDIA_TYPES.map((m) => [m.id, m]));
  document.querySelectorAll<HTMLElement>("[data-featured-grid]").forEach((grid) => {
    const media = mediaById.get(grid.dataset.featuredGrid!);
    if (!media) return;
    const allowed = media.genres ? new Set(media.genres) : null;
    const genres = (grid.dataset.featuredGenres ?? "")
      .split(",")
      .map((g) => g.trim())
      .filter((g) => g && (!allowed || allowed.has(g)));
    grid.innerHTML = "";
    for (const genre of genres) {
      const baseName = `${genreFileSlug(genre)}_${media.fileLabel}_genre`;
      const sourcesUrl = `${DICT_BASE_URL}/${media.prefix}${baseName}_sources.json`;
      const zipUrl = `${DICT_BASE_URL}/${media.prefix}${baseName}.zip`;
      const downloadUrl = zipUrl;
      const displayName = `${genre} ${media.label}`;

      const card = document.createElement("div");
      card.className = "bg-[#3a3a3a] border border-[#5a5a5a] rounded-xl p-3 flex flex-col gap-2";
      card.dataset.genreUrl = sourcesUrl;
      card.dataset.zipUrl = zipUrl;
      card.innerHTML = `
        <span data-genre-name class="text-[#E6FAFC] text-sm font-semibold">${esc(displayName)}</span>
        <div class="flex gap-3 text-[0.65rem] text-[rgba(230,250,252,0.6)]">
          <span><span data-stat="words" class="text-[#E6FAFC] font-bold">…</span> words</span>
          <span><span data-stat="decks" class="text-[#E6FAFC] font-bold">…</span> decks</span>
        </div>
        <button data-add-genre disabled class="text-xs font-bold text-center px-2 py-1.5 rounded-lg bg-[#4a4a4a] border border-[#5a5a5a] text-[rgba(230,250,252,0.85)] cursor-pointer transition-all duration-150 hover:border-[rgba(251,146,60,0.6)] hover:text-[#FB923C] disabled:opacity-40 disabled:cursor-not-allowed">Add to list</button>
        <a href="${downloadUrl}" download class="text-xs font-bold text-center px-2 py-1.5 rounded-lg bg-gradient-to-b from-[#7deda4] to-[#1abc7e] text-white shadow-[0_2px_8px_rgba(26,188,126,0.35)] hover:shadow-[0_2px_12px_rgba(26,188,126,0.55)] transition-all duration-150 no-underline">Download</a>
      `;
      grid.append(card);
      loadGenreRow(card);
    }
  });
}

function populateAllGenresSections(): void {
  for (const media of MEDIA_TYPES) {
    const container = document.getElementById(`${media.id}-all-genres`);
    if (!container) continue;
    container.innerHTML = "";
    const genres = media.genres ?? ALL_GENRES;
    for (const genre of genres) {
      const baseName = `${genreFileSlug(genre)}_${media.fileLabel}_genre`;
      const sourcesUrl = `${DICT_BASE_URL}/${media.prefix}${baseName}_sources.json`;
      const zipUrl = `${DICT_BASE_URL}/${media.prefix}${baseName}.zip`;
      const downloadUrl = zipUrl;
      const displayName = `${genre} ${media.label}`;

      const row = document.createElement("div");
      row.className = "grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-6 px-4 py-3 rounded-xl bg-[#3a3a3a] border border-[#5a5a5a]";
      row.dataset.genreUrl = sourcesUrl;
      row.dataset.zipUrl = zipUrl;
      row.innerHTML = `
        <span data-genre-name class="text-[#E6FAFC] font-semibold text-sm">${esc(displayName)}</span>
        <div class="flex flex-col items-end gap-0.5">
          <span class="text-[#FB923C] text-[0.6rem] font-bold uppercase tracking-wider">Words</span>
          <span data-stat="words" class="text-[#E6FAFC] font-bold text-sm">…</span>
        </div>
        <div class="flex flex-col items-end gap-0.5">
          <span class="text-[#FB923C] text-[0.6rem] font-bold uppercase tracking-wider">Decks</span>
          <span data-stat="decks" class="text-[#E6FAFC] font-bold text-sm">…</span>
        </div>
        <a href="${downloadUrl}" download class="text-xs font-bold text-center px-4 py-1.5 rounded-lg bg-gradient-to-b from-[#7deda4] to-[#1abc7e] text-white shadow-[0_2px_8px_rgba(26,188,126,0.35)] hover:shadow-[0_2px_12px_rgba(26,188,126,0.55)] transition-all duration-150 no-underline">Download</a>
        <button data-add-genre disabled class="text-xs font-bold text-center px-4 py-1.5 rounded-lg bg-[#4a4a4a] border border-[#5a5a5a] text-[rgba(230,250,252,0.85)] cursor-pointer transition-all duration-150 hover:border-[rgba(251,146,60,0.6)] hover:text-[#FB923C] disabled:opacity-40 disabled:cursor-not-allowed">Add to list</button>
      `;
      container.append(row);
    }
  }
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
        if (label) label.textContent = "Show All Genres";
        chevron?.classList.remove("rotate-180");
      } else {
        list.classList.remove("hidden");
        list.classList.add("flex");
        if (label) label.textContent = "Hide Genres";
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
  populateAllGenresSections();
  populateFeaturedGrids();
  setupMediaDropdowns();
  setupGenreCart();
}
