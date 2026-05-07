import "./style.css";
const subtitle = document.getElementById("subtitle");
const tabSubtitles = {
    frequency: "Combine multiple Yomitan frequency dictionary zips into a single archive.",
    kanji: "Combine multiple Yomitan kanji dictionary zips into a single archive.",
};
document.getElementById("page-tabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (!tab)
        return;
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    subtitle.textContent = tabSubtitles[tab.dataset.tab ?? "frequency"];
});
const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const fileListSection = document.getElementById("file-list-section");
const fileList = document.getElementById("file-list");
const combineBtn = document.getElementById("combine-btn");
const files = [];
function formatBytes(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function renderFileList() {
    fileList.innerHTML = "";
    files.forEach((file, index) => {
        const li = document.createElement("li");
        li.className = "file-item";
        li.innerHTML = `
      <span class="file-icon">📦</span>
      <span class="file-name" title="${file.name}">${file.name}</span>
      <span class="file-size">${formatBytes(file.size)}</span>
      <button class="remove-btn" aria-label="Remove ${file.name}" data-index="${index}">✕</button>
    `;
        fileList.appendChild(li);
    });
    fileListSection.hidden = files.length === 0;
    combineBtn.disabled = files.length === 0;
}
function addFiles(incoming) {
    const existing = new Set(files.map((f) => f.name));
    for (const file of Array.from(incoming)) {
        if (!file.name.toLowerCase().endsWith(".zip"))
            continue;
        if (existing.has(file.name))
            continue;
        files.push(file);
        existing.add(file.name);
    }
    renderFileList();
}
// Click to browse
dropZone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
    if (fileInput.files)
        addFiles(fileInput.files);
    fileInput.value = "";
});
// Drag and drop
dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
});
dropZone.addEventListener("dragleave", (e) => {
    if (!dropZone.contains(e.relatedTarget)) {
        dropZone.classList.remove("drag-over");
    }
});
dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    if (e.dataTransfer?.files)
        addFiles(e.dataTransfer.files);
});
// Remove a file
fileList.addEventListener("click", (e) => {
    const btn = e.target.closest(".remove-btn");
    if (!btn)
        return;
    const index = Number(btn.dataset.index);
    files.splice(index, 1);
    renderFileList();
});
// Combine — logic goes here
combineBtn.addEventListener("click", () => {
    // TODO: zip combining logic
    console.log("Combine clicked", files);
});
