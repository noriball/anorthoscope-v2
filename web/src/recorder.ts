// canvas をそのまま動画として録画し、ファイルとしてダウンロードする。
// MediaRecorder + canvas.captureStream() というブラウザ標準APIのみで実装
// （GIFはエンコーダのライブラリ依存が必要になるため、依存ゼロ方針に合わせ動画のみ対応）。

const CANDIDATE_MIME_TYPES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4;codecs=avc1",
  "video/mp4",
];

/** この環境で書き出せる動画形式を1つ選ぶ。対応なしなら null */
function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const type of CANDIDATE_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return null;
}

export interface Recording {
  /** 録画を止めてファイルをダウンロードする。停止処理が終わったら解決する */
  stop(): Promise<void>;
}

/** canvas の描画をそのまま動画として録画開始する。対応環境が無ければ null を返す。
 *  onAutoStop は、呼び出し側の maxDurationMs 到達などで録画側から自動停止したときに呼ばれる
 *  （呼び出し側がボタン表示を「停止済み」に戻すためのフック）。 */
export function startRecording(
  canvas: HTMLCanvasElement,
  fps: number,
  maxDurationMs: number,
  onAutoStop: () => void,
): Recording | null {
  const mimeType = pickMimeType();
  if (!mimeType) return null;

  const stream = canvas.captureStream(fps);
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream, { mimeType });
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => {
      clearTimeout(maxTimer);
      for (const track of stream.getTracks()) track.stop();
      const blob = new Blob(chunks, { type: mimeType });
      const ext = mimeType.startsWith("video/mp4") ? "mp4" : "webm";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `anorthoscope_${Date.now()}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      resolve();
    };
  });

  recorder.start();
  const maxTimer = window.setTimeout(() => {
    if (recorder.state !== "inactive") recorder.stop();
    onAutoStop();
  }, maxDurationMs);

  return {
    stop: () => {
      if (recorder.state !== "inactive") recorder.stop();
      return stopped;
    },
  };
}
