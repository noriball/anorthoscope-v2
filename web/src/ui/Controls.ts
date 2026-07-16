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
  SLITS_MIN,
  SLITS_MAX,
  type Params,
} from "../config";
import type { Picture } from "../images";
import { setIconLabel, type IconName } from "./icons";

/** main.ts が提供する操作フック */
export interface AppHooks {
  getParams(): Params;
  setParams(patch: Partial<Params>): void;
  setBgColor(hex: string): void;
  isPaused(): boolean;
  togglePause(): void;
  toggleFullscreen(): void;
  openGuide(): void;
  openImagePicker(): void;
  openSlitPicker(): void;
  getImages(): Picture[];
  getIndex(): number;
}

/** スリットをどう見せるか。showGuideLines / slitPlate の組み合わせを 1 つの選択にまとめたもの */
type OverlayMode = "none" | "line" | "plate";

const OVERLAY_MODES: [OverlayMode, IconName, string, string][] = [
  ["line", "overlayLine", "スリット位置", "スリットの形と位置を赤い線で左右の円に重ねる"],
  ["plate", "overlayPlate", "スリット板", "左の円に実際のスリット板（黒い円盤＋透明な窓）を重ねる"],
  ["none", "overlayNone", "なし", "スリットを重ねずに絵だけを見る"],
];

/** 全操作をボタンと数値入力に集約した下部コントロールバー */
export class ControlBar {
  private readonly root: HTMLElement;
  private readonly hooks: AppHooks;
  /** 再生／停止ボタン（PlayButton の要素をバーの中央へ差し込む） */
  private readonly playEl?: HTMLElement;

  private readonly overlayBtns = new Map<OverlayMode, HTMLButtonElement>();

  private speedInput!: HTMLInputElement;
  private speedValueLabel!: HTMLSpanElement;
  private fadeInput!: HTMLInputElement;
  private bgInput!: HTMLInputElement;
  private slitCountInput!: HTMLInputElement;

  constructor(root: HTMLElement, hooks: AppHooks, playEl?: HTMLElement) {
    this.root = root;
    this.hooks = hooks;
    this.playEl = playEl;
    this.build();
  }

  private build(): void {
    this.root.textContent = "";

    // --- 画像（見本・自作の絵の一覧。編集・削除・新規作成もこの中） ---
    const picker = this.iconButton(
      "image",
      "画像",
      () => this.hooks.openImagePicker(),
      "画像を選ぶ・描く",
    );
    picker.classList.add("wide");

    // --- スリット形状を選ぶ ---
    const slitPicker = this.iconButton(
      "slit",
      "スリット形状",
      () => this.hooks.openSlitPicker(),
      "スリット形状を選ぶ",
    );
    slitPicker.classList.add("wide");

    // 再生 / 停止はステージ右上の大きな円形ボタン（PlayButton）に移動した

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

    // --- スリットの見え方（なし / スリット位置 / スリット板）---
    // 「位置（赤線）」と「板」は元々クロスフェードで排他なので、2つの ON/OFF ではなく
    // 3択の切替にする（板を出すと赤線が消える、という関係が見た目で分かる）。
    const overlay = el("div", "seg");
    overlay.setAttribute("role", "group");
    overlay.title = "スリットの見え方";
    for (const [mode, name, label, title] of OVERLAY_MODES) {
      const b = this.iconButton(name, label, () => this.setOverlay(mode), title);
      b.classList.add("seg-btn");
      this.overlayBtns.set(mode, b);
      overlay.append(b);
    }
    // --- スリット数（回転比パネルから移設。スリット関連としてこのブロックに置く）---
    const slitCount = this.stepperField("スリット数", SLITS_MIN, SLITS_MAX, {
      get: () => this.hooks.getParams().numSlits,
      set: (v) => this.hooks.setParams({ numSlits: v }),
    });

    const full = this.iconButton("fullscreen", "", () => this.hooks.toggleFullscreen(), "フルスクリーン");
    full.classList.add("icon");
    const help = this.button("?", () => this.hooks.openGuide(), "操作ガイド");

    // 左から「画像」「スリット」「再生（中央）」「各種スライダー」「全画面・ガイド」。
    // 再生は両側の spacer で中央へ寄せる。モバイルは spacer が消えて折返すので、
    // 代わりに play-group を独立した行にして中央に置く（CSS 側）。
    const playGroup = group(this.playEl ?? el("span"));
    playGroup.classList.add("play-group");
    this.root.append(
      group(picker),
      sep(),
      group(slitPicker, overlay, slitCount),
      spacer(),
      playGroup,
      spacer(),
      params,
      sep(),
      group(full, help),
    );
    this.update();
  }

  private button(label: string, onClick: () => void, title = ""): HTMLButtonElement {
    const b = el("button", "btn");
    b.textContent = label;
    if (title) b.title = title;
    b.onclick = onClick;
    return b;
  }

  /** アイコン付きボタン（label が空ならアイコンのみ。title は必ず付けること） */
  private iconButton(
    name: IconName,
    label: string,
    onClick: () => void,
    title = "",
  ): HTMLButtonElement {
    const b = el("button", "btn");
    setIconLabel(b, name, label || undefined);
    if (title) b.title = title;
    b.onclick = onClick;
    return b;
  }

  /** バー用のコンパクトな整数ステッパー（− 値 ＋）。1刻み固定 */
  private stepperField(
    labelText: string,
    min: number,
    max: number,
    bind: { get: () => number; set: (v: number) => void },
  ): HTMLElement {
    const clamp = (v: number) => Math.min(max, Math.max(min, v));
    const wrap = el("div", "bar-stepper");
    const lbl = el("span", "bar-stepper-label");
    lbl.textContent = labelText;

    const input = el("input", "num bar-stepper-num");
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.step = "1";
    input.inputMode = "numeric";
    input.oninput = () => {
      if (input.value === "") return;
      const v = Number(input.value);
      if (!Number.isNaN(v)) bind.set(clamp(Math.round(v)));
    };
    input.onblur = () => this.update();
    input.onkeydown = (e) => {
      if (e.key === "Enter") input.blur();
    };

    const minus = this.button("−", () => {
      bind.set(clamp(Math.round(bind.get()) - 1));
      this.update();
    });
    const plus = this.button("+", () => {
      bind.set(clamp(Math.round(bind.get()) + 1));
      this.update();
    });
    minus.classList.add("icon");
    plus.classList.add("icon");

    this.slitCountInput = input;
    wrap.append(lbl, minus, input, plus);
    return wrap;
  }

  private setOverlay(mode: OverlayMode): void {
    this.hooks.setParams({
      showGuideLines: mode === "line",
      slitPlate: mode === "plate",
    });
    this.update();
  }

  /** 状態に合わせて表示を更新（値・アクティブ） */
  update(): void {
    const p = this.hooks.getParams();

    const mode: OverlayMode = p.slitPlate ? "plate" : p.showGuideLines ? "line" : "none";
    for (const [m, b] of this.overlayBtns) b.classList.toggle("on", m === mode);

    // 入力欄はフォーカス中なら上書きしない（打鍵・ドラッグの邪魔をしない）
    setInputUnlessFocused(this.speedInput, String(p.speed));
    this.speedValueLabel.textContent = `${p.speed.toFixed(1)}×`;
    setInputUnlessFocused(this.fadeInput, String(p.fadeAlpha));
    setInputUnlessFocused(this.slitCountInput, String(p.numSlits));
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
