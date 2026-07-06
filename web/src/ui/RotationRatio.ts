import {
  ROT_FACTOR_MAX,
  ROT_FACTOR_MIN,
  SLITS_MAX,
  SLITS_MIN,
  type Params,
} from "../config";

export interface RatioHooks {
  getParams(): Params;
  setParams(patch: Partial<Params>): void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** step が整数刻みなら整数に、小数刻みなら小数第1位に丸める */
const roundStep = (v: number, step: number) => (step >= 1 ? Math.round(v) : Math.round(v * 10) / 10);
/** 整数はそのまま、小数のときだけ 1 桁表示（1 / -4 / 1.5） */
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

interface CellRange {
  min: number;
  max: number;
  step: number;
}

/**
 * 2 パネルの間・下側に表示する回転比＋スリット数コントロール（2段表示）。
 *
 *          ROTATION RATIO
 *   スリット + [ 1 ] −  ：  絵 + [ -4 ] −
 *          スリット数 + [ 5 ] −
 *
 * 円と重ならないよう、やや小さめの表示にして2段に分ける（上段＝回転比、
 * 下段＝スリット数）。数字の左右に + − を置くのでポインタが数字に被らない。
 * 直接入力も可能。
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

    const rotRange: CellRange = { min: ROT_FACTOR_MIN, max: ROT_FACTOR_MAX, step: 0.1 };
    const slit = this.cell(
      "スリット",
      () => this.hooks.getParams().slitRotFactor,
      (v) => this.hooks.setParams({ slitRotFactor: v }),
      rotRange,
    );
    const colon = document.createElement("span");
    colon.className = "rr-colon";
    colon.textContent = ":";
    const image = this.cell(
      "絵",
      () => this.hooks.getParams().imageRotFactor,
      (v) => this.hooks.setParams({ imageRotFactor: v }),
      rotRange,
    );

    const row1 = document.createElement("div");
    row1.className = "rr-row";
    row1.append(slit, colon, image);

    const slitCount = this.cell(
      "スリット数",
      () => this.hooks.getParams().numSlits,
      (v) => this.hooks.setParams({ numSlits: v }),
      { min: SLITS_MIN, max: SLITS_MAX, step: 1 },
    );

    const row2 = document.createElement("div");
    row2.className = "rr-row";
    row2.append(slitCount);

    root.append(title, row1, row2);
    parent.append(root);
  }

  private cell(
    labelText: string,
    get: () => number,
    set: (v: number) => void,
    range: CellRange,
  ): HTMLElement {
    const cell = document.createElement("div");
    cell.className = "rr-cell";

    const label = document.createElement("div");
    label.className = "rr-celllabel";
    label.textContent = labelText;

    const stepper = document.createElement("div");
    stepper.className = "rr-stepper";

    const minus = stepButton("−", () => this.bump(get, set, -range.step, range));
    const plus = stepButton("+", () => this.bump(get, set, range.step, range));

    const input = document.createElement("input");
    input.type = "number";
    input.className = "rr-value";
    input.min = String(range.min);
    input.max = String(range.max);
    input.step = String(range.step);
    input.inputMode = "decimal";
    input.oninput = () => {
      if (input.value === "" || input.value === "-") return;
      const raw = Number(input.value);
      if (Number.isNaN(raw)) return;
      set(clamp(roundStep(raw, range.step), range.min, range.max));
    };

    stepper.append(plus, input, minus);
    cell.append(label, stepper);

    this.refreshers.push(() => {
      if (document.activeElement !== input) input.value = fmt(get());
    });
    return cell;
  }

  private bump(get: () => number, set: (v: number) => void, d: number, range: CellRange): void {
    set(clamp(roundStep(get() + d, range.step), range.min, range.max));
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
