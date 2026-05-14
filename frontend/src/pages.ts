export type PageKey = "recommended" | "combiner" | "search";

const ORDER: PageKey[] = ["recommended", "combiner", "search"];

export function setupPages(navEl: HTMLElement): void {
  const pages = new Map<PageKey, HTMLElement>();
  for (const key of ORDER) {
    const el = document.getElementById(`page-${key}`);
    if (el) pages.set(key, el);
  }

  const prevBtn = document.getElementById("page-prev") as HTMLButtonElement | null;
  const nextBtn = document.getElementById("page-next") as HTMLButtonElement | null;

  function activate(key: PageKey): void {
    if (!pages.has(key)) return;

    navEl
      .querySelectorAll<HTMLButtonElement>(".page-tab")
      .forEach((t) => t.classList.toggle("active", t.dataset.page === key));

    pages.forEach((el, k) => {
      el.hidden = k !== key;
    });

    const idx = ORDER.indexOf(key);
    if (prevBtn) prevBtn.hidden = idx <= 0;
    if (nextBtn) nextBtn.hidden = idx >= ORDER.length - 1;
  }

  function currentKey(): PageKey {
    const active = navEl.querySelector<HTMLButtonElement>(".page-tab.active");
    return (active?.dataset.page as PageKey) ?? "combiner";
  }

  navEl.addEventListener("click", (e) => {
    const btn = (e.target as Element).closest<HTMLButtonElement>(".page-tab");
    if (!btn) return;
    const key = btn.dataset.page as PageKey | undefined;
    if (key) activate(key);
  });

  prevBtn?.addEventListener("click", () => {
    const idx = ORDER.indexOf(currentKey());
    if (idx > 0) activate(ORDER[idx - 1]);
  });

  nextBtn?.addEventListener("click", () => {
    const idx = ORDER.indexOf(currentKey());
    if (idx < ORDER.length - 1) activate(ORDER[idx + 1]);
  });

  activate(currentKey());
}
