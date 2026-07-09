import {
  FADE_MAX,
  FADE_MIN,
  FADE_STEP,
  SPEED_MAX,
  SPEED_MIN,
  SPEED_STEP,
  BG_MIN,
  BG_MAX,
  BG_STEP,
  type Params,
} from "../config";
import type { Picture } from "../images";

/** main.ts が提供する操作フック */
export interface AppHooks {
  getParams(): Params;
  setParams(patch: Partial<Params>): void;
  setBgColor(hex: string): void;
  isPaused(): boolean;
  togglePause(): void;
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

/** 全操作をボタンと数値入力に集約した下部コントロールバー */
export class ControlBar {
  private readonly root: HTMLElement;
  private readonly hooks: AppHooks;

  private playBtn!: HTMLButtonElement;
  private lineBtn!: HTMLButtonElement;
  private plateBtn!: HTMLButtonElement;

  private speedInput!: HTMLInputElement;
  private speedValueLabel!: HTMLSpanElement;
  private fadeInput!: HTMLInputElement;
  private bgInput!: HTMLInputElement;

  constructor(root: HTMLElement, hooks: AppHooks) {
    this.root = root;
    this.hooks = hooks;
    this.build();
  }

  private build(): void {
    this.root.textContent = "";

    // --- 画像を選ぶ（一覧から選択。前後移動もここから） ---
    const picker = this.button("🖼 画像を選ぶ", () => this.hooks.openImagePicker(), "画像一覧から選ぶ");
    picker.classList.add("wide");

    // --- 再生 ---
    this.playBtn = this.button("⏸ 停止", () => this.hooks.togglePause(), "再生 / 停止");
    this.playBtn.classList.add("wide", "play");

    // --- 数値パラメータ（回転比・スリット数は中央上の大きな表示で操作） ---
    // 速度はスライダー＋数値表示（フェードと異なり、値を目視で把握したい操作のため）
    this.speedInput = sliderInput(SPEED_MIN, SPEED_MAX, SPEED_STEP);
    this.speedValueLabel = el("span", "field-unit");
    this.speedInput.oninput = () => {
      const v = Number(this.speedInput.value);
      this.hooks.setParams({ speed: v });
      this.speedValueLabel.textContent = `${v.toFixed(1)}×`;
    };

    // フェードは数値表記なしのスライダー（左右にドラッグするだけ）
    this.fadeInput = sliderInput(FADE_MIN, FADE_MAX, FADE_STEP);
    this.fadeInput.oninput = () =>
      this.hooks.setParams({ fadeAlpha: Number(this.fadeInput.value) });

    // --- シミュレータ背景色（グレースケールスライダー：0=黒 ～ 255=白） ---
    this.bgInput = sliderInput(BG_MIN, BG_MAX, BG_STEP);
    this.bgInput.value = "0"; // 初期値は黒（DEFAULT_BG_COLOR と一致）
    this.bgInput.style.background = "linear-gradient(to right, #000, #fff)";
    this.bgInput.oninput = () => {
      const v = Number(this.bgInput.value);
      const hex = grayToHex(v);
      this.hooks.setBgColor(hex);
    };

    const params = group(
      field("速度", this.speedInput, this.speedValueLabel),
      field("フェード", this.fadeInput),
      field("背景", this.bgInput),
    );

    // --- アクション ---
    this.lineBtn = this.button("Line", () => this.toggleLine(), "赤ガイドライン表示");
    this.plateBtn = this.button("スリット板", () => this.togglePlate(), "スリット板モード");
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
      paint,
      compress,
      gallery,
      add,
      full,
      help,
    );

    this.root.append(picker, sep(), this.playBtn, sep(), params, spacer(), actions);
    this.update();
  }

  private button(label: string, onClick: () => void, title = ""): HTMLButtonElement {
    const b = el("button", "btn");
    b.textContent = label;
    if (title) b.title = title;
    b.onclick = onClick;
    return b;
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

  /** 状態に合わせて表示を更新（値・アクティブ） */
  update(): void {
    const p = this.hooks.getParams();

    this.playBtn.textContent = this.hooks.isPaused() ? "▶ 再生" : "⏸ 停止";
    this.lineBtn.classList.toggle("on", p.showGuideLines);
    this.plateBtn.classList.toggle("on", p.slitPlate);

    // 入力欄はフォーカス中なら上書きしない（打鍵・ドラッグの邪魔をしない）
    setInputUnlessFocused(this.speedInput, String(p.speed));
    this.speedValueLabel.textContent = `${p.speed.toFixed(1)}×`;
    setInputUnlessFocused(this.fadeInput, String(p.fadeAlpha));
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
  const s = el("div", "spacer");
  s.style.flex = "1 1 auto";
  return s;
}
function field(labelText: string, input: HTMLInputElement | HTMLElement, unit?: string | HTMLElement): HTMLElement {
  const wrap = el("label", "field");
  const l = el("span");
  l.textContent = labelText;
  if (unit) {
    const box = el("div", "field-inline");
    let u: HTMLElement;
    if (typeof unit === "string") {
      u = el("span", "field-unit");
      u.textContent = unit;
    } else {
      u = unit;
    }
    box.append(input, u);
    wrap.append(l, box);
  } else {
    wrap.append(l, input);
  }
  return wrap;
}
function sliderInput(min: number, max: number, step: number): HTMLInputElement {
  const i = el("input", "slider");
  i.type = "range";
  i.min = String(min);
  i.max = String(max);
  i.step = String(step);
  return i;
}
function setInputUnlessFocused(input: HTMLInputElement, value: string): void {
  if (document.activeElement !== input) input.value = value;
}
/** グレー階調値（0〜255）を "#rrggbb" 形式の無彩色 hex に変換 */
function grayToHex(v: number): string {
  const c = Math.round(v).toString(16).padStart(2, "0");
  return `#${c}${c}${c}`;
}
