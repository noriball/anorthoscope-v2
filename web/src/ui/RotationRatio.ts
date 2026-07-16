import {
  ROT_FACTOR_MAX,
  ROT_FACTOR_MIN,
  ROT_FACTOR_STEP,
  type Params,
} from "../config";

export interface RatioHooks {
  getParams(): Params;
  setParams(patch: Partial<Params>): void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** step の刻み幅から表示すべき小数桁数を求める（1 → 0 桁、0.1 → 1 桁、0.005 → 3 桁） */
function decimalsForStep(step: number): number {
  if (step >= 1) return 0;
  const s = step.toString();
  const i = s.indexOf(".");
  return i === -1 ? 0 : s.length - i - 1;
}
/** 値を step の刻みちょうどに丸める（浮動小数点誤差も除去） */
const roundStep = (v: number, step: number): number => {
  const decimals = decimalsForStep(step);
  const snapped = Math.round(v / step) * step;
  const factor = 10 ** decimals;
  return Math.round(snapped * factor) / factor;
};
/** step の刻み幅に応じた桁数で表示（1刻みは整数、0.005刻みは小数第3位まで） */
const fmt = (v: number, step: number): string => {
  const decimals = decimalsForStep(step);
  return decimals === 0 ? String(Math.round(v)) : v.toFixed(decimals);
};

interface CellRange {
  min: number;
  max: number;
  step: number;
}

/**
 * 2 パネルの間・下側に表示する回転比＋スリット数のコントロール（2段表示）。
 *
 *             回転比
 *   スリット + [ 1 ] −  ：  絵 + [ -4 ] −
 *          スリット数 + [ 5 ] −
 *
 * 円と重ならないよう、やや小さめの表示にして2段に分ける（上段＝回転比、
 * 下段＝スリット数）。数字の左右に + − を置くのでポインタが数字に被らない。
 * 直接入力も可能。単一パネルのフォーカス表示中はこのパネル自体を隠す
 * （setVisible）— フォーカス中は中央の余白が無くなり円と重なってしまうため。
 */
export class RotationRatio {
  private readonly hooks: RatioHooks;
  private readonly refreshers: Array<() => void> = [];
  private root!: HTMLDivElement;

  constructor(parent: HTMLElement, hooks: RatioHooks) {
    this.hooks = hooks;
    this.build(parent);
    this.update();
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle("hidden", !visible);
  }

  setAnchor(axis: "horizontal" | "vertical", xCss: number, yCss: number): void {
    if (axis === "vertical") {
      this.root.style.left = `${xCss}px`;
      this.root.style.top = `${yCss}px`;
      this.root.style.bottom = "auto";
      this.root.style.transform = "translate(-50%, -50%)";
    } else {
      this.root.style.left = "";
      this.root.style.top = "";
      this.root.style.bottom = "";
      this.root.style.transform = "";
    }
  }

  private build(parent: HTMLElement): void {
    const root = document.createElement("div");
    this.root = root;
    root.id = "rot-ratio";

    const title = document.createElement("div");
    title.className = "rr-title";
    title.textContent = "回転比";

    const rotRange: CellRange = { min: ROT_FACTOR_MIN, max: ROT_FACTOR_MAX, step: ROT_FACTOR_STEP };
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

    // スリット / ： / 絵 の 3 セルを横並びに（スリット数は下部バーへ移設した）
    const grid = document.createElement("div");
    grid.className = "rr-grid";
    grid.append(slit, colon, image);

    root.append(title, grid);
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
    input.inputMode = range.step >= 1 ? "numeric" : "decimal";
    input.oninput = () => {
      if (input.value === "" || input.value === "-") return;
      const raw = Number(input.value);
      if (Number.isNaN(raw)) return;
      set(clamp(roundStep(raw, range.step), range.min, range.max));
    };
    // 入力欄から離れたら、丸められた実際の値を表示に反映する
    // （例: 2.7 と打っても、確定後は 3 と表示し直す）
    input.onblur = () => this.update();
    input.onkeydown = (e) => {
      if (e.key === "Enter") {
        input.blur();
        this.update();
      }
    };

    stepper.append(plus, input, minus);
    cell.append(label, stepper);

    this.refreshers.push(() => {
      if (document.activeElement !== input) input.value = fmt(get(), range.step);
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
