import { GALLERY_KEY } from "./config";

/** ブラウザ内ギャラリーに保存される 1 枚 */
export interface Drawing {
  id: string;
  name: string;
  /** 角度ストレッチ済みフル画像の PNG dataURL（そのまま source として使える） */
  dataURL: string;
  /** 描いた扇形の描画レイヤ（透明背景）の PNG dataURL。再編集用（旧データには無い） */
  artURL?: string;
  /** 背景色。旧データには無い（既定は黒） */
  bg?: string;
  /** 描いたときの分割数 */
  divisions: number;
  createdAt: number;
  /** 読み込んだ写真そのもの（本体コンテンツ。トレース台紙ではない）。元データの dataURL */
  photoURL?: string;
  /** 写真の中心オフセット（PAINT_SIZE 単位、中心からの px） */
  photoX?: number;
  photoY?: number;
  /** 写真の拡大率（フィット表示を 1.0 とする倍率） */
  photoScale?: number;
}

function read(): Drawing[] {
  try {
    const raw = localStorage.getItem(GALLERY_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as Drawing[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list: Drawing[]): void {
  localStorage.setItem(GALLERY_KEY, JSON.stringify(list));
}

/** 新しい順で一覧 */
export function listDrawings(): Drawing[] {
  return read().sort((a, b) => b.createdAt - a.createdAt);
}

/** 保存（id 指定があれば上書き、なければ新規追加）。保存後の Drawing を返す */
export function saveDrawing(input: {
  id?: string;
  name?: string;
  dataURL: string;
  artURL?: string;
  bg?: string;
  divisions: number;
  photoURL?: string;
  photoX?: number;
  photoY?: number;
  photoScale?: number;
}): Drawing {
  const list = read();
  const now = Date.now();
  if (input.id) {
    const i = list.findIndex((d) => d.id === input.id);
    if (i >= 0) {
      list[i] = { ...list[i], ...input, id: input.id };
      write(list);
      return list[i];
    }
  }
  const drawing: Drawing = {
    id: `d${now}${Math.floor(Math.random() * 1000)}`,
    name: input.name ?? new Date(now).toLocaleString("ja-JP"),
    dataURL: input.dataURL,
    artURL: input.artURL,
    bg: input.bg,
    divisions: input.divisions,
    createdAt: now,
    photoURL: input.photoURL,
    photoX: input.photoX,
    photoY: input.photoY,
    photoScale: input.photoScale,
  };
  list.push(drawing);
  write(list);
  return drawing;
}

export function deleteDrawing(id: string): void {
  write(read().filter((d) => d.id !== id));
}
