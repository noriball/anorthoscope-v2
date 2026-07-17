import { t } from "./i18n";
import type { SlitShape } from "./ui/SlitPicker";

const OLD_KEY = "anortho.slitMask.v1"; // 旧：単一カスタム（移行用）
const LIST_KEY = "anortho.slitShapes.v1"; // カスタムスリット一覧（複数）
const SEL_KEY = "anortho.slitId.v1"; // 選択中の形状 id（プリセット id or カスタム id）
const PRESETS_MANIFEST = "presets/slits/manifest.json";

/** 保存済みの自作スリット1つ */
export interface CustomSlit {
  id: string;
  dataURL: string;
  createdAt: number;
}

function newId(): string {
  return `s${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
}

/** 自作スリット一覧を読む（旧・単一キーがあれば一覧へ移行） */
export function listCustomSlits(): CustomSlit[] {
  try {
    const raw = localStorage.getItem(LIST_KEY);
    let list: CustomSlit[] = raw ? (JSON.parse(raw) as CustomSlit[]) : [];
    if (list.length === 0) {
      const old = localStorage.getItem(OLD_KEY);
      if (old) {
        list = [{ id: newId(), dataURL: old, createdAt: Date.now() }];
        writeList(list);
        localStorage.removeItem(OLD_KEY);
      }
    }
    return list;
  } catch {
    return [];
  }
}

function writeList(list: CustomSlit[]): void {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

/** 自作スリットを1つ追加して、その要素を返す */
export function addCustomSlit(dataURL: string): CustomSlit {
  const list = listCustomSlits();
  const item: CustomSlit = { id: newId(), dataURL, createdAt: Date.now() };
  list.push(item);
  writeList(list);
  return item;
}

/** 自作スリットを id 指定で削除 */
export function deleteCustomSlit(id: string): void {
  writeList(listCustomSlits().filter((s) => s.id !== id));
}

/** 全スリット形状を読み込む（プリセット + 自作の複数）。自作は deletable=true */
export async function loadSlitShapes(): Promise<SlitShape[]> {
  const shapes: SlitShape[] = [];
  try {
    const res = await fetch(PRESETS_MANIFEST);
    if (!res.ok) throw new Error(`Failed to load presets: ${res.status}`);
    const data = (await res.json()) as {
      presets: Array<{ name: string; file: string; id: string }>;
    };
    const presets: SlitShape[] = await Promise.all(
      data.presets.map(async (p) => {
        const fileRes = await fetch(`presets/slits/${p.file}`);
        if (!fileRes.ok) throw new Error(`Failed to load ${p.file}`);
        const blob = await fileRes.blob();
        return {
          id: p.id,
          // 「基本」だけは翻訳する。それ以外（1〜4）は言語に依存しない番号なのでそのまま
          name: p.id === "basic" ? t("slitMask.presetBasic") : p.name,
          dataURL: await blobToDataURL(blob),
          deletable: false,
        };
      }),
    );
    shapes.push(...presets);
  } catch (e) {
    console.error("Failed to load slit presets:", e);
  }
  // 自作スリット（複数・削除可）。名前は「自作N」で連番表示
  listCustomSlits().forEach((c, i) => {
    shapes.push({
      id: c.id,
      name: `${t("slitMask.customPrefix")}${i + 1}`,
      dataURL: c.dataURL,
      deletable: true,
    });
  });
  return shapes;
}

/** 選択中の形状 id を取得 */
export function getSelectedSlitId(): string | null {
  try {
    return localStorage.getItem(SEL_KEY);
  } catch {
    return null;
  }
}

/** 選択中の形状 id を保存 */
export function setSelectedSlitId(id: string): void {
  try {
    localStorage.setItem(SEL_KEY, id);
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
