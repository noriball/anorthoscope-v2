import { SPEED_MAX, SPEED_MIN, SPEED_STEP, type Params } from "../config";
import type { Picture } from "../images";

/** main.ts が提供する操作フック */
export interface AppHooks {
  getParams(): Params;
  setParams(patch: Partial<Params>): void;
  isPaused(): boolean;
  togglePause(): void;
  next(): void;
  prev(): void;
  addImages(): void;
  toggleFullscreen(): void;
  openGuide(): void;
  openPaint(): void;
  openCompress(): void;
  openGallery(): void;
  openImagePicker(): void;
  getImages(): Picture[];
  getIndex(): number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 全操作をボタンと数値入力に集約した下部コントロールバー */
export class ControlBar {
  private readonly root: HTMLElement;
  private readonly hooks: AppHooks;

  private prevThumb!: HTMLCanvasElement;
  private curThumb!: HTMLCanvasElement;
  private nextThumb!: HTMLCanvasElement;
  private counter!: HTMLSpanElement;
  private playBtn!: HTMLButtonElement;
  private lineBtn!: HTMLButtonElement;
  private plateBtn!: HTMLButtonElement;

  private speedInput!: HTMLInputElement;

  constructor(root: HTMLElement, hooks: AppHooks) {
    this.root = root;
    this.hooks = hooks;
    this.build();
  }

  private build(): void {
    this.root.textContent = "";

    // --- 画像ナビ（前・現在・次の3枚のみ） ---
    this.prevThumb = thumbCanvas("prev", () => this.hooks.prev());
    this.curThumb = thumbCanvas("cur", () => {});
    this.nextThumb = thumbCanvas("next", () => this.hooks.next());
    this.counter = el("span", "counter");
    const nav = group(
      this.button("◀", () => this.hooks.prev(), "前の画像"),
      this.prevThumb,
      this.curThumb,
      this.nextThumb,
      this.button("▶", () => this.hooks.next(), "次の画像"),
      this.counter,
    );

    // --- 再生 ---
    this.playBtn = this.button("⏸ 停止", () => this.hooks.togglePause(), "再生 / 停止");
    this.playBtn.classList.add("wide");

    // --- 数値パラメータ（回転比・スリット数は中央上の大きな表示で操作） ---
    this.speedInput = numberInput(SPEED_MIN, SPEED_MAX, SPEED_STEP);

    this.speedInput.oninput = () =>
      this.commitNumber(this.speedInput, SPEED_MIN, SPEED_MAX, 0.1, (v) =>
        this.hooks.setParams({ speed: v }),
      );

    const params = group(field("速度", this.speedInput, "×"));

    // --- アクション ---
    this.lineBtn = this.button("Line", () => this.toggleLine(), "赤ガイドライン表示");
    this.plateBtn = this.button("スリット板", () => this.togglePlate(), "スリット板モード");
    const picker = this.button("🖼 画像を選ぶ", () => this.hooks.openImagePicker(), "画像一覧から選ぶ");
    picker.classList.add("wide");
    const paint = this.button("🖌 ペイント", () => this.hooks.openPaint(), "ペイントモード");
    paint.classList.add("wide");
    const compress = this.button(
      "🔄 圧縮",
      () => this.hooks.openCompress(),
      "360°画像を1/2〜1/16の扇形へ圧縮",
    );
    compress.classList.add("wide");
    const gallery = this.button("🖼 ギャラリー", () => this.hooks.openGallery(), "保存した絵");
    gallery.classList.add("wide");
    const add = this.button("＋画像", () => this.hooks.addImages(), "画像ファイルを追加");
    const full = this.button("⛶", () => this.hooks.toggleFullscreen(), "フルスクリーン");
    full.classList.add("icon");
    const help = this.button("?", () => this.hooks.openGuide(), "操作ガイド");
    const actions = group(
      this.lineBtn,
      this.plateBtn,
      picker,
      paint,
      compress,
      gallery,
      add,
      full,
      help,
    );

    this.root.append(nav, sep(), this.playBtn, sep(), params, spacer(), actions);
    this.update();
  }

  private button(label: string, onClick: () => void, title = ""): HTMLButtonElement {
    const b = el("button", "btn");
    b.textContent = label;
    if (title) b.title = title;
    b.onclick = onClick;
    return b;
  }

  private commitNumber(
    input: HTMLInputElement,
    lo: number,
    hi: number,
    step: number,
    set: (v: number) => void,
  ): void {
    if (input.value === "" || input.value === "-") return; // 入力途中は無視
    const raw = Number(input.value);
    if (Number.isNaN(raw)) return;
    const snapped = step < 1 ? Math.round(raw * 10) / 10 : Math.round(raw);
    set(clamp(snapped, lo, hi));
  }

  private toggleLine(): void {
    const p = this.hooks.getParams();
    this.hooks.setParams({ showGuideLines: !p.showGuideLines });
    this.update();
  }

  private togglePlate(): void {
    const p = this.hooks.getParams();
    this.hooks.setParams({ slitPlate: !p.slitPlate });
    this.update();
  }

  /** 状態に合わせて表示を更新（値・アクティブ・3枚ナビ） */
  update(): void {
    const p = this.hooks.getParams();
    const imgs = this.hooks.getImages();
    const idx = this.hooks.getIndex();
    const n = imgs.length;

    this.playBtn.textContent = this.hooks.isPaused() ? "▶ 再生" : "⏸ 停止";
    this.lineBtn.classList.toggle("on", p.showGuideLines);
    this.plateBtn.classList.toggle("on", p.slitPlate);
    this.counter.textContent = n ? `${idx + 1} / ${n}` : "—";

    // 入力欄はフォーカス中なら上書きしない（打鍵の邪魔をしない）
    setInputUnlessFocused(this.speedInput, p.speed.toFixed(1));

    // 3枚ナビ
    drawThumb(this.curThumb, imgs[idx] ?? null);
    if (n > 1) {
      drawThumb(this.prevThumb, imgs[(idx - 1 + n) % n] ?? null);
      drawThumb(this.nextThumb, imgs[(idx + 1) % n] ?? null);
      this.prevThumb.style.visibility = "visible";
      this.nextThumb.style.visibility = "visible";
    } else {
      this.prevThumb.style.visibility = "hidden";
      this.nextThumb.style.visibility = "hidden";
    }
  }
}

// ---- DOM helpers ----
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}
function group(...children: Node[]): HTMLElement {
  const g = el("div", "group");
  g.append(...children);
  return g;
}
function sep(): HTMLElement {
  return el("div", "sep");
}
function spacer(): HTMLElement {
  const s = el("div");
  s.style.flex = "1 1 auto";
  return s;
}
function field(labelText: string, input: HTMLInputElement, unit?: string): HTMLElement {
  const wrap = el("label", "field");
  const l = el("span");
  l.textContent = labelText;
  if (unit) {
    const box = el("div", "field-inline");
    const u = el("span", "field-unit");
    u.textContent = unit;
    box.append(input, u);
    wrap.append(l, box);
  } else {
    wrap.append(l, input);
  }
  return wrap;
}
function numberInput(min: number, max: number, step: number): HTMLInputElement {
  const i = el("input", "num");
  i.type = "number";
  i.min = String(min);
  i.max = String(max);
  i.step = String(step);
  i.inputMode = "decimal";
  return i;
}
function setInputUnlessFocused(input: HTMLInputElement, value: string): void {
  if (document.activeElement !== input) input.value = value;
}
function thumbCanvas(kind: string, onClick: () => void): HTMLCanvasElement {
  const c = el("canvas", `nav-thumb ${kind}`);
  c.width = 52;
  c.height = 52;
  c.onclick = onClick;
  return c;
}
function drawThumb(c: HTMLCanvasElement, pic: Picture | null): void {
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, c.width, c.height);
  if (!pic) return;
  const s = Math.min(c.width / pic.width, c.height / pic.height);
  const w = pic.width * s;
  const h = pic.height * s;
  ctx.drawImage(pic.bitmap, (c.width - w) / 2, (c.height - h) / 2, w, h);
}
