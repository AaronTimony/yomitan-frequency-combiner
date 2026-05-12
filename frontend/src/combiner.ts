import JSZip from "jszip";

interface IndexJson {
  title: string;
  format: number;
  revision: string;
  [key: string]: unknown;
}

export async function combineZips(files: readonly File[], title: string): Promise<Blob> {
  if (files.length === 0) throw new Error("No files to combine");

  let baseIndex: IndexJson | null = null;
  const allEntries: unknown[] = [];

  for (const file of files) {
    const zip = await JSZip.loadAsync(file);

    const indexFile = zip.file("index.json");
    if (!indexFile) throw new Error(`${file.name}: missing index.json`);
    if (!baseIndex) {
      baseIndex = JSON.parse(await indexFile.async("string")) as IndexJson;
    }

    const bankFiles = Object.keys(zip.files)
      .filter((name) => /^term_meta_bank_\d+\.json$/.test(name))
      .sort(byBankNumber);

    if (bankFiles.length === 0) {
      throw new Error(`${file.name}: no term_meta_bank_*.json found`);
    }

    for (const bankName of bankFiles) {
      const text = await zip.file(bankName)!.async("string");
      const entries = JSON.parse(text) as unknown[];
      allEntries.push(...entries);
    }
  }

  const outIndex: IndexJson = {
    ...baseIndex!,
    title,
    revision: `${title} ${new Date().toISOString().slice(0, 10)}`,
  };

  const out = new JSZip();
  out.file("index.json", JSON.stringify(outIndex));
  out.file("term_meta_bank_1.json", JSON.stringify(allEntries));

  return out.generateAsync({ type: "blob", compression: "DEFLATE" });
}

function byBankNumber(a: string, b: string): number {
  const num = (s: string) => Number(s.match(/_(\d+)\.json$/)![1]);
  return num(a) - num(b);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
