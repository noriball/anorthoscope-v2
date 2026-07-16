const ROWS: [string, string][] = [
  ["再生 / 停止", "中央下の 再生 ボタン"],
  ["画像を一覧から選ぶ", "「画像を選ぶ」ボタン"],
  ["回転速度・フェード", "スライダー"],
  ["回転比・スリット数", "中央下の − + / 数値"],
  ["スリットの位置を赤い線で重ねる", "スリットの見え方：スリット位置"],
  ["実際のスリット板を重ねる（黒円盤＋透明窓）", "スリットの見え方：スリット板"],
  ["自分で絵を描く（左右の円に作画）", "「作画」ボタン"],
  ["保存した絵を呼び出す", "「ギャラリー」ボタン"],
  ["画像ファイルを追加", "＋画像"],
  ["フルスクリーン", "右下の 全画面 ボタン"],
  ["作画: 左＝360°画像、右＝1/K繰り返しパターン", "どちらの円にも描ける"],
  ["右のどのピースに描いてもK回対称でコピー", "アノルソスコープと同じ幾何"],
  ["円をクリックして拡大 / もう一度クリックで戻る", "画像上でクリック"],
  ["拡大表示中はドラッグでパン、－/＋でズーム・リセット", "ドラッグ / ズームボタン"],
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
