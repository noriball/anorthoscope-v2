const ROWS: [string, string][] = [
  ["再生 / 停止", "⏸ ボタン"],
  ["画像を一覧から選ぶ", "🖼 画像を選ぶ"],
  ["回転速度・フェード", "スライダー"],
  ["回転比・スリット数", "中央下の − + / 数値"],
  ["赤ガイドライン 表示切替", "Line ボタン"],
  ["スリット板モード（黒円盤＋透明窓）", "スリット板 ボタン"],
  ["自分で絵を描く", "🖌 ペイント"],
  ["360°画像を扇形へ圧縮", "🔄 圧縮"],
  ["保存した絵を呼び出す", "🖼 ギャラリー"],
  ["画像ファイルを追加", "＋画像"],
  ["フルスクリーン", "⛶ ボタン"],
  ["ペイント: 黄色枠内に描画", "保存で360°展開"],
  ["圧縮: 1/2〜1/16の扇形へ", "アノルソスコープと同じ幾何"],
  ["円をクリックして拡大 / もう一度クリックで戻る", "画像上でクリック"],
  ["拡大表示中はドラッグでパン、－/⟲/＋でズーム", "ドラッグ / ズームボタン"],
];

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
        <div class="sub">アノルソスコープ 操作ガイド</div>
        <table>${ROWS.map(
          ([k, v]) => `<tr><td>${k}</td><td class="key">${v}</td></tr>`,
        ).join("")}</table>
        <div class="foot">どこかクリック / ESC で閉じる</div>
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
