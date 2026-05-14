const ORDER = ["recommended", "combiner", "search"];
export function setupPages(navEl) {
    const pages = new Map();
    for (const key of ORDER) {
        const el = document.getElementById(`page-${key}`);
        if (el)
            pages.set(key, el);
    }
    const prevBtn = document.getElementById("page-prev");
    const nextBtn = document.getElementById("page-next");
    function activate(key) {
        if (!pages.has(key))
            return;
        navEl
            .querySelectorAll(".page-tab")
            .forEach((t) => t.classList.toggle("active", t.dataset.page === key));
        pages.forEach((el, k) => {
            el.hidden = k !== key;
        });
        const idx = ORDER.indexOf(key);
        if (prevBtn)
            prevBtn.hidden = idx <= 0;
        if (nextBtn)
            nextBtn.hidden = idx >= ORDER.length - 1;
    }
    function currentKey() {
        const active = navEl.querySelector(".page-tab.active");
        return active?.dataset.page ?? "combiner";
    }
    navEl.addEventListener("click", (e) => {
        const btn = e.target.closest(".page-tab");
        if (!btn)
            return;
        const key = btn.dataset.page;
        if (key)
            activate(key);
    });
    prevBtn?.addEventListener("click", () => {
        const idx = ORDER.indexOf(currentKey());
        if (idx > 0)
            activate(ORDER[idx - 1]);
    });
    nextBtn?.addEventListener("click", () => {
        const idx = ORDER.indexOf(currentKey());
        if (idx < ORDER.length - 1)
            activate(ORDER[idx + 1]);
    });
    activate(currentKey());
}
