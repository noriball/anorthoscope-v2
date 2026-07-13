export interface PlayHooks {
  toggle(): void;
  isPaused(): boolean;
}

/**
 * 再生／停止の円形ボタン。要素(`el`)を公開するので、呼び出し側が好きな場所へ
 * 差し込める（現状は回転比パネルの「スリット数」の右隣に配置）。
 * 高さは隣の「スリット数」セルに揃え、ラベルは付けない（アイコンのみ）。
 */
export class PlayButton {
  readonly el: HTMLButtonElement;

  constructor(hooks: PlayHooks) {
    this.el = document.createElement("button");
    this.el.id = "play-button";
    this.el.className = "play-fab";
    this.el.onclick = () => hooks.toggle();
    this.update(hooks.isPaused());
  }

  /** 一時停止状態に合わせてアイコンを更新（停止中は▶＝押せば動く） */
  update(paused: boolean): void {
    this.el.textContent = paused ? "▶" : "⏸";
    this.el.classList.toggle("is-paused", paused);
    this.el.title = paused ? "再生" : "停止";
    this.el.setAttribute("aria-label", paused ? "再生" : "停止");
  }
}
