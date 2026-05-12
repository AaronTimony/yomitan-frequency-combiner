const TAB_SUBTITLES: Record<string, string> = {
  frequency:
    "Combine multiple Yomitan frequency dictionary zips into a single archive.",
  kanji:
    "Combine multiple Yomitan kanji dictionary zips into a single archive.",
};

export type TabKey = keyof typeof TAB_SUBTITLES;

export function setupTabs(
  tabsEl: HTMLElement,
  subtitleEl: HTMLElement,
  onChange?: (key: TabKey) => void,
): void {
  tabsEl.addEventListener("click", (e) => {
    const tab = (e.target as Element).closest<HTMLButtonElement>(".tab");
    if (!tab) return;

    const key = (tab.dataset.tab ?? "frequency") as TabKey;
    if (!(key in TAB_SUBTITLES)) return;

    tabsEl
      .querySelectorAll<HTMLButtonElement>(".tab")
      .forEach((t) => t.classList.toggle("active", t === tab));

    subtitleEl.textContent = TAB_SUBTITLES[key];
    onChange?.(key);
  });
}
