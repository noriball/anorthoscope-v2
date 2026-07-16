import type { Drawing } from "../gallery";
import type { Picture } from "../images";
import { icon } from "./icons";

/**
 * 画像をサムネイル一覧から選ぶオーバーレイ。
 *
 * 見本画像と「保存した自作の絵」は起動時にまとめて state.images へ取り込まれるため、
 * この一覧が全ての画像の入口になる（かつてはギャラリーが別画面だったが、
 * 一覧・編集・削除・新規作成をここに集約して画面上のボタンを減らした）。
 * 自作の絵のセルにだけ、編集（鉛筆）と削除（×）が出る。
 */
/** 自作の絵に対する操作。省略した分は一覧に出ない
 *  （例：作画エディタ内の「画像を読み込む」では新規作成を出さない） */
export interface PickerActions {
  onCreate?: () => void;
  onEdit?: (d: Drawing) => void;
  onDelete?: (d: Drawing) => void;
}

export class ImagePicker {
  private readonly root: HTMLDivElement;
  private readonly grid: HTMLDivElement;
  private readonly onSelect: (index: number) => void;
  private readonly actions: PickerActions;
  private getImages: () => Picture[] = () => [];
  private getIndex: () => number = () => 0;
  /** その位置の画像が自作の絵なら Drawing を返す（見本画像なら undefined） */
  private getDrawing: (index: number) => Drawing | undefined = () => undefined;

  constructor(
    onSelect: (index: number) => void,
    actions: PickerActions = {},
    title = "画像",
    rootId = "picker",
  ) {
    this.onSelect = onSelect;
    this.actions = actions;

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

  bind(
    getImages: () => Picture[],
    getIndex: () => number,
    getDrawing: (index: number) => Drawing | undefined = () => undefined,
  ): void {
    this.getImages = getImages;
    this.getIndex = getIndex;
    this.getDrawing = getDrawing;
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

      // 自作の絵だけ、編集と削除を出す（見本画像は消せない）
      const drawing = this.getDrawing(i);
      const { onEdit, onDelete } = this.actions;
      if (drawing && onEdit) {
        const edit = document.createElement("span");
        edit.className = "picker-edit";
        edit.title = "この絵を作画モードで編集";
        edit.append(icon("brush"));
        edit.onclick = (e) => {
          e.stopPropagation(); // セル選択と分離
          this.hide();
          onEdit(drawing);
        };
        cell.append(edit);
      }
      if (drawing && onDelete) {
        const del = document.createElement("span");
        del.className = "picker-del";
        del.textContent = "×";
        del.title = "この絵を削除";
        del.onclick = (e) => {
          e.stopPropagation();
          if (confirm(`「${drawing.name}」を削除しますか？`)) {
            onDelete(drawing);
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

    // 末尾に「＋ 新規作成」セル（作画モードを開く）
    const { onCreate } = this.actions;
    if (!onCreate) return;
    const createCell = document.createElement("button");
    createCell.className = "picker-cell picker-create";
    const plus = document.createElement("span");
    plus.className = "picker-create-plus";
    plus.textContent = "＋";
    const createLabel = document.createElement("span");
    createLabel.className = "picker-num";
    createLabel.textContent = "新規作成";
    createLabel.style.fontSize = "12px";
    createLabel.style.padding = "4px";
    createLabel.style.textAlign = "center";
    createLabel.style.whiteSpace = "normal";
    createCell.append(plus, createLabel);
    createCell.onclick = () => {
      this.hide();
      onCreate();
    };
    this.grid.append(createCell);
  }
}
