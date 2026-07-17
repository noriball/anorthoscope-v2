import { t, type TranslationKey } from "../i18n";

const ROW_KEYS: [TranslationKey, TranslationKey][] = [
  ["guide.rows.playPause.action", "guide.rows.playPause.location"],
  ["guide.rows.selectImage.action", "guide.rows.selectImage.location"],
  ["guide.rows.hideImage.action", "guide.rows.hideImage.location"],
  ["guide.rows.speedFade.action", "guide.rows.speedFade.location"],
  ["guide.rows.rotationRatio.action", "guide.rows.rotationRatio.location"],
  ["guide.rows.selectSlit.action", "guide.rows.selectSlit.location"],
  ["guide.rows.slitLine.action", "guide.rows.slitLine.location"],
  ["guide.rows.slitPlate.action", "guide.rows.slitPlate.location"],
  ["guide.rows.slitCount.action", "guide.rows.slitCount.location"],
  ["guide.rows.draw.action", "guide.rows.draw.location"],
  ["guide.rows.gallery.action", "guide.rows.gallery.location"],
  ["guide.rows.fullscreen.action", "guide.rows.fullscreen.location"],
  ["guide.rows.paintAxes.action", "guide.rows.paintAxes.location"],
  ["guide.rows.paintSymmetry.action", "guide.rows.paintSymmetry.location"],
  ["guide.rows.focusClick.action", "guide.rows.focusClick.location"],
  ["guide.rows.focusZoom.action", "guide.rows.focusZoom.location"],
];
const ROWS: [string, string][] = ROW_KEYS.map(([a, b]) => [t(a), t(b)]);

/** 操作ガイドのオーバーレイ */
export class Guide {
  private readonly root: HTMLDivElement;

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "guide";
    this.root.className = "hidden";
    this.root.innerHTML = `
      <div class="guide-panel">
        <h1>Anorthoscope Simulator</h1>
        <div class="sub">${t("guide.subtitle")}</div>
        <table>${ROWS.map(
          ([k, v]) => `<tr><td>${k}</td><td class="key">${v}</td></tr>`,
        ).join("")}</table>
        <div class="foot">${t("guide.footer")}</div>
      </div>`;
    // パネル以外クリックで閉じる
    this.root.addEventListener("click", () => this.hide());
    document.body.append(this.root);
  }

  get isOpen(): boolean {
    return !this.root.classList.contains("hidden");
  }
  show(): void {
    this.root.classList.remove("hidden");
  }
  hide(): void {
    this.root.classList.add("hidden");
  }
  toggle(): void {
    this.root.classList.toggle("hidden");
  }
}
