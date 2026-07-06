import {
  COMPRESS_DIV_DEFAULT,
  COMPRESS_DIV_MAX,
  COMPRESS_DIV_MIN,
  PAINT_SIZE,
} from "../config";
import { fullToWedge } from "../engine/wedge";
import { saveDrawing, type Drawing } from "../gallery";
import { loadFromFiles, type Picture } from "../images";
import { ImagePicker } from "./ImagePicker";

type Tool = "brush" | "eraser" | "line" | "circle" | "fill";

const CX = PAINT_SIZE / 2;
const CY = PAINT_SIZE / 2;
const R = PAINT_SIZE / 2;
const CENTER_ANGLE = -Math.PI / 2;
const UNDO_LIMIT = 30;

/**
 * 圧縮モード（ペイントモードの逆）のエディタ。
 *
 * **左（元の360°画像）に描くと、右（1/K の扇形）にリアルタイムで圧縮結果が
 * 現れる。**（アノルソスコープで見える像と同じ幾何。隙間を埋める必要はなく、
 * 全周の内容がそのまま扇形へ畳み込まれるだけ。`engine/wedge.ts` の
 * `fullToWedge` を使う。）
 *
 * 左には既存の360°画像を読み込むこともでき、その上にペイントモードと同じ
 * ツール（ブラシ / 消しゴム / 直線 / 円 / 塗りつぶし）で加筆できる。
 */
export class CompressEditor {
  private readonly onSaved: (d: Drawing) => void;
  private readonly onClose: () => void;
  private readonly picker: ImagePicker;
  private getImages: () => Picture[] = () => [];

  private root!: HTMLDivElement;
  private srcPane!: HTMLDivElement;
  private outPane!: HTMLDivElement;
  private srcCanvas!: HTMLCanvasElement; // 左：元の360°画像＋加筆（描画対象）
  private srcCtx!: CanvasRenderingContext2D;
  private outCanvas!: HTMLCanvasElement; // 右：圧縮結果（ライブプレビュー、低解像度）
  private outCtx!: CanvasRenderingContext2D;
  private fileInput!: HTMLInputElement;
  private divInput!: HTMLInputElement;
  private saveBtn!: HTMLButtonElement;
  private bgInput!: HTMLInputElement;
  private toolButtons = new Map<Tool, HTMLButtonElement>();

  // 読み込んだ元画像（PAINT_SIZE 四方に letterbox 済み、写真レイヤー）
  private readonly src = document.createElement("canvas");
  private readonly sctx: CanvasRenderingContext2D;
  private hasImage = false;

  // 手描き加筆レイヤー（左パネルの円全体、透明背景）
  private readonly art = document.createElement("canvas");
  private readonly actx: CanvasRenderingContext2D;

  // src + art を合成した作業用（fullToWedge への入力元）
  private readonly work = document.createElement("canvas");
  private readonly workCtx: CanvasRenderingContext2D;
  // work をライブプレビュー解像度へ縮小する作業用
  private readonly previewSrc = document.createElement("canvas");
  private readonly previewSrcCtx: CanvasRenderingContext2D;
  // ImageData → 描画可能キャンバスへ変換する合成用
  private readonly tmp = document.createElement("canvas");
  private readonly tctx: CanvasRenderingContext2D;

  private static readonly PREVIEW_RES = 300;
  private previewDirty = false;
  private previewScheduled = false;

  private divisions = COMPRESS_DIV_DEFAULT;
  private bgColor = "#000000";
  private tool: Tool = "brush";
  private color = "#ffd23c";
  private size = 14;

  private drawing = false;
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;
  private previewX = 0;
  private previewY = 0;
  private undoStack: ImageData[] = [];

  constructor(onSaved: (d: Drawing) => void, onClose: () => void) {
    this.onSaved = onSaved;
    this.onClose = onClose;
    this.src.width = this.src.height = PAINT_SIZE;
    this.sctx = this.src.getContext("2d")!;
    this.art.width = this.art.height = PAINT_SIZE;
    this.actx = this.art.getContext("2d")!;
    this.work.width = this.work.height = PAINT_SIZE;
    this.workCtx = this.work.getContext("2d")!;
    this.previewSrc.width = this.previewSrc.height = CompressEditor.PREVIEW_RES;
    this.previewSrcCtx = this.previewSrc.getContext("2d")!;
    this.tmp.width = this.tmp.height = CompressEditor.PREVIEW_RES;
    this.tctx = this.tmp.getContext("2d")!;
    this.picker = new ImagePicker(
      (i) => this.loadPicture(this.getImages()[i]),
      "圧縮する画像を選ぶ",
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
  // 画像読み込み
  // =========================================================
  private loadPicture(pic: Picture | undefined): void {
    if (!pic) return;
    this.sctx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    const s = Math.min(PAINT_SIZE / pic.width, PAINT_SIZE / pic.height);
    const w = pic.width * s;
    const h = pic.height * s;
    this.sctx.drawImage(pic.bitmap, (PAINT_SIZE - w) / 2, (PAINT_SIZE - h) / 2, w, h);
    this.hasImage = true;
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

  /** 円内判定（左パネル：描画は全周どこでも可） */
  private inCircle(x: number, y: number): boolean {
    return Math.hypot(x - CX, y - CY) <= R;
  }

  private wedgePathAt(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number): void {
    const half = this.wedgeAngle / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, CENTER_ANGLE - half, CENTER_ANGLE + half);
    ctx.closePath();
  }

  // =========================================================
  // 手描き加筆（左パネル＝元の360°画像に描く。全周どこでも可）
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

  private clearArt(): void {
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

  private circleClip(ctx: CanvasRenderingContext2D): void {
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, Math.PI * 2);
    ctx.clip();
  }

  private drawSegment(x0: number, y0: number, x1: number, y1: number): void {
    const ctx = this.actx;
    ctx.save();
    this.circleClip(ctx);
    ctx.globalCompositeOperation = this.tool === "eraser" ? "destination-out" : "source-over";
    this.strokeStyle(ctx);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
  }

  private commitShape(): void {
    const ctx = this.actx;
    ctx.save();
    this.circleClip(ctx);
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
      ctx.arc(x0, y0, Math.hypot(x1 - x0, y1 - y0), 0, Math.PI * 2);
    }
  }

  private floodFill(sx: number, sy: number): void {
    const ix = Math.round(sx);
    const iy = Math.round(sy);
    if (!this.inCircle(ix, iy)) return;
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
      if (!this.inCircle(x, y)) continue;
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
  // 表示
  //   左：読み込んだ 360° の元画像 + 手描き加筆（描画対象）
  //   右：1/K の扇形へ圧縮したライブプレビュー（低解像度・rAF デバウンス）
  // =========================================================
  private render(): void {
    this.renderSource();
    this.schedulePreview();
  }

  private renderSource(): void {
    const sctx = this.srcCtx;
    sctx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    sctx.save();
    this.circleClip(sctx);
    sctx.fillStyle = "#111";
    sctx.fillRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    if (this.hasImage) sctx.drawImage(this.src, 0, 0);
    sctx.drawImage(this.art, 0, 0); // 手描き加筆をアルファ合成で重ねる
    sctx.restore();
    sctx.strokeStyle = "rgba(255,255,255,0.28)";
    sctx.lineWidth = 1.5;
    sctx.beginPath();
    sctx.arc(CX, CY, R - 1, 0, Math.PI * 2);
    sctx.stroke();
  }

  /** 右パネル（圧縮ライブプレビュー）の再計算をフレーム単位でまとめる */
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
    const N = CompressEditor.PREVIEW_RES;

    // work = src(あれば) + art を合成した「元の360°画像」
    this.workCtx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    if (this.hasImage) this.workCtx.drawImage(this.src, 0, 0);
    this.workCtx.drawImage(this.art, 0, 0);

    // 高速化のため低解像度へ縮小してから圧縮
    this.previewSrcCtx.clearRect(0, 0, N, N);
    this.previewSrcCtx.drawImage(this.work, 0, 0, N, N);
    const full = this.previewSrcCtx.getImageData(0, 0, N, N);
    const wedge = fullToWedge(full, N, this.divisions);

    const octx = this.outCtx;
    octx.clearRect(0, 0, N, N);
    octx.save();
    octx.beginPath();
    octx.arc(N / 2, N / 2, N / 2, 0, Math.PI * 2);
    octx.clip();
    octx.fillStyle = this.bgColor;
    octx.fillRect(0, 0, N, N);
    this.tctx.clearRect(0, 0, N, N);
    this.tctx.putImageData(wedge, 0, 0);
    octx.drawImage(this.tmp, 0, 0);
    octx.restore();
    this.drawGridOverlay(octx, N / 2, N / 2, N / 2);
  }

  private drawGridOverlay(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number): void {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    this.wedgePathAt(ctx, cx, cy, radius);
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.fill("evenodd");
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 1, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < this.divisions; i++) {
      const a = CENTER_ANGLE + this.wedgeAngle / 2 + i * this.wedgeAngle;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    this.wedgePathAt(ctx, cx, cy, radius);
    ctx.strokeStyle = "rgba(255,210,60,0.9)";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  }

  // =========================================================
  // 分割数
  // =========================================================
  private setDivisions(k: number): void {
    this.divisions = Math.min(COMPRESS_DIV_MAX, Math.max(COMPRESS_DIV_MIN, Math.round(k)));
    this.divInput.value = String(this.divisions);
    this.schedulePreview();
  }

  // =========================================================
  // 入力（左パネル＝元の360°画像に直接描く）
  // =========================================================
  private toArt(e: PointerEvent): [number, number] {
    const rect = this.srcCanvas.getBoundingClientRect();
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
    if (!this.inCircle(x, y)) return;
    this.srcCanvas.setPointerCapture(e.pointerId);
    this.snapshot();
    this.drawing = true;
    this.startX = this.lastX = this.previewX = x;
    this.startY = this.lastY = this.previewY = y;
    if (this.tool === "brush" || this.tool === "eraser") {
      this.drawSegment(x, y, x, y);
      this.render();
    }
  }

  private onMove(e: PointerEvent): void {
    if (!this.drawing) return;
    const [x, y] = this.toArt(e);
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

  private setTool(t: Tool): void {
    this.tool = t;
    this.toolButtons.forEach((btn, key) => btn.classList.toggle("on", key === t));
  }

  // =========================================================
  // 保存（フル解像度で再圧縮）
  // =========================================================
  private save(): void {
    this.workCtx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    if (this.hasImage) this.workCtx.drawImage(this.src, 0, 0);
    this.workCtx.drawImage(this.art, 0, 0);
    const full = this.workCtx.getImageData(0, 0, PAINT_SIZE, PAINT_SIZE);
    const wedge = fullToWedge(full, PAINT_SIZE, this.divisions);

    const out = document.createElement("canvas");
    out.width = out.height = PAINT_SIZE;
    const ctx = out.getContext("2d")!;
    ctx.save();
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = this.bgColor;
    ctx.fillRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    const wedgeCanvas = document.createElement("canvas");
    wedgeCanvas.width = wedgeCanvas.height = PAINT_SIZE;
    wedgeCanvas.getContext("2d")!.putImageData(wedge, 0, 0);
    ctx.drawImage(wedgeCanvas, 0, 0);
    ctx.restore();

    const dataURL = out.toDataURL("image/png");
    const d = saveDrawing({ dataURL, bg: this.bgColor, divisions: this.divisions });
    this.onSaved(d);
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
      ["fill", "塗り", "🪣"],
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
      this.schedulePreview();
    };

    styleGroup.append(
      label("色"),
      colorIn,
      label("太さ"),
      sizeIn,
      label("背景"),
      this.bgInput,
    );

    // 元に戻す・消去（手描きレイヤーのみ対象）
    const actGroup = document.createElement("div");
    actGroup.className = "paint-group";
    actGroup.append(
      pbtn("元に戻す", () => this.undo()),
      pbtn("消去", () => this.clearArt()),
    );

    // 保存・閉じる
    const endGroup = document.createElement("div");
    endGroup.className = "paint-group paint-end";
    this.saveBtn = pbtn("保存", () => this.save());
    this.saveBtn.classList.add("primary");
    endGroup.append(this.saveBtn, pbtn("閉じる", () => this.close()));

    bar.append(loadGroup, divGroup, toolGroup, styleGroup, actGroup, endGroup);

    // キャンバス（左：元の360°画像＋加筆 / 右：圧縮ライブプレビュー）
    const stage = document.createElement("div");
    stage.className = "paint-stage";

    this.srcPane = paintPane("元の360°画像（ここに描けます）");
    this.srcCanvas = document.createElement("canvas");
    this.srcCanvas.width = this.srcCanvas.height = PAINT_SIZE;
    this.srcCanvas.className = "paint-canvas";
    this.srcCtx = this.srcCanvas.getContext("2d")!;
    this.srcPane.append(this.srcCanvas);

    this.outPane = paintPane("圧縮結果（1/K 扇形・ライブプレビュー）");
    this.outCanvas = document.createElement("canvas");
    this.outCanvas.width = this.outCanvas.height = CompressEditor.PREVIEW_RES;
    this.outCanvas.className = "paint-canvas preview";
    this.outCtx = this.outCanvas.getContext("2d")!;
    this.outPane.append(this.outCanvas);

    stage.append(this.srcPane, this.outPane);

    const hint = document.createElement("div");
    hint.className = "paint-hint";
    hint.textContent =
      "左の360°画像に描くと、右に黄色枠の 1/K 扇形として圧縮結果がリアルタイムに現れます（アノルソスコープで見える像と同じ幾何）。";

    this.root.append(bar, stage, hint);
    document.body.append(this.root);

    this.srcCanvas.addEventListener("pointerdown", (e) => this.onDown(e));
    this.srcCanvas.addEventListener("pointermove", (e) => this.onMove(e));
    this.srcCanvas.addEventListener("pointerup", () => this.onUp());
    this.srcCanvas.addEventListener("pointercancel", () => this.onUp());

    new ResizeObserver(() => this.relayout()).observe(stage);

    this.setTool("brush");
  }

  /** 各キャンバスの表示サイズを、ペインに収まる最大の正方形へ揃える */
  private relayout(): void {
    for (const pane of [this.srcPane, this.outPane]) {
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
