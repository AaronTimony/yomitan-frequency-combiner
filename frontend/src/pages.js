const ORDER = ["recommended", "create", "combiner", "genre"];
function pathKey() {
    const segment = location.pathname.replace(/^\//, "");
    if (ORDER.includes(segment))
        return segment;
    // If the server redirected us to / (losing the original path), fall back to
    // whatever page was last active so a refresh doesn't silently switch pages.
    const stored = sessionStorage.getItem("active-page");
    return stored && ORDER.includes(stored) ? stored : "create";
}
export function setupPages(navEl) {
    const pages = new Map();
    for (const key of ORDER) {
        const el = document.getElementById(`page-${key}`);
        if (el)
            pages.set(key, el);
    }
    const prevBtn = document.getElementById("page-prev");
    const nextBtn = document.getElementById("page-next");
    // push=true  → pushState (adds history entry; back button returns here)
    // push=false → replaceState (reflect state without a new history entry)
    function activate(key, push = true) {
        if (!pages.has(key))
            return;
        sessionStorage.setItem("active-page", key);
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
        if (push) {
            // When navigating to the create page, restore the last saved search params
            // so the user's filters survive in-app navigation (not just refresh).
            const savedSearch = key === "create" ? (sessionStorage.getItem("create-search") ?? "") : "";
            history.pushState(null, "", `/${key}${savedSearch}`);
        }
        else {
            // On initial load / popstate: preserve whatever search params are already
            // in the URL — this is what makes refresh work.
            history.replaceState(null, "", `/${key}${location.search}`);
        }
    }
    navEl.addEventListener("click", (e) => {
        const btn = e.target.closest(".page-tab");
        if (!btn)
            return;
        const key = btn.dataset.page;
        if (key)
            activate(key);
    });
    function nearCenter(e, btn) {
        const rect = btn.getBoundingClientRect();
        return Math.abs(e.clientY - (rect.top + rect.height / 2)) < 80;
    }
    prevBtn?.addEventListener("click", (e) => {
        if (!nearCenter(e, prevBtn))
            return;
        const idx = ORDER.indexOf(pathKey());
        if (idx > 0)
            activate(ORDER[idx - 1]);
    });
    nextBtn?.addEventListener("click", (e) => {
        if (!nearCenter(e, nextBtn))
            return;
        const idx = ORDER.indexOf(pathKey());
        if (idx < ORDER.length - 1)
            activate(ORDER[idx + 1]);
    });
    // Sync to hash on browser back/forward.
    window.addEventListener("popstate", () => activate(pathKey(), false));
    // Initial load: read hash from URL, update URL to normalise it (replaceState).
    activate(pathKey(), false);
}
