import { formatBytes } from "./format";

export interface FileManagerElements {
  dropZone: HTMLElement;
  fileInput: HTMLInputElement;
  fileListSection: HTMLElement;
  fileList: HTMLUListElement;
  combineBtn: HTMLButtonElement;
}

export class FileManager {
  private files: File[] = [];

  constructor(private readonly el: FileManagerElements) {
    this.bindBrowse();
    this.bindDragAndDrop();
    this.bindRemove();
    this.render();
  }

  getFiles(): readonly File[] {
    return this.files;
  }

  private add(incoming: FileList | File[]): void {
    const existing = new Set(this.files.map((f) => f.name));

    for (const file of Array.from(incoming)) {
      if (!file.name.toLowerCase().endsWith(".zip")) continue;
      if (existing.has(file.name)) continue;
      this.files.push(file);
      existing.add(file.name);
    }

    this.render();
  }

  private remove(index: number): void {
    if (index < 0 || index >= this.files.length) return;
    this.files.splice(index, 1);
    this.render();
  }

  private bindBrowse(): void {
    const { dropZone, fileInput } = this.el;

    dropZone.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      if (fileInput.files) this.add(fileInput.files);
      fileInput.value = "";
    });
  }

  private bindDragAndDrop(): void {
    const { dropZone } = this.el;

    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("drag-over");
    });

    dropZone.addEventListener("dragleave", (e) => {
      if (!dropZone.contains(e.relatedTarget as Node | null)) {
        dropZone.classList.remove("drag-over");
      }
    });

    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag-over");
      if (e.dataTransfer?.files) this.add(e.dataTransfer.files);
    });
  }

  private bindRemove(): void {
    this.el.fileList.addEventListener("click", (e) => {
      const btn = (e.target as Element).closest<HTMLButtonElement>(
        ".remove-btn",
      );
      if (!btn) return;
      this.remove(Number(btn.dataset.index));
    });
  }

  private render(): void {
    const { fileList, fileListSection, combineBtn } = this.el;

    fileList.replaceChildren(
      ...this.files.map((file, index) => renderItem(file, index)),
    );
    fileListSection.hidden = this.files.length === 0;
    combineBtn.disabled = this.files.length === 0;
  }
}

function renderItem(file: File, index: number): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "file-item";

  const icon = document.createElement("span");
  icon.className = "file-icon";
  icon.textContent = "📦";

  const name = document.createElement("span");
  name.className = "file-name";
  name.title = file.name;
  name.textContent = file.name;

  const size = document.createElement("span");
  size.className = "file-size";
  size.textContent = formatBytes(file.size);

  const remove = document.createElement("button");
  remove.className = "remove-btn";
  remove.dataset.index = String(index);
  remove.setAttribute("aria-label", `Remove ${file.name}`);
  remove.textContent = "✕";

  li.append(icon, name, size, remove);
  return li;
}
