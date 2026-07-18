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
import { t } from "../i18n";
import { setIconLabel, type IconName } from "./icons";

/** main.ts が提供する操作フック */
export interface AppHooks {
  getParams(): Params;
  setParams(patch: Partial<Params>): void;
  setBgColor(hex: string): void;
  /** 停止中でも 1 フレームだけ描画し直す（絵の表示/非表示の即時反映などに使う） */
  redraw(): void;
  isPaused(): boolean;
  togglePause(): void;
  toggleFullscreen(): void;
  openGuide(): void;
  openImagePicker(): void;
  openSlitPicker(): void;
  getImages(): Picture[];
  getIndex(): number;
}

/** 全操作をボタンと数値入力に集約した下部コントロールバー */
export class ControlBar {
  private readonly root: HTMLElement;
  private readonly hooks: AppHooks;
  /** 再生／停止ボタン（PlayButton の要素をバーの中央へ差し込む） */
  private readonly playEl?: HTMLElement;

  private imageToggleBtn!: HTMLButtonElement;
  private slitLineToggleBtn!: HTMLButtonElement;
  private slitPlateToggleBtn!: HTMLButtonElement;

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

    // --- 画像ブロック（選択/作成・表示切替）---
    const imgPick = this.button(
      t("controls.imagePick"),
      () => this.hooks.openImagePicker(),
      t("controls.imagePickTitle"),
    );
    this.imageToggleBtn = this.button(
      t("controls.imageToggle"),
      () => this.toggleImage(),
      t("controls.imageToggleTitle"),
    );

    // --- スリットブロック（形状・見え方・本数）---
    const slitShape = this.button(
      t("controls.slitSelect"),
      () => this.hooks.openSlitPicker(),
      t("controls.slitSelectTitle"),
    );

    // --- 数値パラメータ（回転比・スリット数は中央上の大きな表示で操作） ---
    // 速度はスライダー＋数値表示（フェードと異なり、値を目視で把握したい操作のため）
    this.speedInput = sliderInput(SPEED_MIN, SPEED_MAX, SPEED_STEP);
    this.speedValueLabel = el("span", "field-unit");
    this.speedInput.oninput = () => {
      const v = Number(this.speedInput.value);
      this.hooks.setParams({ speed: v });
      this.speedValueLabel.textContent = `${v.toFixed(1)}×`;
    };

    // フェードは数値表記なしのスライダー。左＝残像が長い（不透明＝背景色で覆う）／
    // 右＝すぐ消える（透明＝市松模様で下地が見える）。市松模様は「背景色に溶ける」
    // ことの比喩なので、背景スライダーで選んだ実際の色を左端の不透明色に反映する。
    this.fadeInput = sliderInput(FADE_MIN, FADE_MAX, FADE_STEP);
    this.fadeInput.classList.add("slider-swatch");
    this.fadeInput.oninput = () =>
      this.hooks.setParams({ fadeAlpha: Number(this.fadeInput.value) });

    // --- シミュレータ背景色。スライダーは白（左）→黒（右）で表示し、値もそれに合わせる ---
    this.bgInput = sliderInput(BG_MIN, BG_MAX, BG_STEP);
    this.bgInput.classList.add("slider-swatch");
    this.bgInput.value = String(BG_MAX); // 既定は黒＝右端
    this.bgInput.style.background = "linear-gradient(to right, #fff, #000)";
    this.bgInput.oninput = () => {
      // 左端（小さい値）ほど白。BG_MAX - v で反転して明るさに変換する
      const hex = grayToHex(BG_MAX - Number(this.bgInput.value) + BG_MIN);
      this.hooks.setBgColor(hex);
      this.updateFadeGradient(hex);
    };
    this.updateFadeGradient(grayToHex(BG_MAX - Number(this.bgInput.value) + BG_MIN)); // 初期表示

    const params = group(
      field(t("controls.speed"), this.speedInput, this.speedValueLabel),
      field(t("controls.fade"), this.fadeInput),
      field(t("common.background"), this.bgInput),
    );
    params.classList.add("params-group");

    // スリットの見え方：位置（赤線）と板表示はそれぞれ独立した表示/非表示トグル。
    // 内部ではクロスフェードで排他になる（板を出すと赤線は自動的に消える）ので、
    // 両方オンにしても見た目が壊れることはない。
    this.slitLineToggleBtn = this.button(
      t("controls.slitLine"),
      () => this.toggleSlitLine(),
      t("controls.slitLineTitle"),
    );
    this.slitPlateToggleBtn = this.button(
      t("controls.slitPlate"),
      () => this.toggleSlitPlate(),
      t("controls.slitPlateTitle"),
    );
    // スリット数（回転比パネルから移設）。「画像」「スリット」と同列の
    // 見出し付きグループにする（スリットの中に入れ子にすると見出しが2つ
    // 並んでしまうため、独立させる）。
    const slitCount = labeledGroup(
      t("controls.slitCount"),
      ...this.stepperControls(SLITS_MIN, SLITS_MAX, {
        get: () => this.hooks.getParams().numSlits,
        set: (v) => this.hooks.setParams({ numSlits: v }),
      }),
    );

    const full = this.iconButton(
      "fullscreen",
      "",
      () => this.hooks.toggleFullscreen(),
      t("controls.fullscreenTitle"),
    );
    full.classList.add("icon");
    const help = this.button("?", () => this.hooks.openGuide(), t("controls.helpTitle"));
    const actions = group(full, help);
    actions.classList.add("bar-actions"); // モバイルで固定サイズのまま右端に留めるための目印

    // 「画像」「スリット」を1行、「スライダー類＋全画面・ガイド」を1行にまとめておく。
    // デスクトップでは #controls 直下に横並びで置くだけ（見た目は従来通り）。
    // モバイルではこの3つの行（再生／画像・スリット／スライダー類）を CSS の order で
    // 独立した行として並べ替える（再生が一番上、その下に画像・スリット、その下に
    // スライダー類＋全画面・ガイド）。
    const row2 = el("div", "bar-row bar-row-groups");
    row2.append(
      labeledGroup(t("controls.imageGroupLabel"), imgPick, this.imageToggleBtn),
      sep(),
      labeledGroup(
        t("controls.slitGroupLabel"),
        slitShape,
        this.slitLineToggleBtn,
        this.slitPlateToggleBtn,
      ),
      slitCount,
    );
    const row3 = el("div", "bar-row bar-row-sliders");
    row3.append(params, sep(), actions);

    // 再生ボタンは固定幅、画像・スリット側とスライダー側で残り幅を半分ずつ分け合う
    // （CSS 側 .bar-row-groups / .bar-row-sliders）。モバイルは折返して縦に並ぶ。
    const playGroup = group(this.playEl ?? el("span"));
    playGroup.classList.add("play-group");
    this.root.append(row2, playGroup, row3);
    this.update();
  }

  private toggleImage(): void {
    this.hooks.setParams({ showImage: !this.hooks.getParams().showImage });
    this.hooks.redraw(); // 停止中でも即座に反映
    this.update();
  }

  /** フェードスライダーの見た目を更新：左＝不透明（実際の背景色）、右＝透明（市松模様）。
   *  背景色スライダーが変わるたびに呼び、フェードの「背景色に溶ける」比喩を実色で示す。 */
  private updateFadeGradient(bgHex: string): void {
    this.fadeInput.style.background =
      `linear-gradient(to right, ${bgHex}, rgba(0,0,0,0)), ` +
      "repeating-conic-gradient(#4a4a58 0% 25%, #2a2a34 0% 50%) 0 0 / 10px 10px";
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

  /** バー用のコンパクトな整数ステッパー（− 値 ＋）のボタン列だけを返す。1刻み固定。
   *  見出しは付けない（呼び出し側で labeledGroup() に渡し、他の見出しと同列に揃える）。 */
  private stepperControls(
    min: number,
    max: number,
    bind: { get: () => number; set: (v: number) => void },
  ): HTMLElement[] {
    const clamp = (v: number) => Math.min(max, Math.max(min, v));

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
    return [minus, input, plus];
  }

  private toggleSlitLine(): void {
    this.hooks.setParams({ showGuideLines: !this.hooks.getParams().showGuideLines });
    this.update();
  }

  private toggleSlitPlate(): void {
    this.hooks.setParams({ slitPlate: !this.hooks.getParams().slitPlate });
    this.update();
  }

  /** 状態に合わせて表示を更新（値・アクティブ） */
  update(): void {
    const p = this.hooks.getParams();

    this.slitLineToggleBtn.classList.toggle("on", p.showGuideLines);
    this.slitPlateToggleBtn.classList.toggle("on", p.slitPlate);

    // 絵を隠しているときはトグルを点灯（＝この操作が効いている合図）
    this.imageToggleBtn.classList.toggle("on", !p.showImage);

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
/** 先頭にテキストの見出しを付けたまとまり（例: 「画像」「スリット」） */
/** 「速度」「フェード」等の field() と同じ形式：上に枠なしの小さいキャプション、
 *  下にボタン列。ボタンと見分けがつくよう、チップや枠は使わない。 */
function labeledGroup(labelText: string, ...children: Node[]): HTMLElement {
  const wrap = el("div", "labeled-group");
  const l = el("span", "group-label");
  l.textContent = labelText;
  const row = el("div", "group");
  row.append(...children);
  wrap.append(l, row);
  return wrap;
}
function sep(): HTMLElement {
  return el("div", "sep");
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
