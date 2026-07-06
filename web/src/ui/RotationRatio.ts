import { ROT_FACTOR_MAX, ROT_FACTOR_MIN, type Params } from "../config";

export interface RatioHooks {
  getParams(): Params;
  setParams(patch: Partial<Params>): void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
/** 整数はそのまま、小数のときだけ 1 桁表示（1 / -4 / 1.5） */
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/**
 * 2 パネルの間・下側に表示する回転比コントロール。
 *
 *   ROTATION RATIO
 *   スリット        絵
 *   − [ 1 ] +   :   − [ -4 ] +
 *
 * 横並びの A : B で「比」であることを示す。数字の左右に − + を置くので
 * ポインタが数字に被らない。数字は直接入力でき、任意の値（±360）にできる。
 */
export class RotationRatio {
  private readonly hooks: RatioHooks;
  private readonly refreshers: Array<() => void> = [];

  constructor(parent: HTMLElement, hooks: RatioHooks) {
    this.hooks = hooks;
    this.build(parent);
    this.update();
  }

  private build(parent: HTMLElement): void {
    const root = document.createElement("div");
    root.id = "rot-ratio";

    const title = document.createElement("div");
    title.className = "rr-title";
    title.textContent = "Rotation Ratio";

    const body = document.createElement("div");
    body.className = "rr-body";

    const slit = this.cell(
      "スリット",
      () => this.hooks.getParams().slitRotFactor,
      (v) => this.hooks.setParams({ slitRotFactor: v }),
    );
    const colon = document.createElement("span");
    colon.className = "rr-colon";
    colon.textContent = ":";
    const image = this.cell(
      "絵",
      () => this.hooks.getParams().imageRotFactor,
      (v) => this.hooks.setParams({ imageRotFactor: v }),
    );

    body.append(slit, colon, image);
    root.append(title, body);
    parent.append(root);
  }

  private cell(labelText: string, get: () => number, set: (v: number) => void): HTMLElement {
    const cell = document.createElement("div");
    cell.className = "rr-cell";

    const label = document.createElement("div");
    label.className = "rr-celllabel";
    label.textContent = labelText;

    const stepper = document.createElement("div");
    stepper.className = "rr-stepper";

    const minus = stepButton("−", () => this.bump(get, set, -1));
    const plus = stepButton("+", () => this.bump(get, set, +1));

    const input = document.createElement("input");
    input.type = "number";
    input.className = "rr-value";
    input.min = String(ROT_FACTOR_MIN);
    input.max = String(ROT_FACTOR_MAX);
    input.step = "0.1";
    input.inputMode = "decimal";
    input.oninput = () => {
      if (input.value === "" || input.value === "-") return;
      const raw = Number(input.value);
      if (Number.isNaN(raw)) return;
      set(clamp(round1(raw), ROT_FACTOR_MIN, ROT_FACTOR_MAX));
    };

    stepper.append(minus, input, plus);
    cell.append(label, stepper);

    this.refreshers.push(() => {
      if (document.activeElement !== input) input.value = fmt(get());
    });
    return cell;
  }

  private bump(get: () => number, set: (v: number) => void, d: number): void {
    set(clamp(round1(get() + d), ROT_FACTOR_MIN, ROT_FACTOR_MAX));
    this.update();
  }

  update(): void {
    for (const r of this.refreshers) r();
  }
}

function stepButton(text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "rr-step";
  b.textContent = text;
  b.onclick = onClick;
  return b;
}
