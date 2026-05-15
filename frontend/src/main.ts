import "./style.css";
import { $ } from "./dom";
import { FileManager } from "./fileManager";
import { setupTabs } from "./tabs";
import { setupPages } from "./pages";
import { setupSearchPage } from "./searchPage";
import { averageZips, downloadBlob } from "./combiner";

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
