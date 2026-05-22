import { downloadBlob, downloadRenamedZip, mergeJitenDecks, type MergeMode } from "./combiner";
import { promptMergeMode } from "./searchPage";

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

    const sourcesEl = row.querySelector<HTMLElement>("[data-sources]");
    if (sourcesEl && data.sources.length > 0) {
      const sorted = [...data.sources].sort((a, b) => b.wordCount - a.wordCount);
      const PREVIEW = 50;
      const renderItem = (s: SourceEntry): string =>
        `<li class="flex justify-between gap-3" title="${esc(s.title)}"><span class="truncate">${esc(s.title)}</span><span class="shrink-0 text-[rgba(230,250,252,0.6)] tabular-nums">${s.wordCount.toLocaleString()}</span></li>`;
      const previewItems = sorted.slice(0, PREVIEW).map(renderItem).join("");
      const restItems = sorted.slice(PREVIEW).map(renderItem).join("");
      const remaining = sorted.length - PREVIEW;
      // Featured-grid cards sit in a 5-col grid — if the expanded panel grew
      // them inline the whole row would jump. For those, float the panel as a
      // popover so the card's own height stays constant. All-genres rows
      // expand inline (no neighbouring cells to disturb).
      const inFeaturedGrid = row.closest("[data-featured-grid]") !== null;
      const panelClass = inFeaturedGrid
        ? "absolute top-full left-0 right-0 z-20 mt-1 bg-[#3a3a3a] border border-[#5a5a5a] rounded-lg p-2 shadow-lg"
        : "mt-1.5";
      sourcesEl.innerHTML = `
        <details class="text-xs ${inFeaturedGrid ? "relative" : ""}">
          <summary class="cursor-pointer text-[rgba(230,250,252,0.7)] hover:text-[#FB923C] select-none w-fit">Sources (${sorted.length})</summary>
          <div class="${panelClass}">
            <ul data-sources-list class="sources-list max-h-60 overflow-y-auto flex flex-col gap-0.5 text-[rgba(230,250,252,0.85)] pl-1 pr-3">${previewItems}</ul>
            ${remaining > 0 ? `<button data-show-all-sources type="button" class="mt-1.5 text-[rgba(230,250,252,0.7)] hover:text-[#FB923C] cursor-pointer bg-transparent border-0 p-0 font-semibold">Show ${remaining} more…</button>` : ""}
          </div>
        </details>
      `;
      if (remaining > 0) {
        const btn = sourcesEl.querySelector<HTMLButtonElement>("[data-show-all-sources]")!;
        const list = sourcesEl.querySelector<HTMLElement>("[data-sources-list]")!;
        btn.addEventListener("click", () => {
          list.insertAdjacentHTML("beforeend", restItems);
          btn.remove();
        });
      }
    }
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
  isMedia?: boolean;
}

function applyAddedStyle(btn: HTMLButtonElement, added: boolean): void {
  btn.textContent = added ? "✓ Added" : "Add to list";
  // Default = solid orange. Added = orange ghost (transparent bg, orange text)
  // so the swap is the same hue — no jarring green/orange flip.
  // The border-[#FB923C] in the base classes stays on in both states.
  btn.classList.toggle("bg-[#FB923C]", !added);
  btn.classList.toggle("text-white", !added);
  btn.classList.toggle("hover:bg-[#FBB36F]", !added);
  btn.classList.toggle("hover:border-[#FBB36F]", !added);
  btn.classList.toggle("bg-transparent", added);
  btn.classList.toggle("text-[#FB923C]", added);
}

function toggleMediaAdded(article: HTMLElement, added: boolean): void {
  article.toggleAttribute("data-media-added", added);
  // Keep the header (children[0]) visible — title, description, Download and
  // the Add to list pill. Hide everything below: featured 5-genre grid and
  // the Show All Genres section. Once the full media is in the cart, the
  // per-genre breakdown is redundant.
  const children = Array.from(article.children) as HTMLElement[];
  for (let i = 1; i < children.length; i++) {
    children[i].hidden = added;
  }
}

function setupGenreCart(): void {
  const mount = document.getElementById("genre-cart-mount");
  if (!mount) return;
  const scope = document.getElementById("page-dictionaries");
  if (!scope) return;

  const cart = document.createElement("div");
  cart.className = "flex flex-col gap-3 w-full min-h-0 flex-1";
  cart.innerHTML = `
    <div class="flex items-center justify-between shrink-0">
      <h2 class="text-[#FB923C] text-[0.7rem] font-bold">Selected Dictionaries</h2>
      <button data-clear class="hidden text-xs text-[rgba(230,250,252,0.35)] hover:text-[#fb7185] font-semibold cursor-pointer border-0 bg-transparent p-0 transition-colors duration-150">Clear All</button>
    </div>
    <div data-cart-list class="genre-cart-list flex flex-col gap-2 overflow-y-auto flex-1 min-h-[6rem] pr-1">
      <span class="text-[rgba(230,250,252,0.85)] text-sm">No dictionaries added yet.</span>
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
        class="w-full bg-[#3a3a3a] border border-[#5a5a5a] rounded-xl py-2 px-3 text-[#E6FAFC] text-sm placeholder:text-[rgba(230,250,252,0.3)] outline-none focus:border-[#FB923C]/60 transition-colors duration-150" />
      <button data-merge disabled
        class="w-full py-3 border-0 rounded-2xl bg-gradient-to-b from-[#7deda4] to-[#1abc7e] hover:from-[#8ff5b3] hover:to-[#1fd98d] text-white text-sm font-extrabold tracking-[0.01em] cursor-pointer shadow-[0_4px_15px_rgba(26,188,126,0.4)] hover:shadow-[0_4px_20px_rgba(26,188,126,0.6)] transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none">
        Merge &amp; Download
      </button>
      <p data-status class="text-sm text-[rgba(230,250,252,0.85)] text-center -mt-0.5">Add at least 2 dictionaries to merge.</p>
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
      // Media-level articles have [data-add-media]; per-genre rows have
      // [data-add-genre]. Prefer media so the article's own pill is updated
      // even though it also contains nested per-genre buttons.
      const btn = r.querySelector<HTMLButtonElement>("[data-add-media]")
               ?? r.querySelector<HTMLButtonElement>("[data-add-genre]");
      if (!btn) return;
      applyAddedStyle(btn, added);
      if (btn.dataset.addMedia !== undefined) toggleMediaAdded(r, added);
    });
  }

  function render(): void {
    cartList.innerHTML = "";
    if (entries.size === 0) {
      cartList.innerHTML = `<span class="text-[rgba(230,250,252,0.85)] text-sm">No dictionaries added yet.</span>`;
    } else {
      for (const [key, e] of entries) {
        const item = document.createElement("div");
        item.className = "flex items-center justify-between gap-2 bg-[#3a3a3a] border border-[#5a5a5a] rounded-xl px-3 py-2";
        item.innerHTML = `
          <div class="flex flex-col min-w-0">
            <span class="text-[#E6FAFC] font-semibold text-sm truncate">${esc(e.name)}</span>
            <span class="text-[rgba(230,250,252,0.85)] text-xs">${e.isMedia ? "All decks" : `${e.words.toLocaleString()} words · ${e.decks.toLocaleString()} decks`}</span>
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

    // Disable an article's media-add button when any of its per-genre rows is
    // already in the cart — adding the full media on top would double-count
    // those genres at merge time.
    scope!.querySelectorAll<HTMLElement>(".rec-article").forEach((article) => {
      const mediaBtn = article.querySelector<HTMLButtonElement>("[data-add-media]");
      if (!mediaBtn) return;
      let hasGenreInCart = false;
      for (const entry of entries.values()) {
        if (entry.isMedia) continue;
        if (article.contains(entry.row)) { hasGenreInCart = true; break; }
      }
      mediaBtn.disabled = hasGenreInCart;
    });

    if (entries.size === 0) statusEl.textContent = "Add at least 2 dictionaries to merge.";
    else if (entries.size === 1) statusEl.textContent = "Add 1 more dictionary to merge.";
    else statusEl.textContent = `${entries.size} dictionaries ready to merge.`;
  }

  scope.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-add-genre], [data-add-media]");
    if (!btn || btn.disabled) return;
    const row = btn.closest<HTMLElement>("[data-zip-url]");
    if (!row) return;

    const key = row.dataset.zipUrl!;
    if (entries.has(key)) {
      entries.delete(key);
      setRowAdded(row, false);
    } else {
      const isMedia = btn.dataset.addMedia !== undefined;
      const name = isMedia
        ? `${row.querySelector<HTMLElement>("h3")?.textContent?.trim() ?? "Media"} (All)`
        : row.querySelector<HTMLElement>("[data-genre-name]")?.textContent?.trim() ?? "Genre";
      entries.set(key, {
        zipUrl: key,
        name,
        words: Number(row.dataset.words ?? "0"),
        decks: Number(row.dataset.decks ?? "0"),
        row,
        isMedia,
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
    const mode: MergeMode | null = await promptMergeMode();
    if (!mode) return;

    const selected = [...entries.values()];
    window.umami?.track("merge-dictionaries", { mode, count: selected.length });
    mergeBtn.disabled = true;
    try {
      // Always fetch the _count variant — it carries raw per-genre occurrence
      // counts, which mergeJitenDecks needs to sum (and then re-rank when the
      // user picked the ranked output mode).
      const blobs: Blob[] = [];
      for (let i = 0; i < selected.length; i++) {
        statusEl.textContent = `Downloading ${i + 1}/${selected.length}: ${selected[i].name}…`;
        const countUrl = selected[i].zipUrl.replace(/\.zip$/, "_count.zip");
        const res = await fetch(countUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status} — could not fetch ${selected[i].name} from ${DICT_BASE_URL}`);
        blobs.push(await res.blob());
      }

      statusEl.textContent = "Merging…";
      const name = nameInput.value.trim() || "Combined Frequency";
      const files = blobs.map((blob, i) => new File([blob], `dict_${i}.zip`));
      const result = await mergeJitenDecks(files, name, mode);
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

const MEDIA_TYPES: { id: string; label: string; singularLabel?: string; fileLabel: string; prefix: string; genres?: readonly string[] }[] = [
  { id: "anime", label: "Anime", fileLabel: "Anime", prefix: "anime_dicts/" },
  { id: "manga", label: "Manga", fileLabel: "Manga", prefix: "manga_dicts/" },
  { id: "drama", label: "Drama", fileLabel: "Drama", prefix: "drama_dicts/", genres: ["Action", "Comedy", "Drama", "Mystery", "Sci-Fi"] },
  { id: "novel", label: "Novel", fileLabel: "Novel", prefix: "novel_dicts/" },
  { id: "videogame", label: "Video Games", singularLabel: "Video Game", fileLabel: "Video_Game", prefix: "videogame_dicts/", genres: ["Action", "Adventure", "Comedy", "Fantasy", "Mystery", "Sci-Fi", "Sports", "Thriller"] },
  { id: "visualnovel", label: "Visual Novel", fileLabel: "Visual_Novel", prefix: "visualnovel_dicts/", genres: ["Action", "Adult Only", "Comedy", "Drama", "Fantasy", "Horror", "Mecha", "Music", "Mystery", "Psychological", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Thriller"] },
];

const DICT_BASE_URL = "https://dicts.yomitanfrequencies.org";

// Jiten only hosts N1–N3 right now. Append N4/N5 here (and bump grid-cols-3 in
// index.html to grid-cols-5) once they're harvested and uploaded to R2.
const JLPT_LEVELS = ["N1", "N2", "N3"] as const;

function genreFileSlug(genre: string): string {
  return genre.replace(/\s+/g, "_");
}

function genreDictTitle(genre: string, media: typeof MEDIA_TYPES[number]): string {
  const mediaName = media.singularLabel ?? media.label;
  return genre === media.label ? genre : `${genre} (${mediaName})`;
}

function attachRenameDownload(anchor: HTMLAnchorElement, title: string): void {
  anchor.addEventListener("click", (e) => {
    e.preventDefault();
    const url = anchor.href;
    // Preserve the original filename from the URL — only the dict title inside
    // the zip changes. Falls back to a safe-filename of the title only if the
    // URL has no usable path segment.
    const urlFilename = url.split("/").pop()?.split("?")[0] || `${safeFilename(title)}.zip`;
    const original = anchor.innerHTML;
    anchor.style.pointerEvents = "none";
    downloadRenamedZip(url, title, urlFilename)
      .catch((err) => alert(`Download failed: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => {
        anchor.innerHTML = original;
        anchor.style.pointerEvents = "";
      });
  });
}

function populateJlptGrid(): void {
  const grid = document.querySelector<HTMLElement>("[data-jlpt-grid]");
  if (!grid) return;
  grid.innerHTML = "";
  for (const level of JLPT_LEVELS) {
    const sourcesUrl = `${DICT_BASE_URL}/jlpt_dicts/${level}_sources.json`;
    const zipUrl = `${DICT_BASE_URL}/jlpt_dicts/${level}.zip`;

    const card = document.createElement("div");
    card.className = "bg-[#3a3a3a] border border-[#5a5a5a] rounded-xl p-3 flex flex-col gap-2";
    card.dataset.genreUrl = sourcesUrl;
    card.dataset.zipUrl = zipUrl;
    // Each JLPT level is a single Jiten deck — there's no "X decks" stat worth
    // showing and no sources list to expand. Mark decks="1" so the cart's
    // total-decks counter sums correctly when JLPT levels are added.
    card.dataset.decks = "1";
    card.innerHTML = `
      <span data-genre-name class="text-[#E6FAFC] text-sm font-semibold">JLPT ${esc(level)}</span>
      <div class="flex gap-3 text-[0.65rem] text-[rgba(230,250,252,0.6)]">
        <span><span data-stat="words" class="text-[#E6FAFC] font-bold">…</span> words</span>
      </div>
      <button data-add-genre disabled class="text-xs font-bold text-center px-2 py-1.5 rounded-lg bg-[#FB923C] border border-[#FB923C] text-white cursor-pointer transition-all duration-150 hover:bg-[#FBB36F] hover:border-[#FBB36F] disabled:opacity-40 disabled:cursor-not-allowed">Add to list</button>
      <a href="${zipUrl}" download data-umami-event="download-jlpt" data-umami-event-level="${esc(level)}" class="inline-flex items-center justify-center gap-1.5 text-xs font-bold px-2 py-1.5 rounded-lg bg-[#5a5a5a] text-[#E6FAFC] hover:bg-[#6a6a6a] transition-colors duration-150 no-underline"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13M5 15l7 7 7-7"/><line x1="3" y1="22" x2="21" y2="22"/></svg>Download</a>
    `;
    const dlAnchor = card.querySelector<HTMLAnchorElement>("a[download]")!;
    attachRenameDownload(dlAnchor, `JLPT ${level}`);
    grid.append(card);
    loadJlptCard(card);
  }
}

async function loadJlptCard(card: HTMLElement): Promise<void> {
  const sourcesUrl = card.dataset.genreUrl!;
  const cacheKey = `sources-v1-${sourcesUrl}`;
  const wordsEl = card.querySelector<HTMLElement>('[data-stat="words"]')!;
  const addBtn = card.querySelector<HTMLButtonElement>("[data-add-genre]");

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
    card.dataset.words = String(data.totalWords);
    if (addBtn) addBtn.disabled = false;
  } catch {
    wordsEl.textContent = "—";
  }
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
      const displayName = genre === media.label ? genre : `${genre} ${media.label}`;

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
        <button data-add-genre disabled class="text-xs font-bold text-center px-2 py-1.5 rounded-lg bg-[#FB923C] border border-[#FB923C] text-white cursor-pointer transition-all duration-150 hover:bg-[#FBB36F] hover:border-[#FBB36F] disabled:opacity-40 disabled:cursor-not-allowed">Add to list</button>
        <a href="${downloadUrl}" download data-umami-event="download-genre" data-umami-event-media="${esc(media.label)}" data-umami-event-genre="${esc(genre)}" class="inline-flex items-center justify-center gap-1.5 text-xs font-bold px-2 py-1.5 rounded-lg bg-[#5a5a5a] text-[#E6FAFC] hover:bg-[#6a6a6a] transition-colors duration-150 no-underline"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13M5 15l7 7 7-7"/><line x1="3" y1="22" x2="21" y2="22"/></svg>Download</a>
        <div data-sources class="empty:hidden"></div>
      `;
      const dlAnchor = card.querySelector<HTMLAnchorElement>("a[download]")!;
      attachRenameDownload(dlAnchor, genreDictTitle(genre, media));
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
      const displayName = genre === media.label ? genre : `${genre} ${media.label}`;

      const row = document.createElement("div");
      row.className = "flex flex-col rounded-xl bg-[#3a3a3a] border border-[#5a5a5a]";
      row.dataset.genreUrl = sourcesUrl;
      row.dataset.zipUrl = zipUrl;
      row.innerHTML = `
        <div class="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-6 px-4 py-3">
          <span data-genre-name class="text-[#E6FAFC] font-semibold text-sm">${esc(displayName)}</span>
          <div class="flex flex-col items-end gap-0.5">
            <span class="text-[#FB923C] text-[0.6rem] font-bold uppercase tracking-wider">Words</span>
            <span data-stat="words" class="text-[#E6FAFC] font-bold text-sm">…</span>
          </div>
          <div class="flex flex-col items-end gap-0.5">
            <span class="text-[#FB923C] text-[0.6rem] font-bold uppercase tracking-wider">Decks</span>
            <span data-stat="decks" class="text-[#E6FAFC] font-bold text-sm">…</span>
          </div>
          <a href="${downloadUrl}" download data-umami-event="download-genre" data-umami-event-media="${esc(media.label)}" data-umami-event-genre="${esc(genre)}" class="inline-flex items-center justify-center gap-1.5 text-xs font-bold px-4 py-1.5 rounded-lg bg-[#5a5a5a] text-[#E6FAFC] hover:bg-[#6a6a6a] transition-colors duration-150 no-underline"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13M5 15l7 7 7-7"/><line x1="3" y1="22" x2="21" y2="22"/></svg>Download</a>
          <button data-add-genre disabled class="text-xs font-bold text-center px-4 py-1.5 rounded-lg bg-[#FB923C] border border-[#FB923C] text-white cursor-pointer transition-all duration-150 hover:bg-[#FBB36F] hover:border-[#FBB36F] disabled:opacity-40 disabled:cursor-not-allowed">Add to list</button>
        </div>
        <div data-sources class="px-4 pb-3 empty:hidden"></div>
      `;
      const dlAnchor = row.querySelector<HTMLAnchorElement>("a[download]")!;
      attachRenameDownload(dlAnchor, genreDictTitle(genre, media));
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

function setupMediaAddButtons(): void {
  // Walk every <article class="rec-article">, copy the Download anchor's href
  // onto the article as data-zip-url (so the cart can find it the same way it
  // finds per-genre rows), and inject an "Add to list" button next to Download.
  document.querySelectorAll<HTMLElement>(".rec-article").forEach((article) => {
    const dl = article.querySelector<HTMLAnchorElement>("a[download]");
    if (!dl) return;
    // Articles without a media-level download (e.g. the JLPT card) only have
    // per-level download links inside their card grid. Skip those — picking up
    // the first per-card link would graft it onto the article header and tag
    // the whole article with that single level's zipUrl.
    if (dl.closest("[data-featured-grid], [data-jlpt-grid]")) return;
    article.dataset.zipUrl = dl.href;

    // Group Download + Add to list together on the right side of the header.
    // The header is a justify-between flex, so without a wrapper a third child
    // would spread them out awkwardly. The wrapper keeps them paired.
    const wrap = document.createElement("div");
    wrap.className = "flex items-center gap-2 shrink-0";
    dl.replaceWith(wrap);
    // Download has no border; the Add button has a 1px orange border (used for
    // the ghost "Added" state). Add a transparent matching border to Download
    // so both buttons render at the same exact height.
    dl.classList.add("border", "border-transparent");
    const btn = document.createElement("button");
    btn.dataset.addMedia = "";
    btn.className = "inline-flex items-center gap-2 px-7 py-3 rounded-2xl bg-[#FB923C] border border-[#FB923C] text-white text-sm font-bold tracking-wide cursor-pointer transition-all duration-150 hover:bg-[#FBB36F] hover:border-[#FBB36F] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#FB923C] disabled:hover:border-[#FB923C]";
    btn.textContent = "Add to list";
    wrap.append(dl, btn);
  });
}

function setupJlptGeneralizedRename(): void {
  // The generalised JLPT download is a static anchor in index.html. Intercept
  // it to rewrite the dict title to "JLPT" (also fixes the upstream "frequncy"
  // typo since we overwrite the title). Per-level JLPT cards live inside
  // [data-jlpt-grid] and keep their original titles.
  document.querySelectorAll<HTMLAnchorElement>('a[data-umami-event-media="JLPT"]').forEach((a) => {
    if (a.closest("[data-jlpt-grid]")) return;
    attachRenameDownload(a, "JLPT");
  });
}

export function setupRecommendedPage(): void {
  populateAllGenresSections();
  populateFeaturedGrids();
  populateJlptGrid();
  setupMediaAddButtons();
  setupMediaDropdowns();
  setupGenreCart();
  setupJlptGeneralizedRename();
}
