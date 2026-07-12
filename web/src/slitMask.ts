import type { SlitShape } from "./ui/SlitPicker";

const KEY = "anortho.slitMask.v1";
const INDEX_KEY = "anortho.slitIndex.v1";
const PRESETS_MANIFEST = "presets/slits/manifest.json";

/** 保存済みのカスタムスリット形状（PNG dataURL）。無ければ null（既定の直線スリット） */
export function loadSlitMask(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveSlitMask(dataURL: string): void {
  try {
    localStorage.setItem(KEY, dataURL);
  } catch {
    /* ignore */
  }
}

/** 全スリット形状を読み込む（プリセット + ユーザーカスタム） */
export async function loadSlitShapes(): Promise<SlitShape[]> {
  try {
    const res = await fetch(PRESETS_MANIFEST);
    if (!res.ok) throw new Error(`Failed to load presets: ${res.status}`);
    const data = (await res.json()) as { presets: Array<{ name: string; file: string; id: string }> };

    const presets: SlitShape[] = await Promise.all(
      data.presets.map(async (p) => {
        const fileRes = await fetch(`presets/slits/${p.file}`);
        if (!fileRes.ok) throw new Error(`Failed to load ${p.file}`);
        const blob = await fileRes.blob();
        const dataURL = await blobToDataURL(blob);
        return { id: p.id, name: p.name, dataURL };
      })
    );

    // Add user's custom slit if exists
    const custom = loadSlitMask();
    if (custom) {
      presets.push({ id: "custom", name: "マイスリット", dataURL: custom });
    }

    return presets;
  } catch (e) {
    console.error("Failed to load slit shapes:", e);
    return [];
  }
}

/** 現在選択されているスリット形状インデックスを取得 */
export function getSlitShapeIndex(): number {
  try {
    const idx = localStorage.getItem(INDEX_KEY);
    return idx ? parseInt(idx, 10) : 0;
  } catch {
    return 0;
  }
}

/** 現在選択されているスリット形状インデックスを保存 */
export function setSlitShapeIndex(index: number): void {
  try {
    localStorage.setItem(INDEX_KEY, String(index));
  } catch {
    /* ignore */
  }
}

/** Blob を dataURL に変換 */
function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
