import {
  CENTER_DOT_DIAMETER_MM,
  COMPRESS_DIV_DEFAULT,
  COMPRESS_DIV_MAX,
  COMPRESS_DIV_MIN,
  DISC_DIAMETER_MM_DEFAULT,
  DISC_DIAMETER_MM_MAX,
  DISC_DIAMETER_MM_MIN,
  PAINT_SIZE,
  PRINT_DPI,
} from "../config";
import { fullToWedge, wedgeToFull } from "../engine/wedge";
import { saveDrawing, type Drawing } from "../gallery";
import { loadFromFiles, pictureFromURL, type Picture } from "../images";
import { loadSlitMask, saveSlitMask } from "../slitMask";
import { ImagePicker } from "./ImagePicker";
import { showToast } from "./toast";

type Tool = "brush" | "eraser" | "line" | "circle" | "fill" | "photo";

const CX = PAINT_SIZE / 2;
const CY = PAINT_SIZE / 2;
const R = PAINT_SIZE / 2;
const CENTER_ANGLE = -Math.PI / 2; // 基準扇形（1ピース）の中心＝真上
const UNDO_LIMIT = 30;
const WEDGE_LIVE_RES = 300; // 左→右の圧縮（fullToWedge）をライブ計算する解像度
const PHOTO_SCALE_MIN = 0.1;
const PHOTO_SCALE_MAX = 8;
const PHOTO_ZOOM_STEP = 1.15;

/**
 * 作画エディタ（旧・圧縮モード）。左右2つの円のどちらにも描ける。
 *
 * - **左＝360°画像**：円内のどこにでも自由に描ける。
 * - **右＝1/K の繰り返しパターン**：分割数 K を考慮して敷き詰めた円盤。
 *   どのピース（扇形）にも描け、描いた内容は基準扇形へ畳み込まれて
 *   全ピースに K 回対称で現れる。
 *
 * 左に描いた内容は右に圧縮（`fullToWedge`）されて全ピースに、
 * 右に描いた内容は左に展開（K 回コピー）されて現れる。両者は合成され、
 * 保存されるのは左の 360°画像そのもの。
 */
export class CompressEditor {
  private readonly onSaved: (d: Drawing) => void;
  private readonly onUseWithoutSaving: (dataURL: string, divisions: number) => void;
  private readonly onSlitMaskChanged: (dataURL: string) => void;
  private readonly onClose: () => void;
  private readonly picker: ImagePicker;
  private getImages: () => Picture[] = () => [];

  private root!: HTMLDivElement;
  private stageEl!: HTMLDivElement;
  private leftPane!: HTMLDivElement;
  private rightPane!: HTMLDivElement;
  private portraitShowLeft = false; // 縦画面での表示切替（既定は右＝繰り返しパターン）
  private leftCanvas!: HTMLCanvasElement; // 左：360°画像（描画可能）
  private leftCtx!: CanvasRenderingContext2D;
  private rightCanvas!: HTMLCanvasElement; // 右：繰り返しパターン（描画可能）
  private rightCtx!: CanvasRenderingContext2D;
  private fileInput!: HTMLInputElement;
  private divInput!: HTMLInputElement;
  private saveBtn!: HTMLButtonElement;
  private bgInput!: HTMLInputElement;
  private toolButtons = new Map<Tool, HTMLButtonElement>();

  // 印刷用PNG書き出し
  private exportModal!: HTMLDivElement;
  private diskDiameterMm = DISC_DIAMETER_MM_DEFAULT;
  private exportOutline = true;
  private exportOutlineColor: "#000000" | "#ffffff" = "#ffffff";
  private exportCenterMark = true;
  private exportCenterShape: "dot" | "cross" = "dot";
  private exportCenterColor: "#000000" | "#ffffff" = "#ffffff";
  private exportDiameterInput!: HTMLInputElement;
  private exportOutlineBtn!: HTMLButtonElement;
  private readonly exportOutlineColorBtns = new Map<string, HTMLButtonElement>();
  private exportCenterBtn!: HTMLButtonElement;
  private readonly exportCenterShapeBtns = new Map<string, HTMLButtonElement>();
  private readonly exportCenterColorBtns = new Map<string, HTMLButtonElement>();

  // スリット形状（スリット板の穴の形を、1/n のピザ型で手描きカスタマイズ。
  // 左右の円とは独立したグローバル設定）
  private getNumSlits: () => number = () => 4;
  private slitShapeModal!: HTMLDivElement;
  private slitShapeCanvas!: HTMLCanvasElement; // 実データ（保存対象）
  private slitShapeCtx!: CanvasRenderingContext2D;
  private slitShapeGuideCanvas!: HTMLCanvasElement; // 扇形の輪郭ガイド（非保存・操作不可のオーバーレイ）
  private slitShapeGuideCtx!: CanvasRenderingContext2D;
  private slitShapeUndoStack: ImageData[] = [];
  private slitShapeDrawing = false;
  private slitShapeErase = false;
  private slitShapeEraseBtn!: HTMLButtonElement;
  private slitShapeSize = 14;
  private slitShapeLastX = 0;
  private slitShapeLastY = 0;

  // 読み込んだ画像（PAINT_SIZE 四方に letterbox 済み、写真レイヤー）
  private readonly src = document.createElement("canvas");
  private readonly sctx: CanvasRenderingContext2D;
  private hasImage = false;

  // 左に描く手描きレイヤー（360°、透明背景）
  private readonly fullArt = document.createElement("canvas");
  private readonly fctx: CanvasRenderingContext2D;
  // 右に描く手描きレイヤー（基準扇形＝1ピース分だけ。透明背景）
  private readonly wedgeArt = document.createElement("canvas");
  private readonly wctx: CanvasRenderingContext2D;
  // 右（扇形）に配置する写真（自分で描いた絵・撮影した画像）。移動・拡大縮小可、扇形にクリップ
  private readonly wedgePhoto = document.createElement("canvas");
  private readonly photoCtx: CanvasRenderingContext2D;
  private photoBitmap: ImageBitmap | null = null;
  private photoNaturalW = 0;
  private photoNaturalH = 0;
  private photoBaseScale = 1; // 読み込み時のフィット倍率
  private photoX = 0; // 基準扇形の中心からのオフセット（PAINT_SIZE 単位）
  private photoY = 0;
  private photoScale = 1; // フィット表示を 1.0 とする追加倍率

  // 画像読み込みモーダル（単一ボタン→左/右をタブで選ぶ）
  private loadModal!: HTMLDivElement;
  private loadTarget: "left" | "right" = "left";
  private loadTabLeftBtn!: HTMLButtonElement;
  private loadTabRightBtn!: HTMLButtonElement;
  private loadHint!: HTMLDivElement;

  // 左（写真＋fullArt）を fullToWedge へ渡す作業用
  private readonly work = document.createElement("canvas");
  private readonly workCtx: CanvasRenderingContext2D;
  private readonly previewSrc = document.createElement("canvas");
  private readonly previewSrcCtx: CanvasRenderingContext2D;
  private readonly tmp = document.createElement("canvas");
  private readonly tctx: CanvasRenderingContext2D;
  // 左の内容を圧縮した基準扇形（フル解像度へ拡大したもの）のキャッシュ
  private readonly fullWedge = document.createElement("canvas");
  private readonly fullWedgeCtx: CanvasRenderingContext2D;
  // fullWedge ＋ wedgeArt を合成した「右の基準扇形」
  private readonly combine = document.createElement("canvas");
  private readonly combineCtx: CanvasRenderingContext2D;
  private fullDirty = true; // 左の内容が変わった＝fullToWedge の再計算が必要
  // 右（扇形）に描いた内容を 360° へ展開（wedgeToFull）したキャッシュ（左表示用）
  private readonly expandSrc = document.createElement("canvas");
  private readonly expandSrcCtx: CanvasRenderingContext2D;
  private readonly expandTmp = document.createElement("canvas");
  private readonly expandTmpCtx: CanvasRenderingContext2D;
  private readonly expandWedge = document.createElement("canvas");
  private readonly expandWedgeCtx: CanvasRenderingContext2D;
  private wedgeDirty = true; // 右の内容が変わった＝wedgeToFull の再計算が必要
  private editingId: string | null = null; // 再編集中の作品ID（保存で上書き）

  private rightDirty = false;
  private rightScheduled = false;

  private divisions = COMPRESS_DIV_DEFAULT;
  private bgColor = "#000000";
  private tool: Tool = "brush";
  private color = "#ffd23c";
  private size = 14;

  // 描画中の状態
  private drawing = false;
  private activeCtx: CanvasRenderingContext2D | null = null;
  private activeCanvas: HTMLCanvasElement | null = null;
  private activeIsWedge = false;
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;
  private previewX = 0;
  private previewY = 0;
  private lastFoldK = 0; // 直前に描いた点のピース番号（境界またぎ検出用）
  private undoStack: { ctx: CanvasRenderingContext2D; data: ImageData }[] = [];

  constructor(
    onSaved: (d: Drawing) => void,
    onUseWithoutSaving: (dataURL: string, divisions: number) => void,
    onSlitMaskChanged: (dataURL: string) => void,
    onClose: () => void,
  ) {
    this.onSaved = onSaved;
    this.onUseWithoutSaving = onUseWithoutSaving;
    this.onSlitMaskChanged = onSlitMaskChanged;
    this.onClose = onClose;
    for (const c of [
      this.src,
      this.fullArt,
      this.wedgeArt,
      this.wedgePhoto,
      this.work,
      this.fullWedge,
      this.combine,
      this.expandWedge,
    ]) {
      c.width = c.height = PAINT_SIZE;
    }
    this.sctx = this.src.getContext("2d")!;
    this.fctx = this.fullArt.getContext("2d")!;
    this.wctx = this.wedgeArt.getContext("2d")!;
    this.photoCtx = this.wedgePhoto.getContext("2d")!;
    this.workCtx = this.work.getContext("2d")!;
    this.fullWedgeCtx = this.fullWedge.getContext("2d")!;
    this.combineCtx = this.combine.getContext("2d")!;
    this.expandWedgeCtx = this.expandWedge.getContext("2d")!;
    this.previewSrc.width = this.previewSrc.height = WEDGE_LIVE_RES;
    this.previewSrcCtx = this.previewSrc.getContext("2d")!;
    this.tmp.width = this.tmp.height = WEDGE_LIVE_RES;
    this.tctx = this.tmp.getContext("2d")!;
    this.expandSrc.width = this.expandSrc.height = WEDGE_LIVE_RES;
    this.expandSrcCtx = this.expandSrc.getContext("2d")!;
    this.expandTmp.width = this.expandTmp.height = WEDGE_LIVE_RES;
    this.expandTmpCtx = this.expandTmp.getContext("2d")!;
    this.picker = new ImagePicker(
      (i) => {
        const pic = this.getImages()[i];
        if (!pic) return;
        if (this.loadTarget === "left") this.loadPicture(pic);
        else this.loadWedgePhoto(pic);
      },
      "画像を選ぶ",
      "compress-picker",
    );
    this.buildDOM();
  }

  bind(getImages: () => Picture[]): void {
    this.getImages = getImages;
    this.picker.bind(getImages, () => -1);
  }

  /** スリット形状編集の扇形（1/n）を決めるため、現在のスリット数を参照できるようにする */
  bindNumSlits(getNumSlits: () => number): void {
    this.getNumSlits = getNumSlits;
  }

  // =========================================================
  // 公開 API
  // =========================================================
  /** 引数なし＝新規（白紙）。作品を渡すと、その絵を下地に読み込んで再編集する。 */
  open(d?: Drawing): void {
    this.resetState(d);
    this.root.classList.remove("hidden");
    requestAnimationFrame(() => this.relayout());
    this.render();
    if (d) {
      // 保存済みの360°画像を下地（写真レイヤー）として読み込む
      pictureFromURL(d.dataURL, d.name).then((pic) => this.loadPicture(pic)).catch(() => {});
    }
  }

  private resetState(d?: Drawing): void {
    this.fctx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    this.wctx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    this.sctx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    this.photoCtx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    this.photoBitmap = null;
    this.photoX = 0;
    this.photoY = 0;
    this.photoScale = 1;
    this.hasImage = false;
    this.undoStack = [];
    this.fullDirty = true;
    this.wedgeDirty = true;
    this.editingId = d?.id ?? null;
    this.divisions = d?.divisions ?? COMPRESS_DIV_DEFAULT;
    this.divInput.value = String(this.divisions);
    this.bgColor = d?.bg ?? "#000000";
    this.bgInput.value = this.bgColor;
    // 縦画面の表示は毎回、右（繰り返しパターン）を優先表示にリセットする
    this.portraitShowLeft = false;
    this.stageEl.classList.remove("show-left");
  }

  close(): void {
    this.root.classList.add("hidden");
    this.onClose();
  }

  // =========================================================
  // 画像読み込み（左＝360°の下絵として）
  // =========================================================
  private loadPicture(pic: Picture | undefined): void {
    if (!pic) return;
    this.sctx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    const s = Math.min(PAINT_SIZE / pic.width, PAINT_SIZE / pic.height);
    const w = pic.width * s;
    const h = pic.height * s;
    this.sctx.drawImage(pic.bitmap, (PAINT_SIZE - w) / 2, (PAINT_SIZE - h) / 2, w, h);
    this.hasImage = true;
    this.fullDirty = true;
    this.render();
  }

  private async loadFile(files: FileList): Promise<void> {
    const pics = await loadFromFiles(files);
    if (pics.length > 0) this.loadPicture(pics[0]);
  }

  // =========================================================
  // 画像読み込み（右＝扇形の中に配置する写真。移動・拡大縮小が可能）
  // =========================================================
  private loadWedgePhoto(pic: Picture): void {
    this.photoBitmap = pic.bitmap;
    this.photoNaturalW = pic.width;
    this.photoNaturalH = pic.height;
    this.photoBaseScale = Math.min(PAINT_SIZE / pic.width, PAINT_SIZE / pic.height);
    this.photoX = 0;
    this.photoY = 0;
    this.photoScale = 1;
    this.renderWedgePhoto();
    this.wedgeDirty = true;
    this.render();
  }

  private async loadWedgePhotoFile(files: FileList): Promise<void> {
    const pics = await loadFromFiles(files);
    if (pics.length > 0) this.loadWedgePhoto(pics[0]);
  }

  private clearWedgePhoto(): void {
    this.photoBitmap = null;
    this.photoX = 0;
    this.photoY = 0;
    this.photoScale = 1;
    this.photoCtx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    this.wedgeDirty = true;
    this.render();
  }

  /** 現在の位置・拡大率で wedgePhoto を描き直す（基準扇形にクリップ） */
  private renderWedgePhoto(): void {
    this.photoCtx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    if (!this.photoBitmap) return;
    const w = this.photoNaturalW * this.photoBaseScale * this.photoScale;
    const h = this.photoNaturalH * this.photoBaseScale * this.photoScale;
    this.photoCtx.save();
    this.wedgeClip(this.photoCtx);
    this.photoCtx.drawImage(this.photoBitmap, CX + this.photoX - w / 2, CY + this.photoY - h / 2, w, h);
    this.photoCtx.restore();
  }

  private zoomWedgePhoto(factor: number): void {
    if (!this.photoBitmap) return;
    this.photoScale = Math.min(PHOTO_SCALE_MAX, Math.max(PHOTO_SCALE_MIN, this.photoScale * factor));
    this.renderWedgePhoto();
    this.wedgeDirty = true;
    this.render();
  }

  // =========================================================
  // 幾何
  // =========================================================
  private get wedgeAngle(): number {
    return (Math.PI * 2) / this.divisions;
  }

  /** 円内判定（左：全周どこでも可） */
  private inCircle(x: number, y: number): boolean {
    return Math.hypot(x - CX, y - CY) <= R;
  }

  /** 基準扇形（上向き1ピース）内判定 */
  private inWedge(x: number, y: number): boolean {
    const dx = x - CX;
    const dy = y - CY;
    if (Math.hypot(dx, dy) > R) return false;
    const rel = norm(Math.atan2(dy, dx) - CENTER_ANGLE);
    return Math.abs(rel) <= this.wedgeAngle / 2 + 1e-6;
  }

  /** 任意ピース上の点を、基準扇形（上向き）へ回転で畳み込む。
   *  返り値の3つ目はピース番号 k（境界をまたいだ検出＝線を途切れさせるために使う）。 */
  private foldToWedge(x: number, y: number): [number, number, number] {
    const dx = x - CX;
    const dy = y - CY;
    const r = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    const seg = this.wedgeAngle;
    const k = Math.round(norm(ang - CENTER_ANGLE) / seg);
    const folded = ang - k * seg;
    return [CX + r * Math.cos(folded), CY + r * Math.sin(folded), k];
  }

  private wedgePathAt(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number): void {
    const half = this.wedgeAngle / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, CENTER_ANGLE - half, CENTER_ANGLE + half);
    ctx.closePath();
  }

  private circleClip(ctx: CanvasRenderingContext2D): void {
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, Math.PI * 2);
    ctx.clip();
  }

  private wedgeClip(ctx: CanvasRenderingContext2D): void {
    this.wedgePathAt(ctx, CX, CY, R);
    ctx.clip();
  }

  private activeClip(ctx: CanvasRenderingContext2D): void {
    if (this.activeIsWedge) this.wedgeClip(ctx);
    else this.circleClip(ctx);
  }

  // =========================================================
  // 手描き
  // =========================================================
  private snapshot(ctx: CanvasRenderingContext2D): void {
    this.undoStack.push({ ctx, data: ctx.getImageData(0, 0, PAINT_SIZE, PAINT_SIZE) });
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
  }

  private undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    prev.ctx.putImageData(prev.data, 0, 0);
    if (prev.ctx === this.fctx) this.fullDirty = true;
    if (prev.ctx === this.wctx) this.wedgeDirty = true;
    this.render();
  }

  private clearArt(): void {
    this.snapshot(this.fctx);
    this.snapshot(this.wctx);
    this.fctx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    this.wctx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    this.fullDirty = true;
    this.wedgeDirty = true;
    this.render();
  }

  private strokeStyle(ctx: CanvasRenderingContext2D): void {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = this.size;
    ctx.strokeStyle = this.color;
    ctx.fillStyle = this.color;
  }

  private drawSegment(x0: number, y0: number, x1: number, y1: number): void {
    const ctx = this.activeCtx!;
    ctx.save();
    this.activeClip(ctx);
    ctx.globalCompositeOperation = this.tool === "eraser" ? "destination-out" : "source-over";
    this.strokeStyle(ctx);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
  }

  private commitShape(): void {
    const ctx = this.activeCtx!;
    ctx.save();
    this.activeClip(ctx);
    ctx.globalCompositeOperation = "source-over";
    this.strokeStyle(ctx);
    ctx.beginPath();
    if (this.tool === "line") {
      ctx.moveTo(this.startX, this.startY);
      ctx.lineTo(this.previewX, this.previewY);
    } else {
      ctx.arc(
        this.startX,
        this.startY,
        Math.hypot(this.previewX - this.startX, this.previewY - this.startY),
        0,
        Math.PI * 2,
      );
    }
    ctx.stroke();
    ctx.restore();
  }

  private floodFill(
    ctx: CanvasRenderingContext2D,
    inBounds: (x: number, y: number) => boolean,
    sx: number,
    sy: number,
  ): void {
    const ix = Math.round(sx);
    const iy = Math.round(sy);
    if (!inBounds(ix, iy)) return;
    this.snapshot(ctx);

    const img = ctx.getImageData(0, 0, PAINT_SIZE, PAINT_SIZE);
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
      if (!inBounds(x, y)) continue;
      const i = at(x, y);
      if (!match(i)) continue;
      data[i] = fill[0];
      data[i + 1] = fill[1];
      data[i + 2] = fill[2];
      data[i + 3] = fill[3];
      stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }
    ctx.putImageData(img, 0, 0);
  }

  /** 基準扇形の1ピースを、中心を軸に K 回コピーして全周へ敷き詰める */
  private tileWedge(ctx: CanvasRenderingContext2D, N: number, wedgeCanvas: HTMLCanvasElement): void {
    const c = N / 2;
    for (let i = 0; i < this.divisions; i++) {
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate((i * 2 * Math.PI) / this.divisions);
      ctx.translate(-c, -c);
      ctx.drawImage(wedgeCanvas, 0, 0);
      ctx.restore();
    }
  }

  // =========================================================
  // 表示
  // =========================================================
  private render(): void {
    this.renderLeft();
    this.scheduleRight();
  }

  /** 左＝360°画像。写真＋fullArt に、右で描いた扇形を円周方向へ展開（wedgeToFull）して重ねる */
  private renderLeft(): void {
    if (this.wedgeDirty) this.computeExpand();
    const ctx = this.leftCtx;
    ctx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    ctx.save();
    this.circleClip(ctx);
    ctx.fillStyle = this.bgColor;
    ctx.fillRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    if (this.hasImage) ctx.drawImage(this.src, 0, 0);
    ctx.drawImage(this.fullArt, 0, 0);
    ctx.drawImage(this.expandWedge, 0, 0);
    ctx.restore();
    this.drawDrawableRing(ctx);
  }

  /** 右（扇形）で描いた内容を 360° へ展開した結果を expandWedge に用意する（ライブ解像度） */
  private computeExpand(): void {
    const N = WEDGE_LIVE_RES;
    this.expandSrcCtx.clearRect(0, 0, N, N);
    this.expandSrcCtx.drawImage(this.wedgePhoto, 0, 0, N, N);
    this.expandSrcCtx.drawImage(this.wedgeArt, 0, 0, N, N);
    const full = wedgeToFull(
      this.expandSrcCtx.getImageData(0, 0, N, N),
      N,
      N,
      this.divisions,
    );
    this.expandTmpCtx.clearRect(0, 0, N, N);
    this.expandTmpCtx.putImageData(full, 0, 0);
    this.expandWedgeCtx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    this.expandWedgeCtx.drawImage(this.expandTmp, 0, 0, PAINT_SIZE, PAINT_SIZE);
    this.wedgeDirty = false;
  }

  private scheduleRight(): void {
    this.rightDirty = true;
    if (this.rightScheduled) return;
    this.rightScheduled = true;
    requestAnimationFrame(() => {
      this.rightScheduled = false;
      if (!this.rightDirty) return;
      this.rightDirty = false;
      this.computeRight();
    });
  }

  /** 右＝繰り返しパターン。左の圧縮結果＋右で描いた扇形を、K回コピーで敷き詰める */
  private computeRight(): void {
    if (this.fullDirty) {
      // 左（写真＋fullArt）を基準扇形へ圧縮（低解像度で高速に）
      this.workCtx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
      if (this.hasImage) this.workCtx.drawImage(this.src, 0, 0);
      this.workCtx.drawImage(this.fullArt, 0, 0);
      const N = WEDGE_LIVE_RES;
      this.previewSrcCtx.clearRect(0, 0, N, N);
      this.previewSrcCtx.drawImage(this.work, 0, 0, N, N);
      const wedge = fullToWedge(this.previewSrcCtx.getImageData(0, 0, N, N), N, this.divisions);
      this.tctx.clearRect(0, 0, N, N);
      this.tctx.putImageData(wedge, 0, 0);
      this.fullWedgeCtx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
      this.fullWedgeCtx.drawImage(this.tmp, 0, 0, PAINT_SIZE, PAINT_SIZE);
      this.fullDirty = false;
    }

    // 右の基準扇形 ＝ 左の圧縮結果 ＋ 右に配置した写真 ＋ 右で描いた wedgeArt
    this.combineCtx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    this.combineCtx.drawImage(this.fullWedge, 0, 0);
    this.combineCtx.drawImage(this.wedgePhoto, 0, 0);
    this.combineCtx.drawImage(this.wedgeArt, 0, 0);

    const ctx = this.rightCtx;
    ctx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    ctx.save();
    this.circleClip(ctx);
    ctx.fillStyle = this.bgColor;
    ctx.fillRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    this.tileWedge(ctx, PAINT_SIZE, this.combine);
    ctx.restore();
    this.drawPieceLines(ctx);
    this.drawDrawableRing(ctx);
  }

  /** ピースの区切り線（つなぎ目の確認用） */
  private drawPieceLines(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < this.divisions; i++) {
      const a = CENTER_ANGLE + this.wedgeAngle / 2 + i * this.wedgeAngle;
      ctx.beginPath();
      ctx.moveTo(CX, CY);
      ctx.lineTo(CX + Math.cos(a) * R, CY + Math.sin(a) * R);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 描画可能を示す黄色の縁取り */
  private drawDrawableRing(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.strokeStyle = "rgba(255,210,60,0.95)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(CX, CY, R - 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // =========================================================
  // 分割数
  // =========================================================
  private setDivisions(k: number): void {
    const next = Math.min(COMPRESS_DIV_MAX, Math.max(COMPRESS_DIV_MIN, Math.round(k)));
    if (next === this.divisions) return;
    // 右の内容（wedgeArt・配置した写真）は旧分割数の扇形基準なので、新しい分割数では
    // 形状が合わなくなる。まず「今、左に見えている絵」（fullArt ＋ 旧分割数での
    // 右の展開）をそのまま左画像として焼き込み、右の手描きレイヤー・写真は破棄する。
    // 新しい分割数での右側は、この左画像を基準に生成し直す。
    this.snapshot(this.fctx);
    this.snapshot(this.wctx);
    if (this.wedgeDirty) this.computeExpand(); // 現在（旧）分割数での展開を最新化
    this.fctx.drawImage(this.expandWedge, 0, 0);
    this.wctx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    this.photoBitmap = null;
    this.photoX = 0;
    this.photoY = 0;
    this.photoScale = 1;
    this.photoCtx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);

    this.divisions = next;
    this.divInput.value = String(this.divisions);
    this.fullDirty = true;
    this.wedgeDirty = true;
    this.render();
  }

  // =========================================================
  // 入力
  // =========================================================
  private toCanvas(e: PointerEvent, canvas: HTMLCanvasElement): [number, number] {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * PAINT_SIZE;
    const y = ((e.clientY - rect.top) / rect.height) * PAINT_SIZE;
    return [x, y];
  }

  private onDown(e: PointerEvent, isWedge: boolean): void {
    const canvas = isWedge ? this.rightCanvas : this.leftCanvas;
    let [x, y] = this.toCanvas(e, canvas);
    if (isWedge) {
      const f = this.foldToWedge(x, y);
      x = f[0];
      y = f[1];
      this.lastFoldK = f[2];
    }
    if (this.tool === "photo") {
      if (!isWedge || !this.photoBitmap || !this.inWedge(x, y)) return;
      canvas.setPointerCapture(e.pointerId);
      this.drawing = true;
      this.activeIsWedge = true;
      this.activeCanvas = canvas;
      this.activeCtx = null;
      this.startX = this.lastX = x;
      this.startY = this.lastY = y;
      return;
    }

    const ctx = isWedge ? this.wctx : this.fctx;
    const inBounds = isWedge ? (a: number, b: number) => this.inWedge(a, b) : (a: number, b: number) => this.inCircle(a, b);

    if (this.tool === "fill") {
      this.floodFill(ctx, inBounds, x, y);
      if (isWedge) this.wedgeDirty = true;
      else this.fullDirty = true;
      this.render();
      return;
    }
    if (!inBounds(x, y)) return;

    canvas.setPointerCapture(e.pointerId);
    this.drawing = true;
    this.activeIsWedge = isWedge;
    this.activeCanvas = canvas;
    this.activeCtx = ctx;
    this.snapshot(ctx);
    this.startX = this.lastX = this.previewX = x;
    this.startY = this.lastY = this.previewY = y;
    if (this.tool === "brush" || this.tool === "eraser") {
      this.drawSegment(x, y, x, y);
      if (isWedge) this.wedgeDirty = true;
      else this.fullDirty = true;
      this.render();
    }
  }

  private onMove(e: PointerEvent): void {
    if (!this.drawing || !this.activeCanvas) return;
    let [x, y] = this.toCanvas(e, this.activeCanvas);
    // 右（繰り返しパターン）でピース境界をまたいだら、畳み込み先が扇形の反対側へ
    // 飛ぶ。そのまま直線で結ぶと「描いていない直線」が現れるので、境界またぎ時は
    // 線を繋がず途切れさせる（＝実際に描いた形だけが残る）。
    let crossedBoundary = false;
    if (this.activeIsWedge) {
      const f = this.foldToWedge(x, y);
      x = f[0];
      y = f[1];
      if (f[2] !== this.lastFoldK) crossedBoundary = true;
      this.lastFoldK = f[2];
    }
    if (this.tool === "photo") {
      if (!crossedBoundary) {
        this.photoX += x - this.lastX;
        this.photoY += y - this.lastY;
        this.renderWedgePhoto();
      }
      this.lastX = x;
      this.lastY = y;
      this.wedgeDirty = true;
      this.render();
      return;
    }
    if (this.tool === "brush" || this.tool === "eraser") {
      if (!crossedBoundary) this.drawSegment(this.lastX, this.lastY, x, y);
      this.lastX = x;
      this.lastY = y;
    } else {
      this.previewX = x;
      this.previewY = y;
    }
    if (this.activeIsWedge) this.wedgeDirty = true;
    else this.fullDirty = true;
    this.render();
  }

  private onUp(): void {
    if (!this.drawing) return;
    if (this.tool === "line" || this.tool === "circle") {
      this.commitShape();
      if (this.activeIsWedge) this.wedgeDirty = true;
      else this.fullDirty = true;
    }
    this.drawing = false;
    this.activeCtx = null;
    this.activeCanvas = null;
    this.render();
  }

  private setTool(t: Tool): void {
    this.tool = t;
    this.toolButtons.forEach((btn, key) => btn.classList.toggle("on", key === t));
  }

  // =========================================================
  // 合成（左の 360°画像そのもの）を任意解像度で生成
  // =========================================================
  private buildDiscAtSize(N: number): HTMLCanvasElement {
    // 右の扇形（配置した写真＋手描き線）を、保存用にフル解像度で 360° へ展開（wedgeToFull）する
    const ownWedge = document.createElement("canvas");
    ownWedge.width = ownWedge.height = PAINT_SIZE;
    const ownCtx = ownWedge.getContext("2d")!;
    ownCtx.drawImage(this.wedgePhoto, 0, 0);
    ownCtx.drawImage(this.wedgeArt, 0, 0);
    const expanded = wedgeToFull(
      ownCtx.getImageData(0, 0, PAINT_SIZE, PAINT_SIZE),
      PAINT_SIZE,
      PAINT_SIZE,
      this.divisions,
    );
    const expandedCanvas = document.createElement("canvas");
    expandedCanvas.width = expandedCanvas.height = PAINT_SIZE;
    expandedCanvas.getContext("2d")!.putImageData(expanded, 0, 0);

    const out = document.createElement("canvas");
    out.width = out.height = N;
    const ctx = out.getContext("2d")!;
    ctx.save();
    ctx.beginPath();
    ctx.arc(N / 2, N / 2, N / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.scale(N / PAINT_SIZE, N / PAINT_SIZE); // 以降は PAINT_SIZE 座標系で描く
    ctx.fillStyle = this.bgColor;
    ctx.fillRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    if (this.hasImage) ctx.drawImage(this.src, 0, 0);
    ctx.drawImage(this.fullArt, 0, 0);
    ctx.drawImage(expandedCanvas, 0, 0);
    ctx.restore();
    return out;
  }

  // =========================================================
  // 保存（ギャラリーへ）
  // =========================================================
  private save(): void {
    const dataURL = this.buildDiscAtSize(PAINT_SIZE).toDataURL("image/png");
    const d = saveDrawing({
      id: this.editingId ?? undefined,
      dataURL,
      bg: this.bgColor,
      divisions: this.divisions,
    });
    this.onSaved(d);
    showToast("保存しました");
    this.close();
  }

  /** ギャラリーには保存せず、今の絵を一時的にシミュレータへ反映するだけ（リロードで消える） */
  private useWithoutSaving(): void {
    const dataURL = this.buildDiscAtSize(PAINT_SIZE).toDataURL("image/png");
    this.onUseWithoutSaving(dataURL, this.divisions);
    this.close();
  }

  // =========================================================
  // 画像読み込みモーダル（原盤＝左／写真配置＝右をタブで選ぶ）
  // =========================================================
  private openLoadModal(): void {
    this.updateLoadModalUI();
    this.loadModal.classList.remove("hidden");
  }

  private closeLoadModal(): void {
    this.loadModal.classList.add("hidden");
  }

  private setLoadTarget(t: "left" | "right"): void {
    this.loadTarget = t;
    this.updateLoadModalUI();
  }

  private updateLoadModalUI(): void {
    this.loadTabLeftBtn.classList.toggle("on", this.loadTarget === "left");
    this.loadTabRightBtn.classList.toggle("on", this.loadTarget === "right");
    this.loadHint.textContent =
      this.loadTarget === "left"
        ? "あらかじめ歪ませた360°原盤を、左にそのまま読み込みます。"
        : "自分で描いた絵や撮影した写真を、右の扇形の中に配置します（はみ出た部分は自動的に除外。あとで✋ツールと＋／－で位置・大きさを調整できます）。";
  }

  private buildLoadModal(): void {
    const modal = document.createElement("div");
    this.loadModal = modal;
    modal.className = "export-modal hidden";

    const panel = document.createElement("div");
    panel.className = "export-panel";
    panel.onclick = (e) => e.stopPropagation();

    const title = document.createElement("h2");
    title.textContent = "画像を読み込む";

    const tabRow = document.createElement("div");
    tabRow.className = "export-row";
    this.loadTabLeftBtn = pbtn("原盤（左へ）", () => this.setLoadTarget("left"));
    this.loadTabRightBtn = pbtn("写真配置（右へ）", () => this.setLoadTarget("right"));
    tabRow.append(this.loadTabLeftBtn, this.loadTabRightBtn);

    this.loadHint = document.createElement("div");
    this.loadHint.className = "paint-hint";

    const actionsRow = document.createElement("div");
    actionsRow.className = "export-row";
    const pickBtn = pbtn("🖼 画像一覧から選ぶ", () => {
      this.closeLoadModal();
      this.picker.show();
    });
    const fileBtn = pbtn("＋ファイルから", () => {
      this.closeLoadModal();
      this.fileInput.click();
    });
    actionsRow.append(pickBtn, fileBtn);

    const closeRow = document.createElement("div");
    closeRow.className = "export-actions";
    closeRow.append(pbtn("閉じる", () => this.closeLoadModal()));

    panel.append(title, tabRow, this.loadHint, actionsRow, closeRow);
    modal.append(panel);
    modal.onclick = () => this.closeLoadModal(); // 背景クリックで閉じる
  }

  // =========================================================
  // 印刷用PNG書き出し（直径mm指定・円周ライン・中心マーク）
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
    const canvas = this.buildDiscAtSize(px);
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
  // スリット形状（スリット板の穴の形を、1/n のピザ型で手描きカスタマイズ）
  // =========================================================
  /** 編集中のスリット数 n（起動時の現在値で固定。半角 = π/n） */
  private get slitShapeHalfAngle(): number {
    return Math.PI / Math.max(1, this.getNumSlits());
  }

  private slitShapeWedgePath(ctx: CanvasRenderingContext2D): void {
    const half = this.slitShapeHalfAngle;
    ctx.beginPath();
    ctx.moveTo(CX, CY);
    ctx.arc(CX, CY, R, CENTER_ANGLE - half, CENTER_ANGLE + half);
    ctx.closePath();
  }

  private inSlitShapeWedge(x: number, y: number): boolean {
    const dx = x - CX;
    const dy = y - CY;
    if (Math.hypot(dx, dy) > R) return false;
    const rel = norm(Math.atan2(dy, dx) - CENTER_ANGLE);
    return Math.abs(rel) <= this.slitShapeHalfAngle + 1e-6;
  }

  /** 既定の直線スリット（扇形の中心線に沿った帯）を描く */
  private drawDefaultSlitShape(): void {
    const ctx = this.slitShapeCtx;
    ctx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    ctx.strokeStyle = "#fff";
    ctx.lineCap = "round";
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(CX, CY);
    ctx.lineTo(CX + Math.cos(CENTER_ANGLE) * R, CY + Math.sin(CENTER_ANGLE) * R);
    ctx.stroke();
  }

  /** 扇形の輪郭・円周をガイドとして描く（保存対象には含まれない別レイヤー） */
  private drawSlitShapeGuide(): void {
    const ctx = this.slitShapeGuideCtx;
    ctx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    ctx.save();
    ctx.strokeStyle = "rgba(255,210,60,0.9)";
    ctx.lineWidth = 2.5;
    this.slitShapeWedgePath(ctx);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(CX, CY, R - 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private openSlitShapeModal(): void {
    const saved = loadSlitMask();
    if (saved) {
      const img = new Image();
      img.onload = () => {
        this.slitShapeCtx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
        this.slitShapeCtx.drawImage(img, 0, 0, PAINT_SIZE, PAINT_SIZE);
      };
      img.src = saved;
    } else {
      this.drawDefaultSlitShape();
    }
    this.drawSlitShapeGuide();
    this.slitShapeUndoStack = [];
    this.slitShapeModal.classList.remove("hidden");
  }

  private closeSlitShapeModal(): void {
    this.slitShapeModal.classList.add("hidden");
  }

  private slitShapeToCanvas(e: PointerEvent): [number, number] {
    const rect = this.slitShapeCanvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * PAINT_SIZE;
    const y = ((e.clientY - rect.top) / rect.height) * PAINT_SIZE;
    return [x, y];
  }

  private snapshotSlitShape(): void {
    this.slitShapeUndoStack.push(this.slitShapeCtx.getImageData(0, 0, PAINT_SIZE, PAINT_SIZE));
    if (this.slitShapeUndoStack.length > UNDO_LIMIT) this.slitShapeUndoStack.shift();
  }

  private slitShapeStroke(x0: number, y0: number, x1: number, y1: number): void {
    const ctx = this.slitShapeCtx;
    ctx.save();
    this.slitShapeWedgePath(ctx);
    ctx.clip();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = this.slitShapeSize;
    ctx.globalCompositeOperation = this.slitShapeErase ? "destination-out" : "source-over";
    ctx.strokeStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
  }

  private slitShapeOnDown(e: PointerEvent): void {
    const [x, y] = this.slitShapeToCanvas(e);
    if (!this.inSlitShapeWedge(x, y)) return;
    this.slitShapeCanvas.setPointerCapture(e.pointerId);
    this.snapshotSlitShape();
    this.slitShapeDrawing = true;
    this.slitShapeLastX = x;
    this.slitShapeLastY = y;
    this.slitShapeStroke(x, y, x, y);
  }

  private slitShapeOnMove(e: PointerEvent): void {
    if (!this.slitShapeDrawing) return;
    const [x, y] = this.slitShapeToCanvas(e);
    this.slitShapeStroke(this.slitShapeLastX, this.slitShapeLastY, x, y);
    this.slitShapeLastX = x;
    this.slitShapeLastY = y;
  }

  private slitShapeOnUp(): void {
    this.slitShapeDrawing = false;
  }

  private undoSlitShape(): void {
    const prev = this.slitShapeUndoStack.pop();
    if (!prev) return;
    this.slitShapeCtx.putImageData(prev, 0, 0);
  }

  private clearSlitShapeToBlank(): void {
    this.snapshotSlitShape();
    this.slitShapeCtx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
  }

  private resetSlitShapeToDefault(): void {
    this.snapshotSlitShape();
    this.drawDefaultSlitShape();
  }

  private saveSlitShape(): void {
    const dataURL = this.slitShapeCanvas.toDataURL("image/png");
    saveSlitMask(dataURL);
    this.onSlitMaskChanged(dataURL);
    showToast("スリット形状を保存しました");
    this.closeSlitShapeModal();
  }

  private buildSlitShapeModal(): void {
    const modal = document.createElement("div");
    this.slitShapeModal = modal;
    modal.className = "export-modal hidden";

    const panel = document.createElement("div");
    panel.className = "export-panel";
    panel.onclick = (e) => e.stopPropagation();

    const title = document.createElement("h2");
    title.textContent = "スリット形状";

    const desc = document.createElement("div");
    desc.className = "paint-hint";
    desc.textContent =
      "黄色の扇形（1/n）の中に、スリット板の穴の形を手描きで変えられます。直線だけでなく、斜め・ギザギザ・波形なども描けます（白＝開いている部分）。頂点が円の中心、外側の弧が円周です。太さは実機と同じく、細いとシャープに、太いとボケた像になります。";

    const stageWrap = document.createElement("div");
    stageWrap.className = "slit-shape-stage";
    this.slitShapeCanvas = document.createElement("canvas");
    this.slitShapeCanvas.width = PAINT_SIZE;
    this.slitShapeCanvas.height = PAINT_SIZE;
    this.slitShapeCanvas.className = "slit-shape-canvas";
    this.slitShapeCtx = this.slitShapeCanvas.getContext("2d")!;
    this.slitShapeGuideCanvas = document.createElement("canvas");
    this.slitShapeGuideCanvas.width = PAINT_SIZE;
    this.slitShapeGuideCanvas.height = PAINT_SIZE;
    this.slitShapeGuideCanvas.className = "slit-shape-guide";
    this.slitShapeGuideCtx = this.slitShapeGuideCanvas.getContext("2d")!;
    stageWrap.append(this.slitShapeCanvas, this.slitShapeGuideCanvas);

    const toolRow = document.createElement("div");
    toolRow.className = "export-row";
    const sizeIn = document.createElement("input");
    sizeIn.type = "range";
    sizeIn.min = "2";
    sizeIn.max = "160";
    sizeIn.value = String(this.slitShapeSize);
    sizeIn.className = "paint-size";
    sizeIn.oninput = () => (this.slitShapeSize = Number(sizeIn.value));
    this.slitShapeEraseBtn = pbtn("消しゴム", () => {
      this.slitShapeErase = !this.slitShapeErase;
      this.slitShapeEraseBtn.classList.toggle("on", this.slitShapeErase);
    });
    toolRow.append(label("太さ"), sizeIn, this.slitShapeEraseBtn);

    const actRow = document.createElement("div");
    actRow.className = "export-row";
    actRow.append(
      pbtn("元に戻す", () => this.undoSlitShape()),
      pbtn("消去", () => this.clearSlitShapeToBlank()),
      pbtn("既定の直線に戻す", () => this.resetSlitShapeToDefault()),
    );

    const actionsRow = document.createElement("div");
    actionsRow.className = "export-actions";
    const saveBtn = pbtn("保存", () => this.saveSlitShape());
    saveBtn.classList.add("primary");
    actionsRow.append(saveBtn, pbtn("閉じる", () => this.closeSlitShapeModal()));

    panel.append(title, desc, stageWrap, toolRow, actRow, actionsRow);
    modal.append(panel);
    modal.onclick = () => this.closeSlitShapeModal(); // 背景クリックで閉じる

    this.slitShapeCanvas.addEventListener("pointerdown", (e) => this.slitShapeOnDown(e));
    this.slitShapeCanvas.addEventListener("pointermove", (e) => this.slitShapeOnMove(e));
    this.slitShapeCanvas.addEventListener("pointerup", () => this.slitShapeOnUp());
    this.slitShapeCanvas.addEventListener("pointercancel", () => this.slitShapeOnUp());
  }

  // =========================================================
  // DOM
  // =========================================================
  private buildDOM(): void {
    this.root = document.createElement("div");
    this.root.id = "compress";
    this.root.className = "hidden";

    const bar = document.createElement("div");
    bar.className = "paint-bar";

    // 画像読み込み（単一ボタン→モーダルで「原盤（左へ）／写真配置（右へ）」を選ぶ）
    const loadGroup = document.createElement("div");
    loadGroup.className = "paint-group";
    const loadBtn = pbtn("🖼 画像を読み込む", () => this.openLoadModal());
    loadBtn.classList.add("wide");
    this.fileInput = document.createElement("input");
    this.fileInput.type = "file";
    this.fileInput.accept = "image/png,image/jpeg,image/gif";
    this.fileInput.hidden = true;
    this.fileInput.onchange = () => {
      if (this.fileInput.files && this.fileInput.files.length > 0) {
        if (this.loadTarget === "left") this.loadFile(this.fileInput.files);
        else this.loadWedgePhotoFile(this.fileInput.files);
        this.fileInput.value = "";
      }
    };
    loadGroup.append(loadBtn, this.fileInput);

    // 写真の調整（右に配置した写真の拡大縮小・削除。移動は✋ツール）
    const wedgePhotoGroup = document.createElement("div");
    wedgePhotoGroup.className = "paint-group";
    const wedgePhotoZoomOut = pbtn("－", () => this.zoomWedgePhoto(1 / PHOTO_ZOOM_STEP));
    wedgePhotoZoomOut.title = "写真を縮小";
    const wedgePhotoZoomIn = pbtn("＋", () => this.zoomWedgePhoto(PHOTO_ZOOM_STEP));
    wedgePhotoZoomIn.title = "写真を拡大";
    const wedgePhotoRemove = pbtn("写真を消す", () => this.clearWedgePhoto());
    wedgePhotoGroup.append(wedgePhotoZoomOut, wedgePhotoZoomIn, wedgePhotoRemove);

    // 表示切替（スマホ縦画面専用。既定は右＝繰り返しパターンを表示、押すと左＝360°全円に切替）
    const portraitToggleGroup = document.createElement("div");
    portraitToggleGroup.className = "paint-group portrait-only";
    const portraitToggleBtn = pbtn("⇄ 表示切替", () => this.togglePortraitPane());
    portraitToggleBtn.title = "縦画面で表示する円を切り替え（右＝繰り返しパターン／左＝360°全円）";
    portraitToggleGroup.append(portraitToggleBtn);

    // 分割数（1/K）
    const divGroup = document.createElement("div");
    divGroup.className = "paint-group";
    const divMinus = pbtn("−", () => this.setDivisions(this.divisions - 1));
    this.divInput = document.createElement("input");
    this.divInput.type = "number";
    this.divInput.className = "num";
    this.divInput.min = String(COMPRESS_DIV_MIN);
    this.divInput.max = String(COMPRESS_DIV_MAX);
    this.divInput.value = String(this.divisions);
    this.divInput.oninput = () => {
      const v = Number(this.divInput.value);
      if (!Number.isNaN(v)) this.setDivisions(v);
    };
    const divPlus = pbtn("＋", () => this.setDivisions(this.divisions + 1));
    divGroup.append(label("1 /"), divMinus, this.divInput, divPlus);

    // ペイントツール
    const toolGroup = document.createElement("div");
    toolGroup.className = "paint-group";
    const tools: [Tool, string, string][] = [
      ["brush", "ブラシ", "🖌"],
      ["eraser", "消しゴム", "◧"],
      ["line", "直線", "／"],
      ["circle", "円", "◯"],
      ["fill", "塗り", "塗"],
      ["photo", "写真を移動（右）", "✋"],
    ];
    for (const [t, title, icon] of tools) {
      const b = pbtn(icon, () => this.setTool(t));
      b.title = title;
      this.toolButtons.set(t, b);
      toolGroup.append(b);
    }

    // 色・太さ・背景
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

    // 元に戻す・消去
    const actGroup = document.createElement("div");
    actGroup.className = "paint-group";
    actGroup.append(
      pbtn("元に戻す", () => this.undo()),
      pbtn("消去", () => this.clearArt()),
    );

    // スリット形状（スリット板の穴の形を手描きでカスタマイズ）
    const slitShapeGroup = document.createElement("div");
    slitShapeGroup.className = "paint-group";
    const slitShapeBtn = pbtn("🕳 スリット形状", () => this.openSlitShapeModal());
    slitShapeBtn.title = "スリット板の穴の形を手描きで変える（直線・斜め・ギザギザ・波形など）";
    slitShapeGroup.append(slitShapeBtn);

    // 印刷用PNG書き出し
    const exportGroup = document.createElement("div");
    exportGroup.className = "paint-group";
    exportGroup.append(
      pbtn("PNG書き出し", () => this.openExportModal()),
    );

    // 保存・閉じる
    const endGroup = document.createElement("div");
    endGroup.className = "paint-group paint-end";
    const useBtn = pbtn("保存せず使う", () => this.useWithoutSaving());
    useBtn.title = "ギャラリーには保存せず、今の絵を一時的にシミュレータへ反映する（リロードで消えます）";
    this.saveBtn = pbtn("保存", () => this.save());
    this.saveBtn.classList.add("primary");
    endGroup.append(useBtn, this.saveBtn, pbtn("閉じる", () => this.close()));

    bar.append(
      loadGroup,
      wedgePhotoGroup,
      portraitToggleGroup,
      divGroup,
      toolGroup,
      styleGroup,
      actGroup,
      slitShapeGroup,
      exportGroup,
      endGroup,
    );

    // キャンバス（左：360°画像 / 右：繰り返しパターン。どちらも描画可能）
    const stage = document.createElement("div");
    this.stageEl = stage;
    stage.className = "paint-stage";

    this.leftPane = paintPane("360°画像（ここに描けます）");
    this.leftCanvas = document.createElement("canvas");
    this.leftCanvas.width = this.leftCanvas.height = PAINT_SIZE;
    this.leftCanvas.className = "paint-canvas";
    this.leftCtx = this.leftCanvas.getContext("2d")!;
    this.leftPane.append(this.leftCanvas);

    this.rightPane = paintPane("繰り返しパターン（全ピースに描けます）");
    this.rightCanvas = document.createElement("canvas");
    this.rightCanvas.width = this.rightCanvas.height = PAINT_SIZE;
    this.rightCanvas.className = "paint-canvas";
    this.rightCtx = this.rightCanvas.getContext("2d")!;
    this.rightPane.append(this.rightCanvas);

    stage.append(this.leftPane, this.rightPane);

    const hint = document.createElement("div");
    hint.className = "paint-hint";
    hint.textContent =
      "左右どちらの円にも描けます。左（360°画像）に描くと右に圧縮、右（繰り返しパターン）に描くと全ピースへ K 回対称でコピーされます。「画像を読み込む」で原盤（左へ）／写真配置（右へ）を選べます（写真は✋ツールで移動、＋／－で拡大縮小、はみ出た部分は自動的に除外）。保存されるのは左の360°画像です。";

    this.buildLoadModal();
    this.buildExportModal();
    this.buildSlitShapeModal();
    this.root.append(bar, stage, hint, this.loadModal, this.exportModal, this.slitShapeModal);
    document.body.append(this.root);

    this.leftCanvas.addEventListener("pointerdown", (e) => this.onDown(e, false));
    this.leftCanvas.addEventListener("pointermove", (e) => this.onMove(e));
    this.leftCanvas.addEventListener("pointerup", () => this.onUp());
    this.leftCanvas.addEventListener("pointercancel", () => this.onUp());
    this.rightCanvas.addEventListener("pointerdown", (e) => this.onDown(e, true));
    this.rightCanvas.addEventListener("pointermove", (e) => this.onMove(e));
    this.rightCanvas.addEventListener("pointerup", () => this.onUp());
    this.rightCanvas.addEventListener("pointercancel", () => this.onUp());

    new ResizeObserver(() => this.relayout()).observe(stage);

    this.setTool("brush");
  }

  /** 縦画面で表示する円を切り替える（既定は右＝繰り返しパターン、切替で左＝360°全円） */
  private togglePortraitPane(): void {
    this.portraitShowLeft = !this.portraitShowLeft;
    this.stageEl.classList.toggle("show-left", this.portraitShowLeft);
    this.relayout();
  }

  /** 各キャンバスの表示サイズを、ペインに収まる最大の正方形へ揃える（縦画面では片方のみ表示） */
  private relayout(): void {
    const isPortrait = window.matchMedia("(orientation: portrait)").matches;
    const hiddenPane = isPortrait ? (this.portraitShowLeft ? this.rightPane : this.leftPane) : null;
    for (const pane of [this.leftPane, this.rightPane]) {
      if (pane === hiddenPane) continue;
      const canvas = pane.querySelector("canvas") as HTMLCanvasElement | null;
      const paneLabel = pane.firstElementChild as HTMLElement | null;
      if (!canvas || !paneLabel) continue;
      const gap = 8;
      const availW = pane.clientWidth;
      const availH = pane.clientHeight - paneLabel.offsetHeight - gap;
      const side = Math.max(0, Math.floor(Math.min(availW, availH)));
      canvas.style.width = `${side}px`;
      canvas.style.height = `${side}px`;
    }
  }
}

// ---- helpers ----
/** -π..π に正規化 */
function norm(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function paintPane(labelText: string): HTMLDivElement {
  const pane = document.createElement("div");
  pane.className = "paint-pane";
  const l = document.createElement("div");
  l.className = "paint-pane-label";
  l.textContent = labelText;
  pane.append(l);
  return pane;
}
function pbtn(text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "paint-btn";
  b.textContent = text;
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

// 開発時：フル HMR（PaintEditor と同じ理由）
const hot = (import.meta as unknown as { hot?: { invalidate(): void } }).hot;
if (hot) hot.invalidate();
