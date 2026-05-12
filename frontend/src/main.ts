import "./style.css";
import { $ } from "./dom";
import { FileManager } from "./fileManager";
import { setupTabs } from "./tabs";
import { combineZips, downloadBlob } from "./combiner";

setupTabs($("page-tabs"), $("subtitle"));

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
    const blob = await combineZips(files, title);
    downloadBlob(blob, `${title}.zip`);
  } catch (err) {
    console.error(err);
    alert(`Failed to combine: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    combineBtn.textContent = originalLabel;
    combineBtn.disabled = files.length === 0;
  }
});
