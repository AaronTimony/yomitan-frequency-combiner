const TAB_SUBTITLES = {
    frequency: "Combine multiple Yomitan frequency dictionary zips into a single archive.",
    kanji: "Combine multiple Yomitan kanji dictionary zips into a single archive.",
};
export function setupTabs(tabsEl, subtitleEl, onChange) {
    tabsEl.addEventListener("click", (e) => {
        const tab = e.target.closest(".tab");
        if (!tab)
            return;
        const key = (tab.dataset.tab ?? "frequency");
        if (!(key in TAB_SUBTITLES))
            return;
        tabsEl
            .querySelectorAll(".tab")
            .forEach((t) => t.classList.toggle("active", t === tab));
        subtitleEl.textContent = TAB_SUBTITLES[key];
        onChange?.(key);
    });
}
