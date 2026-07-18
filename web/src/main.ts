import "./style.css";
import {
  DEFAULT_PARAMS,
  ZOOM_STEP_FACTOR,
  SPEED_MIN,
  SPEED_MAX,
  SLITS_MIN,
  SLITS_MAX,
  FADE_MIN,
  FADE_MAX,
  BG_MAX,
  RECORD_FPS,
  RECORD_MAX_DURATION_MS,
  type Params,
} from "./config";
import { loadInitialImages, pictureFromURL, type Picture } from "./images";
import { deleteDrawing, listDrawings, type Drawing } from "./gallery";
import {
  loadSlitShapes,
  getSelectedSlitId,
  setSelectedSlitId,
  addCustomSlit,
  deleteCustomSlit,
} from "./slitMask";
import { Simulation } from "./engine/Simulation";
import { t } from "./i18n";
import { ControlBar, type AppHooks } from "./ui/Controls";
import { RotationRatio } from "./ui/RotationRatio";
import { ZoomControls } from "./ui/ZoomControls";
import { PlayButton } from "./ui/PlayButton";
import { Guide } from "./ui/Guide";
import { CompressEditor } from "./ui/CompressEditor";
import { ImagePicker } from "./ui/ImagePicker";
import { SlitPicker, type SlitShape } from "./ui/SlitPicker";
import { encodeShareState, decodeShareState } from "./share";
import { showToast } from "./ui/toast";
import { startRecording, type Recording } from "./recorder";

// ===========================================================
// アプリ状態
// ===========================================================
const state = {
  params: { ...DEFAULT_PARAMS } as Params,
  images: [] as Picture[],
  index: 0,
  paused: false,
  slitShapes: [] as SlitShape[],
  slitIndex: 0,
};
/** ギャラリー作品 id → state.images 内の位置 */
const drawingIndex = new Map<string, number>();

// ===========================================================
// DOM / エンジン
// ===========================================================
const view = document.getElementById("view") as HTMLCanvasElement;
const stage = document.getElementById("stage") as HTMLElement;
const controlsRoot = document.getElementById("controls") as HTMLElement;

const sim = new Simulation(view);
const guide = new Guide();

/** スリット形状を index 指定で選択・適用し、id を永続化 */
function setSlitShape(i: number): void {
  const n = state.slitShapes.length;
  if (n === 0) return;
  state.slitIndex = ((i % n) + n) % n;
  const shape = state.slitShapes[state.slitIndex];
  sim.setSlitMask(shape.dataURL);
  setSelectedSlitId(shape.id);
}

/** 選択中の id に一致する形状を適用（無ければ先頭）。一覧再読込後に使う */
function applySelectedSlit(preferId?: string): void {
  const n = state.slitShapes.length;
  if (n === 0) return;
  const id = preferId ?? getSelectedSlitId();
  const found = state.slitShapes.findIndex((s) => s.id === id);
  state.slitIndex = found >= 0 ? found : 0;
  const shape = state.slitShapes[state.slitIndex];
  sim.setSlitMask(shape.dataURL);
  setSelectedSlitId(shape.id);
}

function currentPicture(): Picture | null {
  return state.images[state.index] ?? null;
}
function applyCurrentImage(): void {
  const pic = currentPicture();
  sim.setImage(pic);
  // スリット数は画像によって自動変更しない（1/5で描いても4本が正しく、
  // 自動で変わるとかえって紛らわしいため、常にユーザー設定のままにする）。
  // 一時停止中に選んでも、再生ボタンを押すまで絵が出ないのを防ぐため、
  // 選択直後に一度だけ描画を強制する（dt=0 なので角度は進まない）
  sim.render(0, state.params, false);
}
function setIndex(i: number): void {
  const n = state.images.length;
  if (n === 0) return;
  state.index = ((i % n) + n) % n;
  applyCurrentImage();
  bar.update();
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randomFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}
/** 主要パラメータ（速度・回転比・スリット数・フェード）に加え、画像とスリット形状も
 *  ランダムに変える。値が0付近（実質止まって見える）にならないよう、速度と回転比は
 *  下限を設ける。回転比は可動域全体（±360）だと極端すぎて見た目が破綻しやすいため、
 *  面白い見え方になりやすい実用的な範囲に絞る。 */
function randomizeParams(): void {
  let speed = randomFloat(SPEED_MIN, SPEED_MAX);
  if (Math.abs(speed) < 0.3) speed = speed < 0 ? -0.3 : 0.3;
  let imageRotFactor = randomInt(-8, 8);
  if (imageRotFactor === 0) imageRotFactor = 1;
  let slitRotFactor = randomInt(-8, 8);
  if (slitRotFactor === 0) slitRotFactor = 1;
  const numSlits = randomInt(SLITS_MIN, SLITS_MAX);
  const fadeAlpha = randomFloat(FADE_MIN, FADE_MAX);
  state.params = { ...state.params, speed, imageRotFactor, slitRotFactor, numSlits, fadeAlpha };
  if (state.images.length > 0) setIndex(randomInt(0, state.images.length - 1));
  if (state.slitShapes.length > 0) setSlitShape(randomInt(0, state.slitShapes.length - 1));
  bar.update();
  rotationRatio.update();
}

/** クリップボードへコピー。Clipboard API が使えない環境（非HTTPS配信など）では
 *  一時的な textarea + execCommand("copy") にフォールバックする。 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* フォールバックへ */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** 現在の見え方（速度・回転比・スリット数・フェード・背景色・選択中の画像/スリット形状）を
 *  再現する URL を作ってクリップボードへコピーする。
 *  自作の絵・自作スリットはこのブラウザの localStorage にしか無く共有先で再現できないため、
 *  その場合は画像/スリットの指定を省略し（受け取り側は既定のまま）、トーストでその旨を添える。 */
async function shareCurrentState(): Promise<void> {
  const isCustomImage = [...drawingIndex.values()].includes(state.index);
  const imageName = isCustomImage ? undefined : currentPicture()?.name;
  const currentSlit = state.slitShapes[state.slitIndex];
  const slitId = currentSlit && !currentSlit.deletable ? currentSlit.id : undefined;

  const query = encodeShareState({
    params: state.params,
    bgValue: bar.getBgValue(),
    imageName,
    slitId,
  });
  const url = `${location.origin}${location.pathname}?${query}`;

  const ok = await copyText(url);
  if (!ok) {
    showToast(t("main.shareCopyFailed"));
    return;
  }
  const note = isCustomImage ? t("main.shareImageUnavailableNote") : "";
  showToast(t("main.shareCopied") + note);
}

/** 起動時：URL クエリに共有状態があれば復元する（あれば true）。
 *  適用後は URL からクエリを消し、以降の「共有」操作が今の状態を正しく反映するようにする。 */
function applyShareStateFromURL(): boolean {
  const decoded = decodeShareState(location.search);
  if (!decoded) return false;

  state.params = { ...state.params, ...decoded.params };

  if (decoded.imageName) {
    const idx = state.images.findIndex((p) => p.name === decoded.imageName);
    if (idx >= 0) state.index = idx;
  }
  if (decoded.slitId) {
    const idx = state.slitShapes.findIndex((s) => s.id === decoded.slitId);
    if (idx >= 0) {
      state.slitIndex = idx;
      const shape = state.slitShapes[idx];
      sim.setSlitMask(shape.dataURL);
      setSelectedSlitId(shape.id);
    }
  }
  if (decoded.bgValue !== undefined) bar.setBgValue(decoded.bgValue);

  history.replaceState(null, "", location.pathname);
  return true;
}

// ===========================================================
// 動画録画
// ===========================================================
let activeRecording: Recording | null = null;

/** 録画の開始／停止をトグルする。開始できない環境（対応ブラウザでない）ならトーストで知らせる。
 *  安全のため RECORD_MAX_DURATION_MS で自動停止した場合もここへコールバックで戻る。 */
function toggleRecording(): void {
  if (activeRecording) {
    const rec = activeRecording;
    activeRecording = null;
    bar.update();
    void rec.stop();
    return;
  }
  const rec = startRecording(view, RECORD_FPS, RECORD_MAX_DURATION_MS, () => {
    activeRecording = null;
    bar.update();
    showToast(t("main.recordMaxDurationToast"));
  });
  if (!rec) {
    showToast(t("main.recordUnsupported"));
    return;
  }
  activeRecording = rec;
  bar.update();
}

// ===========================================================
// 基本設定に戻す
// ===========================================================
/** ランダム・手動調整でどれだけ変えても、常に工場出荷時の既定値
 *  （既定パラメータ・先頭の画像・基本＝直線のスリット形状）へ戻す。
 *  起動時にたまたま読み込まれていた状態（共有リンクや前回の選択）ではなく、
 *  常に同じ「基本」に固定する。 */
function resetToDefaults(): void {
  state.params = { ...DEFAULT_PARAMS };
  setIndex(0);
  const basicIdx = state.slitShapes.findIndex((s) => s.id === "basic");
  setSlitShape(basicIdx >= 0 ? basicIdx : 0);
  bar.setBgValue(BG_MAX);
  bar.update();
  rotationRatio.update();
}

// ===========================================================
// 操作フック
// ===========================================================
const hooks: AppHooks = {
  getParams: () => state.params,
  setParams: (patch) => {
    state.params = { ...state.params, ...patch };
  },
  setBgColor: (hex) => {
    sim.setBgColor(hex);
    // canvas 外周（レイアウトの端数・DPRの丸め等で万一露出した場合）にも
    // 同じ色を敷いておき、境界に別色の帯が見えるのを防ぐ。
    document.body.style.background = hex;
    // 停止中は通常のフェード処理が回らないため、1 フレームだけ軽く描き直して
    // 新しい背景色を（軌跡は消さず）反映する。
    if (state.paused) sim.render(0, state.params, false);
  },
  redraw: () => {
    // 「絵を隠す」→ 蓄積バッファ（＝絵と残像）ごと即クリア。
    // 「表示」に戻す→ 1 フレームだけ強制描画して絵を出す（角度は進めない）。
    if (!state.params.showImage) sim.blankBuffers(state.params.showGuideLines);
    else sim.render(0, state.params, false);
  },
  isPaused: () => state.paused,
  togglePause: () => {
    state.paused = !state.paused;
    playButton.update(state.paused);
    bar.update();
  },
  toggleFullscreen,
  openGuide: () => guide.show(),
  openImagePicker: () => imagePicker.show(),
  openSlitPicker: () => slitPicker.show(),
  getImages: () => state.images,
  getIndex: () => state.index,
  randomize: () => randomizeParams(),
  share: () => void shareCurrentState(),
  toggleRecording,
  isRecording: () => activeRecording !== null,
  isRightFocused: () => sim.getFocus() === "right",
  resetToDefaults,
};

// 再生／停止は下部バーの中央に置く（バーは常に出ているので、単一パネルへ
// フォーカスして回転比パネルが隠れている間も操作できる）
const playButton = new PlayButton({
  toggle: () => hooks.togglePause(),
  isPaused: () => state.paused,
});
const bar = new ControlBar(controlsRoot, hooks, playButton.el);
const rotationRatio = new RotationRatio(stage, {
  getParams: () => state.params,
  setParams: (patch) => {
    state.params = { ...state.params, ...patch };
  },
});
const zoomControls = new ZoomControls(stage, {
  zoomIn: () => sim.zoomBy(ZOOM_STEP_FACTOR),
  zoomOut: () => sim.zoomBy(1 / ZOOM_STEP_FACTOR),
  reset: () => sim.resetView(),
});

/** フォーカス状態に応じて、回転比パネル／ズームボタン／カーソルを同期する */
function syncFocusUI(): void {
  const focused = sim.getFocus() !== "both";
  zoomControls.setVisible(focused);
  rotationRatio.setVisible(!focused);
  view.classList.toggle("focused", focused);
  bar.update();
}

// ===========================================================
// ペイント / ギャラリー
// ===========================================================
const compress = new CompressEditor(onDrawingSaved, useWithoutSaving, onSlitMaskChanged, () => {});
compress.bind(() => state.images);
compress.bindNumSlits(() => state.params.numSlits);
const imagePicker = new ImagePicker((i) => setIndex(i), {
  onCreate: () => compress.open(),
  onEdit: (d) => compress.open(d),
  onDelete: (d) => deleteDrawingAt(d),
});
imagePicker.bind(
  () => state.images,
  () => state.index,
  (i) => drawingAt(i),
);
const slitPicker = new SlitPicker(
  (i) => setSlitShape(i),
  () => compress.openSlitEditor(),
  (id) => deleteSlit(id),
);
slitPicker.bind(
  () => state.slitShapes,
  () => state.slitIndex,
);

/** 保存された作品を画像リストに反映（上書き or 追加）してその絵に切替 */
async function onDrawingSaved(d: Drawing): Promise<void> {
  const pic = await pictureFromURL(d.dataURL, d.name);
  pic.divisions = d.divisions;
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

/** 画像一覧のその位置が自作の絵なら、その Drawing を返す（見本画像なら undefined） */
function drawingAt(index: number): Drawing | undefined {
  for (const [id, idx] of drawingIndex) {
    if (idx === index) return listDrawings().find((d) => d.id === id);
  }
  return undefined;
}

/** 画像一覧からの削除：保存を消し、画像リストからも外して一覧を更新 */
function deleteDrawingAt(d: Drawing): void {
  deleteDrawing(d.id);
  onDrawingDeleted(d.id);
  if (imagePicker.visible) imagePicker.refresh();
}

/** 作画の「保存せず使う」：ギャラリーには残さず、一時的にシミュレータへ反映する */
async function useWithoutSaving(dataURL: string, divisions: number): Promise<void> {
  const pic = await pictureFromURL(dataURL, t("main.untitled"));
  pic.divisions = divisions;
  state.images.push(pic);
  setIndex(state.images.length - 1);
}

/** 「スリット形状」の新規作成保存：一覧へ1つ追加し、それを選択・即反映する */
async function onSlitMaskChanged(dataURL: string): Promise<void> {
  const added = addCustomSlit(dataURL); // 一覧に追加（複数保存）
  state.slitShapes = await loadSlitShapes();
  applySelectedSlit(added.id); // 追加したものを選択・適用
  bar.update();
}

/** 自作スリットの削除：一覧から外し、選択が消えたら基本へ戻す。ピッカーは即更新 */
async function deleteSlit(id: string): Promise<void> {
  const selectedId = state.slitShapes[state.slitIndex]?.id; // 変更前の選択を控える
  const wasSelected = selectedId === id;
  deleteCustomSlit(id);
  state.slitShapes = await loadSlitShapes();
  // 削除したものが選択中だったら先頭（基本）へ、それ以外は選択を維持
  applySelectedSlit(wasSelected ? state.slitShapes[0]?.id : selectedId);
  if (slitPicker.visible) slitPicker.refresh();
}

/** 自作の絵を消したとき：画像リストからも外す */
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
// フォーカス（円をクリックして単一表示）・ドラッグでパン・ボタンでズーム
// タッチ対応：等倍時の1本指ドラッグ＝スワイプ（左右で円切替／下で解除）、
// ズーム中の1本指ドラッグ＝パン（既存動作）、2本指＝ピンチズーム。
// 等倍時はパン自体が clampPan() で常に0に矯正され無効なので、
// 「スワイプ」に転用しても既存のパン操作とは競合しない。
// ===========================================================
const FOCUS_DRAG_THRESHOLD = 6; // px（CSS px）。これ未満の移動はクリック扱い
const FOCUS_SWIPE_THRESHOLD = 60; // px（CSS px）。これを超えたら切替/解除とみなす
let pointerDownPos: { x: number; y: number } | null = null;
let dragLast: { x: number; y: number } | null = null;
let isDragging = false;
let dragMode: "pan" | "swipe" | "rotate" | null = null;
// 停止中のディスク回転用：掴んだ円盤の中心（CSS px）と直前の角度
let rotateCenter: { x: number; y: number } | null = null;
let rotateLastAngle = 0;

/** CSS 座標が停止中のディスク上なら、その円盤の中心（CSS px）を返す */
function discCenterAt(clientX: number, clientY: number): { x: number; y: number } | null {
  if (!state.paused) return null;
  const rect = view.getBoundingClientRect();
  const scale = rect.width / sim.getStageWidth(); // アスペクト維持なので縦横同じ
  const { discs, r } = sim.getDiscLayout();
  for (const d of discs) {
    const cx = rect.left + d.x * scale;
    const cy = rect.top + d.y * scale;
    if (Math.hypot(clientX - cx, clientY - cy) <= r * scale) return { x: cx, y: cy };
  }
  return null;
}

// 2本指ピンチズーム用の状態
const activePointers = new Map<number, { x: number; y: number }>();
let lastPinchDist = 0;

view.addEventListener("pointerdown", (e) => {
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  view.setPointerCapture(e.pointerId);

  if (activePointers.size >= 2) {
    // 2本指目：単指ジェスチャーは中断し、ピンチ計測を開始する
    pointerDownPos = null;
    dragLast = null;
    isDragging = false;
    dragMode = null;
    const pts = [...activePointers.values()];
    lastPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    return;
  }

  pointerDownPos = { x: e.clientX, y: e.clientY };
  dragLast = { x: e.clientX, y: e.clientY };
  isDragging = false;

  // 停止中に円盤を掴んだら、ドラッグで絵を回す（他のドラッグ操作より優先）
  const center = discCenterAt(e.clientX, e.clientY);
  if (center) {
    dragMode = "rotate";
    rotateCenter = center;
    rotateLastAngle = Math.atan2(e.clientY - center.y, e.clientX - center.x);
    return;
  }

  // 等倍（パンが無効）ならスワイプ、ズーム中なら従来通りパンとして扱う
  dragMode = sim.getZoomScale() > 1 ? "pan" : "swipe";
});

view.addEventListener("pointermove", (e) => {
  if (activePointers.has(e.pointerId)) {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  if (activePointers.size >= 2) {
    if (sim.getFocus() === "both") return;
    const pts = [...activePointers.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    if (lastPinchDist > 0) {
      sim.zoomBy(dist / lastPinchDist);
    }
    lastPinchDist = dist;
    return;
  }

  if (!dragLast || !pointerDownPos) return;

  // 停止中のディスク回転：掴んだ中心まわりの角度差ぶん、絵を回す
  if (dragMode === "rotate" && rotateCenter) {
    isDragging = true;
    const ang = Math.atan2(e.clientY - rotateCenter.y, e.clientX - rotateCenter.x);
    let delta = ang - rotateLastAngle;
    if (delta > Math.PI) delta -= Math.PI * 2;
    else if (delta < -Math.PI) delta += Math.PI * 2;
    rotateLastAngle = ang;
    sim.rotateImageBy(delta, state.params.showGuideLines);
    dragLast = { x: e.clientX, y: e.clientY };
    return;
  }

  const dx = e.clientX - dragLast.x;
  const dy = e.clientY - dragLast.y;
  if (!isDragging) {
    const totalDx = e.clientX - pointerDownPos.x;
    const totalDy = e.clientY - pointerDownPos.y;
    if (Math.hypot(totalDx, totalDy) > FOCUS_DRAG_THRESHOLD) isDragging = true;
  }
  if (isDragging && dragMode === "pan" && sim.getFocus() !== "both") {
    const rect = view.getBoundingClientRect();
    const cssToStage = sim.getStageHeight() / rect.height; // アスペクト維持なので幅でも同じ比
    sim.pan(dx * cssToStage, dy * cssToStage);
  }
  dragLast = { x: e.clientX, y: e.clientY };
});

view.addEventListener("pointerup", (e) => {
  activePointers.delete(e.pointerId);
  if (activePointers.size < 2) lastPinchDist = 0;

  if (pointerDownPos && !isDragging) {
    handleStageClick(e.clientX, e.clientY);
  } else if (
    isDragging &&
    dragMode === "swipe" &&
    sim.getFocus() !== "both" &&
    pointerDownPos
  ) {
    handleFocusSwipe(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
  }
  pointerDownPos = null;
  dragLast = null;
  isDragging = false;
  dragMode = null;
  rotateCenter = null;
  view.releasePointerCapture(e.pointerId);
});

view.addEventListener("pointercancel", (e) => {
  activePointers.delete(e.pointerId);
  if (activePointers.size < 2) lastPinchDist = 0;
  pointerDownPos = null;
  dragLast = null;
  isDragging = false;
  dragMode = null;
  rotateCenter = null;
});

/** 等倍時のスワイプ：横スワイプで左右パネルを切替、下スワイプでフォーカス解除 */
function handleFocusSwipe(totalDx: number, totalDy: number): void {
  if (Math.abs(totalDx) > Math.abs(totalDy)) {
    if (Math.abs(totalDx) < FOCUS_SWIPE_THRESHOLD) return;
    const current = sim.getFocus();
    if (current === "left" || current === "right") {
      sim.setFocus(current === "left" ? "right" : "left");
      syncFocusUI();
    }
  } else {
    if (totalDy < FOCUS_SWIPE_THRESHOLD) return; // 下方向のみ（上スワイプでは解除しない）
    sim.setFocus("both");
    syncFocusUI();
  }
}

/** クリックされた位置から、フォーカス対象（左/右/解除）を決める */
function handleStageClick(clientX: number, clientY: number): void {
  if (sim.getFocus() !== "both") {
    sim.setFocus("both");
    syncFocusUI();
    return;
  }
  const rect = view.getBoundingClientRect();
  // 縦画面（上下スタック）では上下、横画面（左右並び）では左右で判定する
  if (sim.getRotRatioAnchor().axis === "vertical") {
    const yCss = clientY - rect.top;
    sim.setFocus(yCss < rect.height / 2 ? "left" : "right");
  } else {
    const xCss = clientX - rect.left;
    sim.setFocus(xCss < rect.width / 2 ? "left" : "right");
  }
  syncFocusUI();
}

// ===========================================================
// リサイズ（デバウンス）
// ===========================================================
let resizeTimer = 0;
function scheduleResize(): void {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(doResize, 120);
}
function syncRotRatioPosition(): void {
  const anchor = sim.getRotRatioAnchor();
  const rect = stage.getBoundingClientRect();
  const cssToStage = sim.getStageHeight() / rect.height;
  rotationRatio.setAnchor(anchor.axis, anchor.x / cssToStage, anchor.y / cssToStage);
}
function doResize(): void {
  const rect = stage.getBoundingClientRect();
  sim.resize(rect.width, rect.height);
  applyCurrentImage();
  syncRotRatioPosition();
}
window.addEventListener("resize", scheduleResize);
document.addEventListener("fullscreenchange", scheduleResize);

// ESC は開いているオーバーレイを閉じる／フォーカス表示を解除するためだけに使用
// （シミュレータ操作はすべてボタン）
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    guide.hide();
    imagePicker.hide();
    if (sim.getFocus() !== "both") {
      sim.setFocus("both");
      syncFocusUI();
    }
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
  syncFocusUI();
  try {
    state.images = await loadInitialImages();
  } catch (err) {
    console.error("画像の読み込みに失敗しました", err);
  }
  // 保存済みギャラリー作品も末尾に取り込む
  for (const d of listDrawings().slice().reverse()) {
    try {
      const pic = await pictureFromURL(d.dataURL, d.name);
      pic.divisions = d.divisions;
      drawingIndex.set(d.id, state.images.length);
      state.images.push(pic);
    } catch {
      /* 壊れた保存はスキップ */
    }
  }
  // スリット形状を読み込む（プリセット + 自作の複数）。保存済みの選択 id を適用
  try {
    state.slitShapes = await loadSlitShapes();
    applySelectedSlit();
  } catch (err) {
    console.error("スリット形状の読み込みに失敗しました", err);
  }
  // 共有リンク（URL クエリ）があれば、初期状態の代わりにそちらを復元する
  const restoredFromShare = applyShareStateFromURL();
  setIndex(restoredFromShare ? state.index : 0);
  if (restoredFromShare) {
    bar.update();
    rotationRatio.update();
  }
  requestAnimationFrame((t) => {
    last = t;
    loop(t);
  });
}

boot();
