export interface PlayHooks {
  toggle(): void;
  isPaused(): boolean;
}

/**
 * 再生／停止の円形ボタン。要素(`el`)を公開するので、呼び出し側が好きな場所へ
 * 差し込める（現状は回転比パネルの「スリット数」の右隣に配置）。
 */
export class PlayButton {
  readonly el: HTMLDivElement;
  private readonly btn: HTMLButtonElement;
  private readonly label: HTMLSpanElement;

  constructor(hooks: PlayHooks) {
    this.el = document.createElement("div");
    this.el.id = "play-button";

    this.btn = document.createElement("button");
    this.btn.className = "play-fab";
    this.btn.onclick = () => hooks.toggle();

    this.label = document.createElement("span");
    this.label.className = "play-fab-label";

    this.el.append(this.btn, this.label);
    this.update(hooks.isPaused());
  }

  /** 一時停止状態に合わせてアイコン・ラベルを更新 */
  update(paused: boolean): void {
    // 停止中は「再生（▶）」、再生中は「停止（⏸）」を提示
    this.btn.textContent = paused ? "▶" : "⏸";
    this.label.textContent = paused ? "再生" : "停止";
    this.btn.classList.toggle("is-paused", paused);
    this.btn.title = paused ? "再生" : "停止";
  }
}
