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
import { fullToWedge } from "../engine/wedge";
import { saveDrawing, type Drawing } from "../gallery";
import { loadFromFiles, type Picture } from "../images";
import { ImagePicker } from "./ImagePicker";
import { showToast } from "./toast";

type Tool = "brush" | "eraser" | "line" | "circle" | "fill";

const CX = PAINT_SIZE / 2;
const CY = PAINT_SIZE / 2;
const R = PAINT_SIZE / 2;
const CENTER_ANGLE = -Math.PI / 2; // 基準扇形（1ピース）の中心＝真上
const UNDO_LIMIT = 30;
const WEDGE_LIVE_RES = 300; // 左→右の圧縮（fullToWedge）をライブ計算する解像度

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
  private readonly onClose: () => void;
  private readonly picker: ImagePicker;
  private getImages: () => Picture[] = () => [];

  private root!: HTMLDivElement;
  private leftPane!: HTMLDivElement;
  private rightPane!: HTMLDivElement;
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

  constructor(onSaved: (d: Drawing) => void, onClose: () => void) {
    this.onSaved = onSaved;
    this.onClose = onClose;
    for (const c of [this.src, this.fullArt, this.wedgeArt, this.work, this.fullWedge, this.combine]) {
      c.width = c.height = PAINT_SIZE;
    }
    this.sctx = this.src.getContext("2d")!;
    this.fctx = this.fullArt.getContext("2d")!;
    this.wctx = this.wedgeArt.getContext("2d")!;
    this.workCtx = this.work.getContext("2d")!;
    this.fullWedgeCtx = this.fullWedge.getContext("2d")!;
    this.combineCtx = this.combine.getContext("2d")!;
    this.previewSrc.width = this.previewSrc.height = WEDGE_LIVE_RES;
    this.previewSrcCtx = this.previewSrc.getContext("2d")!;
    this.tmp.width = this.tmp.height = WEDGE_LIVE_RES;
    this.tctx = this.tmp.getContext("2d")!;
    this.picker = new ImagePicker(
      (i) => this.loadPicture(this.getImages()[i]),
      "下絵にする画像を選ぶ",
      "compress-picker",
    );
    this.buildDOM();
  }

  bind(getImages: () => Picture[]): void {
    this.getImages = getImages;
    this.picker.bind(getImages, () => -1);
  }

  // =========================================================
  // 公開 API
  // =========================================================
  open(): void {
    this.root.classList.remove("hidden");
    requestAnimationFrame(() => this.relayout());
    this.render();
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
    this.render();
  }

  private clearArt(): void {
    this.snapshot(this.fctx);
    this.snapshot(this.wctx);
    this.fctx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    this.wctx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    this.fullDirty = true;
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

  /** 左＝360°画像。写真＋fullArt に、右で描いた内容（K回コピー）を重ねて表示 */
  private renderLeft(): void {
    const ctx = this.leftCtx;
    ctx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    ctx.save();
    this.circleClip(ctx);
    ctx.fillStyle = this.bgColor;
    ctx.fillRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    if (this.hasImage) ctx.drawImage(this.src, 0, 0);
    ctx.drawImage(this.fullArt, 0, 0);
    this.tileWedge(ctx, PAINT_SIZE, this.wedgeArt);
    ctx.restore();
    this.drawDrawableRing(ctx);
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

    // 右の基準扇形 ＝ 左の圧縮結果 ＋ 右で描いた wedgeArt
    this.combineCtx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    this.combineCtx.drawImage(this.fullWedge, 0, 0);
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
    this.divisions = Math.min(COMPRESS_DIV_MAX, Math.max(COMPRESS_DIV_MIN, Math.round(k)));
    this.divInput.value = String(this.divisions);
    this.fullDirty = true;
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
    const ctx = isWedge ? this.wctx : this.fctx;
    const inBounds = isWedge ? (a: number, b: number) => this.inWedge(a, b) : (a: number, b: number) => this.inCircle(a, b);

    if (this.tool === "fill") {
      this.floodFill(ctx, inBounds, x, y);
      if (!isWedge) this.fullDirty = true;
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
      if (!isWedge) this.fullDirty = true;
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
    if (this.tool === "brush" || this.tool === "eraser") {
      if (!crossedBoundary) this.drawSegment(this.lastX, this.lastY, x, y);
      this.lastX = x;
      this.lastY = y;
    } else {
      this.previewX = x;
      this.previewY = y;
    }
    if (!this.activeIsWedge) this.fullDirty = true;
    this.render();
  }

  private onUp(): void {
    if (!this.drawing) return;
    if (this.tool === "line" || this.tool === "circle") {
      this.commitShape();
      if (!this.activeIsWedge) this.fullDirty = true;
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
    this.tileWedge(ctx, PAINT_SIZE, this.wedgeArt);
    ctx.restore();
    return out;
  }

  // =========================================================
  // 保存（ギャラリーへ）
  // =========================================================
  private save(): void {
    const dataURL = this.buildDiscAtSize(PAINT_SIZE).toDataURL("image/png");
    const d = saveDrawing({ dataURL, bg: this.bgColor, divisions: this.divisions });
    this.onSaved(d);
    showToast("保存しました");
    this.close();
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
  // DOM
  // =========================================================
  private buildDOM(): void {
    this.root = document.createElement("div");
    this.root.id = "compress";
    this.root.className = "hidden";

    const bar = document.createElement("div");
    bar.className = "paint-bar";

    // 画像読み込み
    const loadGroup = document.createElement("div");
    loadGroup.className = "paint-group";
    const pickBtn = pbtn("🖼 画像から選ぶ", () => this.picker.show());
    pickBtn.classList.add("wide");
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
    loadGroup.append(pickBtn, fileBtn, this.fileInput);

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

    // 印刷用PNG書き出し
    const exportGroup = document.createElement("div");
    exportGroup.className = "paint-group";
    exportGroup.append(
      pbtn("PNG書き出し", () => this.openExportModal()),
    );

    // 保存・閉じる
    const endGroup = document.createElement("div");
    endGroup.className = "paint-group paint-end";
    this.saveBtn = pbtn("保存", () => this.save());
    this.saveBtn.classList.add("primary");
    endGroup.append(this.saveBtn, pbtn("閉じる", () => this.close()));

    bar.append(loadGroup, divGroup, toolGroup, styleGroup, actGroup, exportGroup, endGroup);

    // キャンバス（左：360°画像 / 右：繰り返しパターン。どちらも描画可能）
    const stage = document.createElement("div");
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
      "左右どちらの円にも描けます。左（360°画像）に描くと右に圧縮、右（繰り返しパターン）に描くと全ピースへ K 回対称でコピーされます。保存されるのは左の360°画像です。";

    this.buildExportModal();
    this.root.append(bar, stage, hint, this.exportModal);
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

  /** 各キャンバスの表示サイズを、ペインに収まる最大の正方形へ揃える（縦画面では右ペインを隠す） */
  private relayout(): void {
    const isPortrait = window.matchMedia("(orientation: portrait)").matches;
    for (const pane of [this.leftPane, this.rightPane]) {
      if (isPortrait && pane === this.rightPane) continue;
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
