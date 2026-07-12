/** スリット形状1つ */
export interface SlitShape {
  id: string;
  name: string;
  dataURL: string; // PNG dataURL
}

/** スリット形状をサムネイル一覧から選ぶオーバーレイ */
export class SlitPicker {
  private readonly root: HTMLDivElement;
  private readonly grid: HTMLDivElement;
  private readonly onSelect: (index: number) => void;
  private getSlitShapes: () => SlitShape[] = () => [];
  private getIndex: () => number = () => 0;

  constructor(onSelect: (index: number) => void, title = "スリット形状を選ぶ", rootId = "slit-picker") {
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
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root) this.hide();
    });
    document.body.append(this.root);
  }

  bind(getSlitShapes: () => SlitShape[], getIndex: () => number): void {
    this.getSlitShapes = getSlitShapes;
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
    const shapes = this.getSlitShapes();
    const cur = this.getIndex();

    shapes.forEach((shape, i) => {
      const cell = document.createElement("button");
      cell.className = "picker-cell";
      cell.classList.toggle("active", i === cur);

      const c = document.createElement("canvas");
      const size = 96;
      c.width = c.height = size;
      const ctx = c.getContext("2d")!;

      // Load and draw thumbnail
      const img = new Image();
      img.onload = () => {
        const s = Math.min(size / img.width, size / img.height);
        const w = img.width * s;
        const h = img.height * s;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      };
      img.src = shape.dataURL;

      const label = document.createElement("span");
      label.className = "picker-num";
      label.textContent = shape.name;
      label.style.fontSize = "12px";
      label.style.padding = "4px";
      label.style.textAlign = "center";
      label.style.whiteSpace = "normal";
      label.style.wordBreak = "break-word";

      cell.append(c, label);
      cell.onclick = () => {
        this.onSelect(i);
        this.hide();
      };
      this.grid.append(cell);
    });
  }
}
