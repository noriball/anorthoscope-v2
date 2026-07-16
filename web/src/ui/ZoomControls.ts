import { setIconLabel } from "./icons";

export interface ZoomHooks {
  zoomIn(): void;
  zoomOut(): void;
  reset(): void;
}

/**
 * 単一パネル・フォーカス表示中だけ現れる、ズーム＋リセットの小さなフローティング
 * コントロール（ステージ右下）。RotationRatio と同じ「parent + hooks」構成パターン。
 */
export class ZoomControls {
  private readonly root: HTMLDivElement;

  constructor(parent: HTMLElement, hooks: ZoomHooks) {
    this.root = document.createElement("div");
    this.root.id = "zoom-controls";
    this.root.classList.add("hidden");

    const minus = zoomBtn("−", hooks.zoomOut, "縮小");
    const reset = zoomBtn("", hooks.reset, "表示をリセット");
    setIconLabel(reset, "reset");
    const plus = zoomBtn("+", hooks.zoomIn, "拡大");
    this.root.append(minus, reset, plus);

    parent.append(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle("hidden", !visible);
  }
}

function zoomBtn(label: string, onClick: () => void, title: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "zoom-btn";
  b.textContent = label;
  b.title = title;
  b.onclick = onClick;
  return b;
}
