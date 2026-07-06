import "./style.css";
import { DEFAULT_PARAMS, type Params } from "./config";
import {
  loadFromFiles,
  loadInitialImages,
  pictureFromURL,
  type Picture,
} from "./images";
import { listDrawings, type Drawing } from "./gallery";
import { Simulation } from "./engine/Simulation";
import { ControlBar, type AppHooks } from "./ui/Controls";
import { RotationRatio } from "./ui/RotationRatio";
import { Guide } from "./ui/Guide";
import { PaintEditor } from "./ui/PaintEditor";
import { CompressEditor } from "./ui/CompressEditor";
import { Gallery } from "./ui/Gallery";
import { ImagePicker } from "./ui/ImagePicker";

// ===========================================================
// アプリ状態
// ===========================================================
const state = {
  params: { ...DEFAULT_PARAMS } as Params,
  images: [] as Picture[],
  index: 0,
  paused: false,
};
/** ギャラリー作品 id → state.images 内の位置 */
const drawingIndex = new Map<string, number>();

// ===========================================================
// DOM / エンジン
// ===========================================================
const view = document.getElementById("view") as HTMLCanvasElement;
const stage = document.getElementById("stage") as HTMLElement;
const controlsRoot = document.getElementById("controls") as HTMLElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;

const sim = new Simulation(view);
const guide = new Guide();

function currentPicture(): Picture | null {
  return state.images[state.index] ?? null;
}
function applyCurrentImage(): void {
  sim.setImage(currentPicture());
}
function setIndex(i: number): void {
  const n = state.images.length;
  if (n === 0) return;
  state.index = ((i % n) + n) % n;
  applyCurrentImage();
  bar.update();
}

// ===========================================================
// 操作フック
// ===========================================================
const hooks: AppHooks = {
  getParams: () => state.params,
  setParams: (patch) => {
    state.params = { ...state.params, ...patch };
  },
  isPaused: () => state.paused,
  togglePause: () => {
    state.paused = !state.paused;
    bar.update();
  },
  next: () => setIndex(state.index + 1),
  prev: () => setIndex(state.index - 1),
  addImages: () => fileInput.click(),
  toggleFullscreen,
  openGuide: () => guide.show(),
  openPaint: () => paint.open(),
  openCompress: () => compress.open(),
  openGallery: () => gallery.show(),
  openImagePicker: () => imagePicker.show(),
  getImages: () => state.images,
  getIndex: () => state.index,
};

const bar = new ControlBar(controlsRoot, hooks);
new RotationRatio(stage, {
  getParams: () => state.params,
  setParams: (patch) => {
    state.params = { ...state.params, ...patch };
  },
});

// ===========================================================
// ペイント / ギャラリー
// ===========================================================
const paint = new PaintEditor(onDrawingSaved, () => {});
const compress = new CompressEditor(onDrawingSaved, () => {});
compress.bind(() => state.images);
const gallery = new Gallery(useDrawing, editDrawing, onDrawingDeleted);
const imagePicker = new ImagePicker((i) => setIndex(i));
imagePicker.bind(
  () => state.images,
  () => state.index,
);

/** 保存された作品を画像リストに反映（上書き or 追加）してその絵に切替 */
async function onDrawingSaved(d: Drawing): Promise<void> {
  const pic = await pictureFromURL(d.dataURL, d.name);
  const existing = drawingIndex.get(d.id);
  if (existing !== undefined) {
    state.images[existing] = pic;
    setIndex(existing);
  } else {
    state.images.push(pic);
    drawingIndex.set(d.id, state.images.length - 1);
    setIndex(state.images.length - 1);
  }
}

/** ギャラリーの「使う」：その作品をシミュレータに表示 */
function useDrawing(d: Drawing): void {
  const idx = drawingIndex.get(d.id);
  if (idx !== undefined) setIndex(idx);
  else onDrawingSaved(d); // 未読み込みなら取り込む
}

/** ギャラリーの「編集」/「新規作成」 */
function editDrawing(d: Drawing | null): void {
  paint.open(d ?? undefined);
}

/** ギャラリー削除時：画像リストからも外す */
function onDrawingDeleted(id: string): void {
  const idx = drawingIndex.get(id);
  if (idx === undefined) return;
  state.images.splice(idx, 1);
  drawingIndex.delete(id);
  // 後続のインデックスを詰め直す
  for (const [key, val] of drawingIndex) {
    if (val > idx) drawingIndex.set(key, val - 1);
  }
  if (state.index >= state.images.length) state.index = Math.max(0, state.images.length - 1);
  applyCurrentImage();
  bar.update();
}

// ===========================================================
// 画像追加（ファイル選択）
// ===========================================================
fileInput.addEventListener("change", async () => {
  if (!fileInput.files || fileInput.files.length === 0) return;
  const added = await loadFromFiles(fileInput.files);
  fileInput.value = "";
  if (added.length === 0) return;
  const firstNew = state.images.length;
  state.images.push(...added);
  setIndex(firstNew);
});

// ===========================================================
// フルスクリーン
// ===========================================================
function toggleFullscreen(): void {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    document.documentElement.requestFullscreen().catch(() => {});
  }
}

// ===========================================================
// リサイズ（デバウンス）
// ===========================================================
let resizeTimer = 0;
function scheduleResize(): void {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(doResize, 120);
}
function doResize(): void {
  const rect = stage.getBoundingClientRect();
  sim.resize(rect.width, rect.height);
  applyCurrentImage();
}
window.addEventListener("resize", scheduleResize);
document.addEventListener("fullscreenchange", scheduleResize);

// ESC は開いているオーバーレイを閉じるためだけに使用（シミュレータ操作はすべてボタン）
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    guide.hide();
    gallery.hide();
    imagePicker.hide();
  }
});

// ===========================================================
// メインループ（delta-time）
// ===========================================================
let last = performance.now();
function loop(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  sim.render(dt, state.params, state.paused);
  requestAnimationFrame(loop);
}

// ===========================================================
// 起動
// ===========================================================
async function boot(): Promise<void> {
  doResize();
  try {
    state.images = await loadInitialImages();
  } catch (err) {
    console.error("画像の読み込みに失敗しました", err);
  }
  // 保存済みギャラリー作品も末尾に取り込む
  for (const d of listDrawings().slice().reverse()) {
    try {
      const pic = await pictureFromURL(d.dataURL, d.name);
      drawingIndex.set(d.id, state.images.length);
      state.images.push(pic);
    } catch {
      /* 壊れた保存はスキップ */
    }
  }
  setIndex(0);
  requestAnimationFrame((t) => {
    last = t;
    loop(t);
  });
}

boot();
