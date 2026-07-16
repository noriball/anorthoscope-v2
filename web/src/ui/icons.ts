// UI 共通のアイコン（インライン SVG）。
// 以前は絵文字や記号（🖼 🎨 ✋ ◧ ／ 塗 …）を直接ラベルにしていたが、
// 字形・太さ・色がフォント任せでボタンごとにバラバラに見えていたため、
// 線幅と大きさを揃えた自前の SVG に統一する。
// 色は currentColor 追従（.on やホバーでの文字色変化にそのまま乗る）。

const SVG_NS = "http://www.w3.org/2000/svg";

export type IconName =
  | "image" // 画像を選ぶ／読み込む
  | "gallery" // 保存した絵の一覧
  | "slit" // スリット形状（円盤＋放射状の穴）
  | "overlayNone" // スリットの見え方：なし
  | "overlayLine" // スリットの見え方：位置を線で重ねる
  | "overlayPlate" // スリットの見え方：スリット板
  | "palette" // 作画モード
  | "fullscreen"
  | "play"
  | "pause"
  | "reset" // 表示リセット（ズーム）
  | "brush"
  | "eraser"
  | "line"
  | "circle"
  | "fill"
  | "move"; // 写真を移動

// viewBox は全て 0 0 16 16。塗りつぶす要素だけ class="solid" を付ける。
const PATHS: Record<IconName, string> = {
  image: `<rect x="2" y="3" width="12" height="10" rx="1.5"/>
    <circle cx="5.6" cy="6.4" r="1.1"/>
    <path d="M2.4 11.4 6 8l2.4 2.2L10.8 8l2.8 2.6"/>`,
  gallery: `<rect x="2" y="2" width="5.2" height="5.2" rx="1"/>
    <rect x="8.8" y="2" width="5.2" height="5.2" rx="1"/>
    <rect x="2" y="8.8" width="5.2" height="5.2" rx="1"/>
    <rect x="8.8" y="8.8" width="5.2" height="5.2" rx="1"/>`,
  slit: `<circle cx="8" cy="8" r="5.8"/>
    <path d="M8 7V2.4"/>
    <circle cx="8" cy="8" r="1" class="solid"/>`,
  // 「スリットの見え方」3択。同じ円盤に何を重ねるかで描き分ける
  overlayNone: `<circle cx="8" cy="8" r="5.8"/>`,
  overlayLine: `<circle cx="8" cy="8" r="5.8"/>
    <path d="M8 2.2v11.6M2.2 8h11.6"/>`,
  overlayPlate: `<path class="solid" fill-rule="evenodd" d="M8 1.9a6.1 6.1 0 1 0 0 12.2 6.1 6.1 0 0 0 0-12.2ZM7.1 4.3h1.8v7.4H7.1Z"/>`,
  palette: `<path d="M8 14A6 6 0 1 1 14 8c0 1.7-1.5 2.2-2.6 2.2h-1.1c-1 0-1.8.8-1.8 1.8 0 .5.2.8.4 1.1.2.3.1.9-.9.9Z"/>
    <circle cx="5.1" cy="6.9" r=".95" class="solid"/>
    <circle cx="8" cy="4.9" r=".95" class="solid"/>
    <circle cx="10.9" cy="6.6" r=".95" class="solid"/>`,
  fullscreen: `<path d="M6 2H3.6A1.6 1.6 0 0 0 2 3.6V6"/>
    <path d="M10 2h2.4A1.6 1.6 0 0 1 14 3.6V6"/>
    <path d="M14 10v2.4a1.6 1.6 0 0 1-1.6 1.6H10"/>
    <path d="M2 10v2.4A1.6 1.6 0 0 0 3.6 14H6"/>`,
  play: `<path d="M4.5 2.6 13 8l-8.5 5.4z" class="solid"/>`,
  pause: `<rect x="4" y="2.8" width="2.8" height="10.4" rx=".9" class="solid"/>
    <rect x="9.2" y="2.8" width="2.8" height="10.4" rx=".9" class="solid"/>`,
  reset: `<path d="M13.4 8a5.4 5.4 0 1 1-1.6-3.8"/>
    <path d="M13.6 2.4v3.4h-3.4"/>`,
  brush: `<path d="M11.4 2.6a1.7 1.7 0 0 1 2.4 2.4l-8 8L2.5 14l1-3.3z"/>
    <path d="M10.2 3.8l2.4 2.4"/>`,
  eraser: `<path d="M8.6 3.4 3.4 8.6a1.5 1.5 0 0 0 0 2.1l1.9 1.9a1.5 1.5 0 0 0 2.1 0l5.2-5.2a1.5 1.5 0 0 0 0-2.1l-1.9-1.9a1.5 1.5 0 0 0-2.1 0Z"/>
    <path d="M6.1 5.9l4.1 4.1"/>
    <path d="M4.6 14h8.8"/>`,
  line: `<path d="M4.2 11.8 11.8 4.2"/>
    <circle cx="3.4" cy="12.6" r="1.4"/>
    <circle cx="12.6" cy="3.4" r="1.4"/>`,
  circle: `<circle cx="8" cy="8" r="5.6"/>`,
  // 傾けたペンキ缶＋こぼれる雫（塗りつぶし）
  fill: `<path d="M7.3 2.4 2.4 7.3a1.5 1.5 0 0 0 0 2.1l3.4 3.4a1.5 1.5 0 0 0 2.1 0l4.9-4.9z"/>
    <path d="M4.7 1.5 6.6 3.4"/>
    <path d="M2.6 8.6h9.4"/>
    <path class="solid" d="M14.2 11.1c.7 1 1.1 1.6 1.1 2.1a1.05 1.05 0 0 1-2.1 0c0-.5.4-1.1 1-2.1Z"/>`,
  move: `<path d="M8 2.4v11.2M2.4 8h11.2"/>
    <path d="M6.3 4.1 8 2.4l1.7 1.7"/>
    <path d="M6.3 11.9 8 13.6l1.7-1.7"/>
    <path d="M4.1 6.3 2.4 8l1.7 1.7"/>
    <path d="M11.9 6.3 13.6 8l-1.7 1.7"/>`,
};

/** アイコン単体（SVG 要素）を作る */
export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", "ico");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = PATHS[name];
  return svg;
}

/** アイコン＋文字ラベルをボタンなどに流し込む（文字は省略可＝アイコンのみ） */
export function setIconLabel(el: HTMLElement, name: IconName, text?: string): void {
  el.textContent = "";
  el.append(icon(name));
  if (text) {
    const span = document.createElement("span");
    span.textContent = text;
    el.append(span);
  }
}
