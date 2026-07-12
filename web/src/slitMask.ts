const KEY = "anortho.slitMask.v1";

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
