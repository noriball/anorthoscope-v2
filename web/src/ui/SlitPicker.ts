import { t } from "../i18n";

/** スリット形状1つ */
export interface SlitShape {
  id: string;
  name: string;
  dataURL: string; // PNG dataURL
  deletable?: boolean; // 自作スリット＝削除可
}

/** スリット形状をサムネイル一覧から選ぶオーバーレイ */
export class SlitPicker {
  private readonly root: HTMLDivElement;
  private readonly grid: HTMLDivElement;
  private readonly onSelect: (index: number) => void;
  private readonly onCreate: () => void;
  private readonly onDelete: (id: string) => void;
  private getSlitShapes: () => SlitShape[] = () => [];
  private getIndex: () => number = () => 0;

  constructor(
    onSelect: (index: number) => void,
    onCreate: () => void,
    onDelete: (id: string) => void,
    title = t("slitPicker.title"),
    rootId = "slit-picker",
  ) {
    this.onSelect = onSelect;
    this.onCreate = onCreate;
    this.onDelete = onDelete;

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
    close.textContent = t("common.close");
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

  get visible(): boolean {
    return !this.root.classList.contains("hidden");
  }

  /** 一覧を再描画（追加・削除の後に呼ぶ） */
  refresh(): void {
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

      // 視認性のため薄いグレー地に描く
      ctx.fillStyle = "#2c2f3e";
      ctx.fillRect(0, 0, size, size);

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

      // 自作スリットには削除ボタン（×）
      if (shape.deletable) {
        const del = document.createElement("span");
        del.className = "picker-del";
        del.textContent = "×";
        del.title = t("slitPicker.deleteTitle");
        del.onclick = (e) => {
          e.stopPropagation(); // セル選択と分離
          if (confirm(t("common.deleteConfirm", { name: shape.name }))) {
            this.onDelete(shape.id);
          }
        };
        cell.append(del);
      }

      cell.onclick = () => {
        this.onSelect(i);
        this.hide();
      };
      this.grid.append(cell);
    });

    // 末尾に「＋ 新規作成」セル（作画を経由せずスリット形状を手描きで作る）
    const createCell = document.createElement("button");
    createCell.className = "picker-cell picker-create";
    const plus = document.createElement("span");
    plus.className = "picker-create-plus";
    plus.textContent = "＋";
    const createLabel = document.createElement("span");
    createLabel.className = "picker-num";
    createLabel.textContent = t("common.createLabel");
    createLabel.style.fontSize = "12px";
    createLabel.style.padding = "4px";
    createLabel.style.textAlign = "center";
    createLabel.style.whiteSpace = "normal";
    createCell.append(plus, createLabel);
    createCell.onclick = () => {
      this.hide();
      this.onCreate();
    };
    this.grid.append(createCell);
  }
}
