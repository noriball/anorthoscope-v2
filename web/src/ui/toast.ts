let toastEl: HTMLDivElement | null = null;
let hideTimer = 0;

/** 画面下部に短いメッセージを一瞬表示する（保存完了など） */
export function showToast(message: string): void {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "toast";
    document.body.append(toastEl);
  }
  toastEl.textContent = message;
  // 連続呼び出し時にアニメーションをリスタートさせる
  toastEl.classList.remove("show");
  void toastEl.offsetWidth;
  toastEl.classList.add("show");

  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    toastEl?.classList.remove("show");
  }, 1600);
}
