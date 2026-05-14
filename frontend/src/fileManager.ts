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

  reset(): void {
    this.files = [];
    this.render();
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
      const btn = (e.target as Element).closest<HTMLButtonElement>(".remove-btn");
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
  li.className =
    "file-item flex items-center gap-3 bg-[#4a4a4a] border-2 border-[#5a5a5a] rounded-xl px-3.5 py-2.5 text-[0.9rem] transition-all duration-150";

  const icon = document.createElement("span");
  icon.className = "text-lg shrink-0";
  icon.textContent = "📦";

  const name = document.createElement("span");
  name.className = "flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[#E6FAFC] font-semibold";
  name.title = file.name;
  name.textContent = file.name;

  const size = document.createElement("span");
  size.className = "text-[rgba(230,250,252,0.4)] text-xs font-bold shrink-0";
  size.textContent = formatBytes(file.size);

  const remove = document.createElement("button");
  remove.className =
    "remove-btn bg-transparent border-0 cursor-pointer text-[rgba(230,250,252,0.4)] px-2 py-1 rounded-md text-lg leading-none shrink-0 transition-all duration-150";
  remove.dataset.index = String(index);
  remove.setAttribute("aria-label", `Remove ${file.name}`);
  remove.textContent = "✕";

  li.append(icon, name, size, remove);
  return li;
}
