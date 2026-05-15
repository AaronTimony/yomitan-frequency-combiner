import "./style.css";
import { $ } from "./dom";
import { FileManager } from "./fileManager";
import { setupTabs } from "./tabs";
import { setupPages } from "./pages";
import { setupSearchPage } from "./searchPage";
import { averageZips, downloadBlob } from "./combiner";

const SUN_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`;
const MOON_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

function applyTheme(light: boolean): void {
  document.documentElement.classList.toggle("light", light);
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.innerHTML = light ? MOON_ICON : SUN_ICON;
}

const stored = localStorage.getItem("theme");
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
applyTheme(stored === "light" || (stored === null && !prefersDark));

document.getElementById("theme-toggle")?.addEventListener("click", () => {
  const nowLight = !document.documentElement.classList.contains("light");
  localStorage.setItem("theme", nowLight ? "light" : "dark");
  applyTheme(nowLight);
});

setupPages($("top-nav"));
setupTabs($("page-tabs"), $("subtitle"));
setupSearchPage($("page-search"));

const fileManager = new FileManager({
  dropZone: $("drop-zone"),
  fileInput: $<HTMLInputElement>("file-input"),
  fileListSection: $("file-list-section"),
  fileList: $<HTMLUListElement>("file-list"),
  combineBtn: $<HTMLButtonElement>("combine-btn"),
});

const combineBtn = $<HTMLButtonElement>("combine-btn");
const outputName = $<HTMLInputElement>("output-name");

combineBtn.addEventListener("click", async () => {
  const files = fileManager.getFiles();
  if (files.length === 0) return;

  const title = (outputName.value.trim() || "combined");
  const originalLabel = combineBtn.textContent;
  combineBtn.disabled = true;
  combineBtn.textContent = "Combining…";

  try {
    const blob = await averageZips(files, title);
    downloadBlob(blob, `${title}.zip`);
    fileManager.reset();
  } catch (err) {
    console.error(err);
    alert(`Failed to combine: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    combineBtn.textContent = originalLabel;
    combineBtn.disabled = fileManager.getFiles().length === 0;
  }
});
