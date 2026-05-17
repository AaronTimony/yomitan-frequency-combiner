function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function renderSourcesList(panel, data) {
    const list = document.createElement("div");
    list.className = "flex flex-col max-h-56 overflow-y-auto border-t border-[#5a5a5a] pt-2";
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
async function attachSourcesPanel(article) {
    const sourcesUrl = article.dataset.sourcesUrl;
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
    let data;
    try {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
            data = JSON.parse(cached);
        }
        else {
            const res = await fetch(sourcesUrl);
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
            data = await res.json();
            sessionStorage.setItem(cacheKey, JSON.stringify(data));
        }
    }
    catch {
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
        }
        else {
            panel.classList.remove("hidden");
            panel.classList.add("flex");
            toggleBtn.textContent = "▴ Hide media";
            if (panel.children.length === 0)
                renderSourcesList(panel, data);
        }
    });
}
export function setupRecommendedPage() {
    document.querySelectorAll("[data-sources-url]").forEach(attachSourcesPanel);
}
