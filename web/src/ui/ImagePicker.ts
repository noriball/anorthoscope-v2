import type { Picture } from "../images";

/** 全画像をサムネイル一覧から選ぶオーバーレイ */
export class ImagePicker {
  private readonly root: HTMLDivElement;
  private readonly grid: HTMLDivElement;
  private readonly onSelect: (index: number) => void;
  private getImages: () => Picture[] = () => [];
  private getIndex: () => number = () => 0;

  constructor(onSelect: (index: number) => void, title = "画像を選ぶ", rootId = "picker") {
    this.onSelect = onSelect;

    this.root = document.createElement("div");
    this.root.id = rootId;
    this.root.className = "hidden picker-overlay";

    const panel = document.createElement("div");
    panel.className = "gallery-panel";

    const head = document.createElement("div");
    head.className = "gallery-head";
    const titleEl = document.createElement("h2");
    titleEl.textContent = title;
    const close = document.createElement("button");
    close.className = "paint-btn";
    close.textContent = "閉じる";
    close.onclick = () => this.hide();
    head.append(titleEl, close);

    this.grid = document.createElement("div");
    this.grid.className = "gallery-grid picker-grid";

    panel.append(head, this.grid);
    this.root.append(panel);
    // パネル外クリックで閉じる
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root) this.hide();
    });
    document.body.append(this.root);
  }

  bind(getImages: () => Picture[], getIndex: () => number): void {
    this.getImages = getImages;
    this.getIndex = getIndex;
  }

  show(): void {
    this.refresh();
    this.root.classList.remove("hidden");
  }
  hide(): void {
    this.root.classList.add("hidden");
  }

  private refresh(): void {
    this.grid.textContent = "";
    const imgs = this.getImages();
    const cur = this.getIndex();
    imgs.forEach((pic, i) => {
      const cell = document.createElement("button");
      cell.className = "picker-cell";
      cell.classList.toggle("active", i === cur);

      const c = document.createElement("canvas");
      const size = 96;
      c.width = c.height = size;
      const ctx = c.getContext("2d")!;
      const s = Math.min(size / pic.width, size / pic.height);
      const w = pic.width * s;
      const h = pic.height * s;
      ctx.drawImage(pic.bitmap, (size - w) / 2, (size - h) / 2, w, h);

      const num = document.createElement("span");
      num.className = "picker-num";
      num.textContent = String(i + 1);

      cell.append(c, num);
      cell.onclick = () => {
        this.onSelect(i);
        this.hide();
      };
      this.grid.append(cell);
    });
  }
}
