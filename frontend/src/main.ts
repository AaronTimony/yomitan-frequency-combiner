import "./style.css";
import { $ } from "./dom";
import { FileManager } from "./fileManager";
import { setupTabs } from "./tabs";
import { averageZips, previewAveraged, previewTermBank, downloadBlob } from "./combiner";

setupTabs($("page-tabs"), $("subtitle"));

const fileManager = new FileManager({
  dropZone: $("drop-zone"),
  fileInput: $<HTMLInputElement>("file-input"),
  fileListSection: $("file-list-section"),
  fileList: $<HTMLUListElement>("file-list"),
  combineBtn: $<HTMLButtonElement>("combine-btn"),
});

const combineBtn = $<HTMLButtonElement>("combine-btn");
const previewBtn = $<HTMLButtonElement>("preview-btn");
const termBankBtn = $<HTMLButtonElement>("term-bank-btn");
const outputName = $<HTMLInputElement>("output-name");

// Keep preview buttons in sync with combine button's enabled state
new MutationObserver(() => {
  previewBtn.disabled = combineBtn.disabled;
  termBankBtn.disabled = combineBtn.disabled;
}).observe(combineBtn, { attributes: true, attributeFilter: ["disabled"] });

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

previewBtn.addEventListener("click", async () => {
  const files = fileManager.getFiles();
  if (files.length === 0) return;

  const originalLabel = previewBtn.textContent;
  previewBtn.disabled = true;
  previewBtn.textContent = "Generating…";

  try {
    await previewAveraged(files);
  } catch (err) {
    console.error(err);
    alert(`Failed to preview: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    previewBtn.textContent = originalLabel;
    previewBtn.disabled = files.length === 0;
  }
});

termBankBtn.addEventListener("click", async () => {
  const files = fileManager.getFiles();
  if (files.length === 0) return;

  const originalLabel = termBankBtn.textContent;
  termBankBtn.disabled = true;
  termBankBtn.textContent = "Generating…";

  try {
    await previewTermBank(files);
  } catch (err) {
    console.error(err);
    alert(`Failed to preview term bank: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    termBankBtn.textContent = originalLabel;
    termBankBtn.disabled = files.length === 0;
  }
});
