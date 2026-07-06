import { deleteDrawing, listDrawings, type Drawing } from "../gallery";

/** 保存済みドローイングの一覧オーバーレイ */
export class Gallery {
  private readonly root: HTMLDivElement;
  private readonly grid: HTMLDivElement;
  private readonly onUse: (d: Drawing) => void;
  private readonly onEdit: (d: Drawing | null) => void;
  private readonly onDeleted: (id: string) => void;

  constructor(
    onUse: (d: Drawing) => void,
    onEdit: (d: Drawing | null) => void,
    onDeleted: (id: string) => void,
  ) {
    this.onUse = onUse;
    this.onEdit = onEdit;
    this.onDeleted = onDeleted;

    this.root = document.createElement("div");
    this.root.id = "gallery";
    this.root.className = "hidden";

    const panel = document.createElement("div");
    panel.className = "gallery-panel";

    const head = document.createElement("div");
    head.className = "gallery-head";
    const title = document.createElement("h2");
    title.textContent = "ギャラリー";
    const close = document.createElement("button");
    close.className = "paint-btn";
    close.textContent = "閉じる";
    close.onclick = () => this.hide();
    const newBtn = document.createElement("button");
    newBtn.className = "paint-btn primary";
    newBtn.textContent = "＋ 新規作成";
    newBtn.onclick = () => {
      this.hide();
      this.onEdit(null);
    };
    head.append(title, newBtn, close);

    this.grid = document.createElement("div");
    this.grid.className = "gallery-grid";

    panel.append(head, this.grid);
    this.root.append(panel);
    document.body.append(this.root);
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
    const items = listDrawings();
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "gallery-empty";
      empty.textContent = "保存された絵はまだありません。「＋ 新規作成」から描けます。";
      this.grid.append(empty);
      return;
    }
    for (const d of items) {
      const card = document.createElement("div");
      card.className = "gallery-card";

      const img = document.createElement("img");
      img.src = d.dataURL;
      img.className = "gallery-thumb";
      img.title = d.name;

      const name = document.createElement("div");
      name.className = "gallery-name";
      name.textContent = d.name;

      const acts = document.createElement("div");
      acts.className = "gallery-acts";
      acts.append(
        act("使う", () => {
          this.hide();
          this.onUse(d);
        }),
        act("編集", () => {
          this.hide();
          this.onEdit(d);
        }),
        act("削除", () => {
          if (confirm(`「${d.name}」を削除しますか？`)) {
            deleteDrawing(d.id);
            this.onDeleted(d.id);
            this.refresh();
          }
        }),
      );

      card.append(img, name, acts);
      this.grid.append(card);
    }
  }
}

function act(text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "gallery-act";
  b.textContent = text;
  b.onclick = onClick;
  return b;
}
