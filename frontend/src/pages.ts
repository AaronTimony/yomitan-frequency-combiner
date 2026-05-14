export type PageKey = "recommended" | "combiner" | "search";

export function setupPages(navEl: HTMLElement): void {
  const pages = new Map<PageKey, HTMLElement>();
  for (const key of ["recommended", "combiner", "search"] as const) {
    const el = document.getElementById(`page-${key}`);
    if (el) pages.set(key, el);
  }

  navEl.addEventListener("click", (e) => {
    const btn = (e.target as Element).closest<HTMLButtonElement>(".page-tab");
    if (!btn) return;

    const key = btn.dataset.page as PageKey | undefined;
    if (!key || !pages.has(key)) return;

    navEl
      .querySelectorAll<HTMLButtonElement>(".page-tab")
      .forEach((t) => t.classList.toggle("active", t === btn));

    pages.forEach((el, k) => {
      el.hidden = k !== key;
    });
  });
}
