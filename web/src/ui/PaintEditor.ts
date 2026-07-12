import {
  DIV_DEFAULT,
  DIV_MAX,
  DIV_MIN,
  DISC_DIAMETER_MM_DEFAULT,
  DISC_DIAMETER_MM_MIN,
  DISC_DIAMETER_MM_MAX,
  CENTER_DOT_DIAMETER_MM,
  PAINT_SIZE,
  PRINT_DPI,
} from "../config";
import { saveDrawing, type Drawing } from "../gallery";
import { fullToWedge, wedgeToFull } from "../engine/wedge";
import { pictureFromURL, type Picture } from "../images";
import { showToast } from "./toast";

type Tool = "brush" | "eraser" | "line" | "circle" | "fill" | "photo";

const PHOTO_SCALE_MIN = 0.1;
const PHOTO_SCALE_MAX = 8;
const PHOTO_ZOOM_STEP = 1.15;

/** File を dataURL 文字列として読む（写真の実体を永続化するため） */
function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const CX = PAINT_SIZE / 2;
const CY = PAINT_SIZE / 2;
const R = PAINT_SIZE / 2;
const CENTER_ANGLE = -Math.PI / 2; // 有効扇形の中心（上向き）
const UNDO_LIMIT = 30;

/** -π..π に正規化 */
function norm(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * ペイントモードのエディタ（フルスクリーンオーバーレイ）。
 *
 * 有効な扇形（円の 1/K 領域）にのみ描画でき、表示は常に 360° へ回転展開した
 * 万華鏡状のプレビュー。保存時にその展開画像を PNG 化してギャラリーへ格納する。
 */
export class PaintEditor {
  private readonly onSaved: (d: Drawing) => void;
  private readonly onClose: () => void;

  private root!: HTMLDivElement;
  private canvas!: HTMLCanvasElement; // 描画面（扇形をそのまま表示）
  private dctx!: CanvasRenderingContext2D;
  private previewCanvas!: HTMLCanvasElement; // 角度ストレッチした展開結果
  private pctx!: CanvasRenderingContext2D;
  private drawPane!: HTMLDivElement;
  private previewPane!: HTMLDivElement;

  // 描いた扇形の内容（透明背景）
  private readonly art = document.createElement("canvas");
  private readonly actx: CanvasRenderingContext2D;
  // 読み込んだ写真（本体コンテンツ。トレース台紙ではなく実際に使う画像。扇形にクリップ）
  private readonly photo = document.createElement("canvas");
  private readonly photoCtx: CanvasRenderingContext2D;
  private photoBitmap: ImageBitmap | null = null;
  private photoDataURL: string | null = null; // 保存・再編集用（元データそのまま）
  private photoNaturalW = 0;
  private photoNaturalH = 0;
  private photoBaseScale = 1; // 読み込み時のフィット倍率
  private photoX = 0; // 中心からのオフセット（PAINT_SIZE 単位）
  private photoY = 0;
  private photoScale = 1; // フィット表示を 1.0 とする追加倍率
  private dragPhotoX0 = 0;
  private dragPhotoY0 = 0;
  // photo + art + 進行中プレビューの合成用
  private readonly work = document.createElement("canvas");
  private readonly wctx: CanvasRenderingContext2D;
  private fileInput!: HTMLInputElement;

  // 展開プレビューの解像度と再計算スロットル
  private static readonly PREVIEW_RES = 300;
  private previewDirty = false;
  private previewScheduled = false;

  private divisions = DIV_DEFAULT;
  private diskDiameterMm = DISC_DIAMETER_MM_DEFAULT;
  // PNGダウンロード設定（印刷用）
  private exportOutline = true;
  private exportOutlineColor: "#000000" | "#ffffff" = "#ffffff";
  private exportCenterMark = true;
  private exportCenterShape: "dot" | "cross" = "dot";
  private exportCenterColor: "#000000" | "#ffffff" = "#ffffff";
  private exportModal!: HTMLDivElement;
  private exportDiameterInput!: HTMLInputElement;
  private exportOutlineBtn!: HTMLButtonElement;
  private readonly exportOutlineColorBtns = new Map<string, HTMLButtonElement>();
  private exportCenterBtn!: HTMLButtonElement;
  private readonly exportCenterShapeBtns = new Map<string, HTMLButtonElement>();
  private readonly exportCenterColorBtns = new Map<string, HTMLButtonElement>();
  private tool: Tool = "brush";
  private color = "#ffd23c";
  private bgColor = "#000000"; // 背景色（描画レイヤの下に敷く単色）
  private size = 14;

  // ImageData を円盤に合成するための作業用キャンバス
  private readonly tmp = document.createElement("canvas");
  private readonly tctx: CanvasRenderingContext2D;

  private drawing = false;
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;
  private previewX = 0;
  private previewY = 0;

  private undoStack: ImageData[] = [];
  private editingId: string | undefined;

  // ツールバーの状態反映用
  private toolButtons = new Map<Tool, HTMLButtonElement>();
  private divButtons = new Map<number, HTMLButtonElement>();
  private bgInput!: HTMLInputElement;

  constructor(onSaved: (d: Drawing) => void, onClose: () => void) {
    this.onSaved = onSaved;
    this.onClose = onClose;
    this.art.width = this.art.height = PAINT_SIZE;
    this.photo.width = this.photo.height = PAINT_SIZE;
    this.work.width = this.work.height = PAINT_SIZE;
    this.actx = this.art.getContext("2d")!;
    this.photoCtx = this.photo.getContext("2d")!;
    this.wctx = this.work.getContext("2d")!;
    this.tctx = this.tmp.getContext("2d")!;
    this.buildDOM();
  }

  // =========================================================
  // 公開 API
  // =========================================================
  open(existing?: Drawing): void {
    this.editingId = existing?.id;
    this.actx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    this.undoStack = [];
    this.clearPhotoState();
    if (existing) {
      this.setDivisions(existing.divisions);
      this.bgColor = existing.bg ?? "#000000";
      this.bgInput.value = this.bgColor;
      const img = new Image();
      img.onload = () => {
        this.actx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
        if (existing.artURL) {
          // 描画レイヤ（透明背景）をそのまま復元
          this.actx.drawImage(img, 0, 0, PAINT_SIZE, PAINT_SIZE);
        } else {
          // 旧データ：角度ストレッチ済みフル画像しか無いので逆変換で扇形へ戻す
          this.wctx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
          this.wctx.drawImage(img, 0, 0, PAINT_SIZE, PAINT_SIZE);
          const full = this.wctx.getImageData(0, 0, PAINT_SIZE, PAINT_SIZE);
          this.actx.putImageData(this.compress(full), 0, 0);
        }
        this.render();
      };
      img.src = existing.artURL ?? existing.dataURL;

      // 写真本体（実体データ）と配置を復元
      if (existing.photoURL) {
        pictureFromURL(existing.photoURL, "photo").then((pic) => {
          this.photoBitmap = pic.bitmap;
          this.photoDataURL = existing.photoURL!;
          this.photoNaturalW = pic.width;
          this.photoNaturalH = pic.height;
          this.photoBaseScale = Math.min(PAINT_SIZE / pic.width, PAINT_SIZE / pic.height);
          this.photoX = existing.photoX ?? 0;
          this.photoY = existing.photoY ?? 0;
          this.photoScale = existing.photoScale ?? 1;
          this.renderPhoto();
          this.render();
        });
      }
    } else {
      this.setDivisions(this.divisions);
    }
    this.root.classList.remove("hidden");
    requestAnimationFrame(() => this.relayout());
    this.render();
  }

  /** 写真の状態（実体・配置）を初期化 */
  private clearPhotoState(): void {
    this.photoBitmap = null;
    this.photoDataURL = null;
    this.photoX = 0;
    this.photoY = 0;
    this.photoScale = 1;
    this.photoCtx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
  }

  close(): void {
    this.root.classList.add("hidden");
    this.onClose();
  }

  // =========================================================
  // 幾何
  // =========================================================
  private get wedgeAngle(): number {
    return (Math.PI * 2) / this.divisions;
  }

  /** 実際に描ける扇形の外接ボックスを計算 */
  private wedgeBBox(): { minX: number; maxX: number; minY: number; maxY: number } {
    const half = this.wedgeAngle / 2;
    const halfW = R * Math.sin(half);
    return { minX: CX - halfW, maxX: CX + halfW, minY: CY - R, maxY: CY };
  }

  private wedgePath(ctx: CanvasRenderingContext2D, begin = true): void {
    const half = this.wedgeAngle / 2;
    if (begin) ctx.beginPath();
    ctx.moveTo(CX, CY);
    ctx.arc(CX, CY, R, CENTER_ANGLE - half, CENTER_ANGLE + half);
    ctx.closePath();
  }

  private inWedge(x: number, y: number): boolean {
    const dx = x - CX;
    const dy = y - CY;
    const r = Math.hypot(dx, dy);
    if (r > R) return false;
    return Math.abs(norm(Math.atan2(dy, dx) - CENTER_ANGLE)) <= this.wedgeAngle / 2 + 1e-6;
  }

  // =========================================================
  // 描画
  // =========================================================
  private snapshot(): void {
    this.undoStack.push(this.actx.getImageData(0, 0, PAINT_SIZE, PAINT_SIZE));
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
  }

  private undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.actx.putImageData(prev, 0, 0);
    this.render();
  }

  private clearAll(): void {
    this.snapshot();
    this.actx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    this.render();
  }

  private strokeStyle(ctx: CanvasRenderingContext2D): void {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = this.size;
    ctx.strokeStyle = this.color;
    ctx.fillStyle = this.color;
  }

  /** ブラシ / 消しゴムの 1 セグメントを art へ描く（扇形クリップ） */
  private drawSegment(x0: number, y0: number, x1: number, y1: number): void {
    const ctx = this.actx;
    ctx.save();
    this.wedgePath(ctx);
    ctx.clip();
    ctx.globalCompositeOperation = this.tool === "eraser" ? "destination-out" : "source-over";
    this.strokeStyle(ctx);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
  }

  /** 直線・円を確定（扇形クリップ） */
  private commitShape(): void {
    const ctx = this.actx;
    ctx.save();
    this.wedgePath(ctx);
    ctx.clip();
    ctx.globalCompositeOperation = "source-over";
    this.strokeStyle(ctx);
    this.pathShape(ctx, this.startX, this.startY, this.previewX, this.previewY);
    ctx.stroke();
    ctx.restore();
  }

  private pathShape(
    ctx: CanvasRenderingContext2D,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): void {
    ctx.beginPath();
    if (this.tool === "line") {
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
    } else {
      // circle: 始点中心・終点までを半径
      ctx.arc(x0, y0, Math.hypot(x1 - x0, y1 - y0), 0, Math.PI * 2);
    }
  }

  /** バケツ塗り（扇形内のみ） */
  private floodFill(sx: number, sy: number): void {
    const ix = Math.round(sx);
    const iy = Math.round(sy);
    if (!this.inWedge(ix, iy)) return;
    this.snapshot();

    const img = this.actx.getImageData(0, 0, PAINT_SIZE, PAINT_SIZE);
    const data = img.data;
    const at = (x: number, y: number) => (y * PAINT_SIZE + x) * 4;
    const start = at(ix, iy);
    const target = [data[start], data[start + 1], data[start + 2], data[start + 3]];

    const fill = hexToRgba(this.color);
    if (sameColor(target, fill)) return;

    const match = (i: number) =>
      Math.abs(data[i] - target[0]) < 24 &&
      Math.abs(data[i + 1] - target[1]) < 24 &&
      Math.abs(data[i + 2] - target[2]) < 24 &&
      Math.abs(data[i + 3] - target[3]) < 24;

    const stack = [ix, iy];
    while (stack.length) {
      const y = stack.pop()!;
      const x = stack.pop()!;
      if (x < 0 || y < 0 || x >= PAINT_SIZE || y >= PAINT_SIZE) continue;
      if (!this.inWedge(x, y)) continue;
      const i = at(x, y);
      if (!match(i)) continue;
      data[i] = fill[0];
      data[i + 1] = fill[1];
      data[i + 2] = fill[2];
      data[i + 3] = fill[3];
      stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }
    this.actx.putImageData(img, 0, 0);
    this.render();
  }

  // =========================================================
  // 画像読み込み（写真そのものを本体コンテンツとして使う。移動・拡大縮小が可能）
  // =========================================================
  private loadPhoto(pic: Picture, dataURL: string): void {
    this.photoBitmap = pic.bitmap;
    this.photoDataURL = dataURL;
    this.photoNaturalW = pic.width;
    this.photoNaturalH = pic.height;
    this.photoBaseScale = Math.min(PAINT_SIZE / pic.width, PAINT_SIZE / pic.height);
    this.photoX = 0;
    this.photoY = 0;
    this.photoScale = 1;
    this.renderPhoto();
    this.render();
  }

  private async loadFile(files: FileList): Promise<void> {
    const file = files[0];
    if (!file) return;
    const dataURL = await readAsDataURL(file);
    const pic = await pictureFromURL(dataURL, file.name);
    this.loadPhoto(pic, dataURL);
  }

  /** 現在の位置・拡大率で photo キャンバスを描き直す（扇形にクリップ） */
  private renderPhoto(): void {
    this.photoCtx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    if (!this.photoBitmap) return;
    const w = this.photoNaturalW * this.photoBaseScale * this.photoScale;
    const h = this.photoNaturalH * this.photoBaseScale * this.photoScale;
    this.photoCtx.save();
    this.wedgePath(this.photoCtx);
    this.photoCtx.clip();
    this.photoCtx.drawImage(
      this.photoBitmap,
      CX + this.photoX - w / 2,
      CY + this.photoY - h / 2,
      w,
      h,
    );
    this.photoCtx.restore();
  }

  private zoomPhoto(factor: number): void {
    if (!this.photoBitmap) return;
    this.photoScale = Math.min(PHOTO_SCALE_MAX, Math.max(PHOTO_SCALE_MIN, this.photoScale * factor));
    this.renderPhoto();
    this.render();
  }

  // =========================================================
  // 表示
  //   左：扇形の描画面（そのまま表示）
  //   右：角度を K 倍に引き伸ばして 360° を埋めた「歪んだ 1 枚」プレビュー
  // =========================================================
  private render(): void {
    // work = photo（下地）+ art（＋進行中の直線/円プレビュー）。描画面・展開の共通ソース
    this.wctx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    this.wctx.drawImage(this.photo, 0, 0);
    this.wctx.drawImage(this.art, 0, 0);
    if (this.drawing && (this.tool === "line" || this.tool === "circle")) {
      this.wctx.save();
      this.wedgePath(this.wctx);
      this.wctx.clip();
      this.strokeStyle(this.wctx);
      this.pathShape(this.wctx, this.startX, this.startY, this.previewX, this.previewY);
      this.wctx.stroke();
      this.wctx.restore();
    }

    // 描画面：背景色の円盤 + 扇形の描画 + グリッド
    const ctx = this.dctx;
    ctx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    ctx.save();
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = this.bgColor;
    ctx.fillRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    ctx.drawImage(this.work, 0, 0);
    ctx.restore();
    this.drawGridOverlay(ctx);

    this.schedulePreview();
  }

  /** 透明背景の art（ImageData）を、背景色の円盤に合成して target へ描く */
  private compositeToDisc(target: CanvasRenderingContext2D, N: number, art: ImageData): void {
    if (this.tmp.width !== N || this.tmp.height !== N) this.tmp.width = this.tmp.height = N;
    this.tctx.putImageData(art, 0, 0);

    target.clearRect(0, 0, N, N);
    target.save();
    target.beginPath();
    target.arc(N / 2, N / 2, N / 2, 0, Math.PI * 2);
    target.clip();
    target.fillStyle = this.bgColor;
    target.fillRect(0, 0, N, N);
    target.drawImage(this.tmp, 0, 0);
    target.restore();
  }

  /** 展開プレビューの再計算をフレーム単位でまとめる（毎 pointermove の連打を吸収） */
  private schedulePreview(): void {
    this.previewDirty = true;
    if (this.previewScheduled) return;
    this.previewScheduled = true;
    requestAnimationFrame(() => {
      this.previewScheduled = false;
      if (!this.previewDirty) return;
      this.previewDirty = false;
      this.computePreview();
    });
  }

  private computePreview(): void {
    const N = PaintEditor.PREVIEW_RES;
    const src = this.wctx.getImageData(0, 0, PAINT_SIZE, PAINT_SIZE);
    this.compositeToDisc(this.pctx, N, this.stretch(src, N));
  }

  /** 扇形の内容を極座標へラップして 360° を埋める（幾何は engine/wedge.ts 参照）。 */
  private stretch(src: ImageData, N: number): ImageData {
    return wedgeToFull(src, PAINT_SIZE, N, this.divisions);
  }

  /** stretch の厳密な逆（順写像）。展開画像から扇形（art）を復元する（再編集用）。 */
  private compress(full: ImageData): ImageData {
    return fullToWedge(full, PAINT_SIZE, this.divisions);
  }

  private drawGridOverlay(ctx: CanvasRenderingContext2D): void {
    // 非有効セクタを薄く覆う
    ctx.save();
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, Math.PI * 2);
    this.wedgePath(ctx, false); // 逆回りサブパスで穴を空ける（even-odd）
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.fill("evenodd");
    ctx.restore();

    // 円と分割線
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(CX, CY, R - 1, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < this.divisions; i++) {
      const a = CENTER_ANGLE + this.wedgeAngle / 2 + i * this.wedgeAngle;
      ctx.beginPath();
      ctx.moveTo(CX, CY);
      ctx.lineTo(CX + Math.cos(a) * R, CY + Math.sin(a) * R);
      ctx.stroke();
    }
    ctx.restore();

    // 有効扇形の強調枠
    ctx.save();
    this.wedgePath(ctx);
    ctx.strokeStyle = "rgba(255,210,60,0.9)";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  }

  // =========================================================
  // 保存
  // =========================================================
  private buildFullImageAtSize(N: number): HTMLCanvasElement {
    const out = document.createElement("canvas");
    out.width = out.height = N;
    const ctx = out.getContext("2d")!;
    // photo（下地）+ art（手描き）を合成してから展開する
    this.wctx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    this.wctx.drawImage(this.photo, 0, 0);
    this.wctx.drawImage(this.art, 0, 0);
    const src = this.wctx.getImageData(0, 0, PAINT_SIZE, PAINT_SIZE);
    this.compositeToDisc(ctx, N, this.stretch(src, N));
    return out;
  }

  private buildFullImage(): HTMLCanvasElement {
    return this.buildFullImageAtSize(PAINT_SIZE);
  }

  private save(): void {
    const dataURL = this.buildFullImage().toDataURL("image/png");
    const artURL = this.art.toDataURL("image/png"); // 描画レイヤ（透明背景）を再編集用に保存
    const d = saveDrawing({
      id: this.editingId,
      dataURL,
      artURL,
      bg: this.bgColor,
      divisions: this.divisions,
      // 写真は本体コンテンツなので、実体データと配置をそのまま永続化（再編集で復元可）
      photoURL: this.photoDataURL ?? undefined,
      photoX: this.photoBitmap ? this.photoX : undefined,
      photoY: this.photoBitmap ? this.photoY : undefined,
      photoScale: this.photoBitmap ? this.photoScale : undefined,
    });
    this.editingId = d.id;
    this.onSaved(d);
    showToast("保存しました");
    this.close(); // 保存後は通常表示（その絵を使ったシミュレータ）へ戻る
  }

  // =========================================================
  // PNGダウンロード設定モーダル
  // =========================================================
  private openExportModal(): void {
    this.exportDiameterInput.value = String(this.diskDiameterMm);
    this.updateExportModalUI();
    this.exportModal.classList.remove("hidden");
  }

  private closeExportModal(): void {
    this.exportModal.classList.add("hidden");
  }

  private updateExportModalUI(): void {
    this.exportOutlineBtn.classList.toggle("on", this.exportOutline);
    this.exportOutlineBtn.textContent = `円周ライン：${this.exportOutline ? "あり" : "なし"}`;
    this.exportCenterBtn.classList.toggle("on", this.exportCenterMark);
    this.exportCenterBtn.textContent = `中心マーク：${this.exportCenterMark ? "あり" : "なし"}`;
    this.exportOutlineColorBtns.forEach((btn, color) =>
      btn.classList.toggle("on", color === this.exportOutlineColor),
    );
    this.exportCenterShapeBtns.forEach((btn, shape) =>
      btn.classList.toggle("on", shape === this.exportCenterShape),
    );
    this.exportCenterColorBtns.forEach((btn, color) =>
      btn.classList.toggle("on", color === this.exportCenterColor),
    );
  }

  private buildExportModal(): void {
    const modal = document.createElement("div");
    this.exportModal = modal;
    modal.className = "export-modal hidden";

    const panel = document.createElement("div");
    panel.className = "export-panel";
    panel.onclick = (e) => e.stopPropagation();

    const title = document.createElement("h2");
    title.textContent = "PNGダウンロード設定";

    // 直径
    this.exportDiameterInput = document.createElement("input");
    this.exportDiameterInput.type = "number";
    this.exportDiameterInput.className = "num";
    this.exportDiameterInput.min = String(DISC_DIAMETER_MM_MIN);
    this.exportDiameterInput.max = String(DISC_DIAMETER_MM_MAX);
    this.exportDiameterInput.value = String(this.diskDiameterMm);
    this.exportDiameterInput.oninput = () => {
      const v = Number(this.exportDiameterInput.value);
      if (!Number.isNaN(v)) this.diskDiameterMm = v;
    };
    const diameterRow = document.createElement("div");
    diameterRow.className = "export-row";
    diameterRow.append(label("直径"), this.exportDiameterInput, label("mm"));

    // 円周ライン：あり/なし + 色
    this.exportOutlineBtn = pbtn("円周ライン", () => {
      this.exportOutline = !this.exportOutline;
      this.updateExportModalUI();
    });
    const outlineColorGroup = document.createElement("div");
    outlineColorGroup.className = "export-color-group";
    for (const [name, hex] of [
      ["黒", "#000000"],
      ["白", "#ffffff"],
    ] as const) {
      const b = pbtn(name, () => {
        this.exportOutlineColor = hex;
        this.updateExportModalUI();
      });
      this.exportOutlineColorBtns.set(hex, b);
      outlineColorGroup.append(b);
    }
    const outlineRow = document.createElement("div");
    outlineRow.className = "export-row";
    outlineRow.append(this.exportOutlineBtn, outlineColorGroup);

    // 中心マーク：あり/なし + 形状（ドット/十字）+ 色
    this.exportCenterBtn = pbtn("中心マーク", () => {
      this.exportCenterMark = !this.exportCenterMark;
      this.updateExportModalUI();
    });
    const centerShapeGroup = document.createElement("div");
    centerShapeGroup.className = "export-color-group";
    for (const [name, shape] of [
      ["ドット", "dot"],
      ["十字", "cross"],
    ] as const) {
      const b = pbtn(name, () => {
        this.exportCenterShape = shape;
        this.updateExportModalUI();
      });
      this.exportCenterShapeBtns.set(shape, b);
      centerShapeGroup.append(b);
    }
    const centerColorGroup = document.createElement("div");
    centerColorGroup.className = "export-color-group";
    for (const [name, hex] of [
      ["黒", "#000000"],
      ["白", "#ffffff"],
    ] as const) {
      const b = pbtn(name, () => {
        this.exportCenterColor = hex;
        this.updateExportModalUI();
      });
      this.exportCenterColorBtns.set(hex, b);
      centerColorGroup.append(b);
    }
    const centerRow = document.createElement("div");
    centerRow.className = "export-row";
    centerRow.append(this.exportCenterBtn, centerShapeGroup, centerColorGroup);

    // 実行ボタン
    const actionsRow = document.createElement("div");
    actionsRow.className = "export-actions";
    const downloadBtn = pbtn("ダウンロード", () => this.downloadDisc());
    downloadBtn.classList.add("primary");
    actionsRow.append(downloadBtn, pbtn("キャンセル", () => this.closeExportModal()));

    panel.append(title, diameterRow, outlineRow, centerRow, actionsRow);
    modal.append(panel);
    modal.onclick = () => this.closeExportModal(); // 背景クリックで閉じる
  }

  private downloadDisc(): void {
    const px = Math.round((this.diskDiameterMm / 25.4) * PRINT_DPI);
    const canvas = this.buildFullImageAtSize(px);
    const ctx = canvas.getContext("2d")!;
    const cx = px / 2;
    const cy = px / 2;

    if (this.exportOutline) {
      const lineW = Math.max(1, px * 0.003);
      ctx.strokeStyle = this.exportOutlineColor;
      ctx.lineWidth = lineW;
      ctx.beginPath();
      ctx.arc(cx, cy, px / 2 - lineW / 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (this.exportCenterMark) {
      ctx.fillStyle = this.exportCenterColor;
      ctx.strokeStyle = this.exportCenterColor;
      if (this.exportCenterShape === "dot") {
        const dotR = ((CENTER_DOT_DIAMETER_MM / 2) / 25.4) * PRINT_DPI;
        ctx.beginPath();
        ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const armLen = (CENTER_DOT_DIAMETER_MM / 25.4) * PRINT_DPI;
        ctx.lineWidth = Math.max(1, px * 0.0015);
        ctx.beginPath();
        ctx.moveTo(cx - armLen, cy);
        ctx.lineTo(cx + armLen, cy);
        ctx.moveTo(cx, cy - armLen);
        ctx.lineTo(cx, cy + armLen);
        ctx.stroke();
      }
    }

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `anorthoscope_360_${this.diskDiameterMm}mm.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
    this.closeExportModal();
  }

  // =========================================================
  // 分割数
  // =========================================================
  private setDivisions(k: number): void {
    this.divisions = Math.min(DIV_MAX, Math.max(DIV_MIN, k));
    this.divButtons.forEach((btn, key) =>
      btn.classList.toggle("on", key === this.divisions),
    );
    this.render();
    this.relayout();
  }

  // =========================================================
  // 入力
  // =========================================================
  private toArt(e: PointerEvent): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * PAINT_SIZE;
    const y = ((e.clientY - rect.top) / rect.height) * PAINT_SIZE;
    return [x, y];
  }

  private onDown(e: PointerEvent): void {
    const [x, y] = this.toArt(e);
    if (this.tool === "fill") {
      this.floodFill(x, y);
      return;
    }
    if (this.tool === "photo") {
      if (!this.photoBitmap) return;
      this.canvas.setPointerCapture(e.pointerId);
      this.drawing = true;
      this.startX = x;
      this.startY = y;
      this.dragPhotoX0 = this.photoX;
      this.dragPhotoY0 = this.photoY;
      return;
    }
    if (!this.inWedge(x, y)) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.snapshot();
    this.drawing = true;
    this.startX = this.lastX = this.previewX = x;
    this.startY = this.lastY = this.previewY = y;
    if (this.tool === "brush" || this.tool === "eraser") {
      this.drawSegment(x, y, x, y); // 点打ち
      this.render();
    }
  }

  private onMove(e: PointerEvent): void {
    if (!this.drawing) return;
    const [x, y] = this.toArt(e);
    if (this.tool === "photo") {
      this.photoX = this.dragPhotoX0 + (x - this.startX);
      this.photoY = this.dragPhotoY0 + (y - this.startY);
      this.renderPhoto();
      this.render();
      return;
    }
    if (this.tool === "brush" || this.tool === "eraser") {
      this.drawSegment(this.lastX, this.lastY, x, y);
      this.lastX = x;
      this.lastY = y;
    } else {
      this.previewX = x;
      this.previewY = y;
    }
    this.render();
  }

  private onUp(): void {
    if (!this.drawing) return;
    if (this.tool === "line" || this.tool === "circle") this.commitShape();
    this.drawing = false;
    this.render();
  }

  // =========================================================
  // DOM
  // =========================================================
  private buildDOM(): void {
    this.root = document.createElement("div");
    this.root.id = "paint";
    this.root.className = "hidden";

    const bar = document.createElement("div");
    bar.className = "paint-bar";

    // 画像読み込み（写真そのものを本体コンテンツとして使う）
    const loadGroup = document.createElement("div");
    loadGroup.className = "paint-group";
    const fileBtn = pbtn("＋ファイルから", () => this.fileInput.click());
    fileBtn.classList.add("wide");
    this.fileInput = document.createElement("input");
    this.fileInput.type = "file";
    this.fileInput.accept = "image/png,image/jpeg,image/gif";
    this.fileInput.hidden = true;
    this.fileInput.onchange = () => {
      if (this.fileInput.files && this.fileInput.files.length > 0) {
        this.loadFile(this.fileInput.files);
        this.fileInput.value = "";
      }
    };
    const photoZoomOut = pbtn("－", () => this.zoomPhoto(1 / PHOTO_ZOOM_STEP), "写真を縮小");
    const photoZoomIn = pbtn("＋", () => this.zoomPhoto(PHOTO_ZOOM_STEP), "写真を拡大");
    const photoRemove = pbtn("写真を消す", () => {
      this.clearPhotoState();
      this.render();
    });
    loadGroup.append(fileBtn, this.fileInput, photoZoomOut, photoZoomIn, photoRemove);

    // 分割数
    const divGroup = document.createElement("div");
    divGroup.className = "paint-group";
    divGroup.append(label("分割"));
    for (let k = DIV_MIN; k <= DIV_MAX; k++) {
      const b = pbtn(String(k), () => this.setDivisions(k));
      this.divButtons.set(k, b);
      divGroup.append(b);
    }

    // ツール
    const toolGroup = document.createElement("div");
    toolGroup.className = "paint-group";
    const tools: [Tool, string, string][] = [
      ["brush", "ブラシ", "🖌"],
      ["eraser", "消しゴム", "◧"],
      ["line", "直線", "／"],
      ["circle", "円", "◯"],
      ["fill", "塗り", "塗"],
      ["photo", "写真を移動", "✋"],
    ];
    for (const [t, title, icon] of tools) {
      const b = pbtn(icon, () => this.setTool(t), title);
      this.toolButtons.set(t, b);
      toolGroup.append(b);
    }

    // 色・太さ
    const styleGroup = document.createElement("div");
    styleGroup.className = "paint-group";
    const colorIn = document.createElement("input");
    colorIn.type = "color";
    colorIn.value = this.color;
    colorIn.className = "paint-color";
    colorIn.oninput = () => (this.color = colorIn.value);
    const sizeIn = document.createElement("input");
    sizeIn.type = "range";
    sizeIn.min = "1";
    sizeIn.max = "80";
    sizeIn.value = String(this.size);
    sizeIn.className = "paint-size";
    sizeIn.oninput = () => (this.size = Number(sizeIn.value));

    this.bgInput = document.createElement("input");
    this.bgInput.type = "color";
    this.bgInput.value = this.bgColor;
    this.bgInput.className = "paint-color";
    this.bgInput.title = "背景色";
    this.bgInput.oninput = () => {
      this.bgColor = this.bgInput.value;
      this.render();
    };

    styleGroup.append(
      label("色"),
      colorIn,
      label("太さ"),
      sizeIn,
      label("背景"),
      this.bgInput,
    );

    // 操作
    const actGroup = document.createElement("div");
    actGroup.className = "paint-group";
    actGroup.append(
      pbtn("元に戻す", () => this.undo()),
      pbtn("全消し", () => this.clearAll()),
    );

    // 展開画像のPNG書き出し（詳細設定はモーダルで行う）
    const exportGroup = document.createElement("div");
    exportGroup.className = "paint-group";
    const downloadBtn = pbtn(
      "PNGダウンロード",
      () => this.openExportModal(),
      "展開した360°画像をPNGでダウンロード（印刷用）",
    );
    exportGroup.append(downloadBtn);

    // 保存・閉じる
    const endGroup = document.createElement("div");
    endGroup.className = "paint-group paint-end";
    const saveBtn = pbtn("保存", () => this.save());
    saveBtn.classList.add("primary");
    endGroup.append(saveBtn, pbtn("閉じる", () => this.close()));

    bar.append(loadGroup, divGroup, toolGroup, styleGroup, actGroup, exportGroup, endGroup);

    // キャンバス（左：描画面 / 右：展開プレビュー）
    const stage = document.createElement("div");
    stage.className = "paint-stage";

    this.drawPane = paintPane("描画（この扇形に描く）");
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvas.height = PAINT_SIZE;
    this.canvas.className = "paint-canvas";
    this.dctx = this.canvas.getContext("2d")!;
    this.drawPane.append(this.canvas);

    this.previewPane = paintPane("展開プレビュー（360°へ角度引き伸ばし）");
    this.previewCanvas = document.createElement("canvas");
    this.previewCanvas.width = this.previewCanvas.height = PaintEditor.PREVIEW_RES;
    this.previewCanvas.className = "paint-canvas preview";
    this.pctx = this.previewCanvas.getContext("2d")!;
    this.previewPane.append(this.previewCanvas);

    stage.append(this.drawPane, this.previewPane);

    const hint = document.createElement("div");
    hint.className = "paint-hint";
    hint.textContent =
      "黄色枠の扇形の中だけ描けます。＋ファイルから写真を読み込み、✋ツールで移動、－／＋で拡大縮小できます。保存時、その絵が角度方向に引き伸ばされ、歪んだ1枚の画像になります。";

    this.buildExportModal();
    this.root.append(bar, stage, hint, this.exportModal);
    document.body.append(this.root);

    this.canvas.addEventListener("pointerdown", (e) => this.onDown(e));
    this.canvas.addEventListener("pointermove", (e) => this.onMove(e));
    this.canvas.addEventListener("pointerup", () => this.onUp());
    this.canvas.addEventListener("pointercancel", () => this.onUp());

    // 表示サイズを常に正方形（＝正円）に保つ。ペインの縦横比に依らず
    // 内部解像度と切り離して CSS サイズを JS で決める
    new ResizeObserver(() => this.relayout()).observe(stage);

    this.setTool("brush");
  }

  /** 各キャンバスの表示サイズを、ペインに収まる最大の正方形へ揃える（または縦画面では扇形外接ボックスへフィット） */
  private relayout(): void {
    const isPortrait = window.matchMedia("(orientation: portrait)").matches;
    for (const pane of [this.drawPane, this.previewPane]) {
      if (isPortrait && pane === this.previewPane) continue;
      const canvas = pane.querySelector("canvas") as HTMLCanvasElement | null;
      const paneLabel = pane.firstElementChild as HTMLElement | null;
      if (!canvas || !paneLabel) continue;
      const gap = 8;
      const availW = pane.clientWidth;
      const availH = pane.clientHeight - paneLabel.offsetHeight - gap;

      if (isPortrait && pane === this.drawPane) {
        const { minX, maxX, minY, maxY } = this.wedgeBBox();
        const scale = Math.max(0, Math.min(availW / (maxX - minX), availH / (maxY - minY)));
        canvas.style.width = `${PAINT_SIZE * scale}px`;
        canvas.style.height = `${PAINT_SIZE * scale}px`;
        canvas.style.position = "absolute";
        canvas.style.left = `${availW / 2 - ((minX + maxX) / 2) * scale}px`;
        canvas.style.top = `${availH / 2 - ((minY + maxY) / 2) * scale}px`;
      } else {
        canvas.style.position = "";
        canvas.style.left = "";
        canvas.style.top = "";
        const side = Math.max(0, Math.floor(Math.min(availW, availH)));
        canvas.style.width = `${side}px`;
        canvas.style.height = `${side}px`;
      }
    }
  }

  private setTool(t: Tool): void {
    this.tool = t;
    this.toolButtons.forEach((btn, key) => btn.classList.toggle("on", key === t));
  }
}

// ---- helpers ----
function paintPane(labelText: string): HTMLDivElement {
  const pane = document.createElement("div");
  pane.className = "paint-pane";
  const l = document.createElement("div");
  l.className = "paint-pane-label";
  l.textContent = labelText;
  pane.append(l);
  return pane;
}
function pbtn(text: string, onClick: () => void, title = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "paint-btn";
  b.textContent = text;
  if (title) b.title = title;
  b.onclick = onClick;
  return b;
}
function label(t: string): HTMLElement {
  const s = document.createElement("span");
  s.className = "paint-label";
  s.textContent = t;
  return s;
}
function hexToRgba(hex: string): [number, number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    255,
  ];
}
function sameColor(a: number[], b: number[]): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

// 開発時：このモジュールを編集したら部分 HMR ではなく必ずフルリロードする。
// （PaintEditor は起動時に 1 度だけ生成されるため、部分 HMR だと古いインスタンスが
//   残り、変更が反映されない“幽霊”状態に陥る。それを防ぐ。）
const hot = (import.meta as unknown as { hot?: { invalidate(): void } }).hot;
if (hot) hot.invalidate();
