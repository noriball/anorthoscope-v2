import { DATA_DIR, MANIFEST_URL } from "./config";

/** 読み込み済み画像1枚 */
export interface Picture {
  name: string;
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

/** ImageBitmap は drawImage が最速。File / URL 両対応で生成する */
async function decode(source: Blob | string, name: string): Promise<Picture> {
  let blob: Blob;
  if (typeof source === "string") {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`failed to load ${source}: ${res.status}`);
    blob = await res.blob();
  } else {
    blob = source;
  }
  const bitmap = await createImageBitmap(blob);
  return { name, bitmap, width: bitmap.width, height: bitmap.height };
}

/** manifest.json に列挙された画像をまとめて読み込む */
export async function loadInitialImages(): Promise<Picture[]> {
  const res = await fetch(MANIFEST_URL);
  if (!res.ok) throw new Error(`manifest not found: ${MANIFEST_URL}`);
  const { images } = (await res.json()) as { images: string[] };
  const list = await Promise.all(
    images.map((f) => decode(`${DATA_DIR}/${f}`, f).catch(() => null)),
  );
  return list.filter((p): p is Picture => p !== null);
}

/** dataURL / URL から 1 枚の Picture を作る（ギャラリー作品用） */
export function pictureFromURL(url: string, name: string): Promise<Picture> {
  return decode(url, name);
}

/** ユーザーが選択したファイルを読み込む */
export async function loadFromFiles(files: FileList | File[]): Promise<Picture[]> {
  const list = await Promise.all(
    Array.from(files)
      .filter((f) => /\.(png|jpe?g|gif)$/i.test(f.name))
      .map((f) => decode(f, f.name).catch(() => null)),
  );
  return list.filter((p): p is Picture => p !== null);
}
