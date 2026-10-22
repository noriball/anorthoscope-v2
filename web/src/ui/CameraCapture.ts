import { t } from "../i18n";
import { showToast } from "./toast";

/** getUserMedia が使えるか（https か localhost のみ。非対応環境では呼び出し側がボタンを出さない） */
export function cameraAvailable(): boolean {
  return window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
}

/** 起動中のカメラ。video はライブ映像（画面には載せず、描画元として使う） */
export interface CameraSession {
  readonly video: HTMLVideoElement;
  /** 複数のカメラ（前面/背面など）があるか */
  readonly canSwitch: boolean;
  switchCamera(): Promise<void>;
  /** いまの 1 フレームを画像にする */
  capture(): Promise<ImageBitmap>;
  stop(): void;
}

/** カメラを起動する。許可されない・見つからない等の失敗はトーストで知らせて null を返す。 */
export async function openCamera(): Promise<CameraSession | null> {
  let facing: "user" | "environment" = "environment";
  let stream: MediaStream | null = null;

  const video = document.createElement("video");
  video.playsInline = true;
  video.muted = true;
  // WebKit は DOM に無い video のフレームを更新しないことがあるため、見えない形で置いておく
  video.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
  document.body.append(video);

  const stopTracks = () => {
    stream?.getTracks().forEach((tr) => tr.stop());
    stream = null;
  };

  const start = async (): Promise<void> => {
    stopTracks();
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
  };

  try {
    await start();
  } catch (e) {
    stopTracks();
    video.remove();
    const name = (e as DOMException).name;
    if (name === "NotAllowedError" || name === "SecurityError") showToast(t("camera.denied"));
    else if (name === "NotFoundError" || name === "OverconstrainedError") showToast(t("camera.notFound"));
    else showToast(t("camera.error"));
    return null;
  }

  const inputs = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((d) => d.kind === "videoinput");

  return {
    video,
    canSwitch: inputs.length > 1,
    async switchCamera() {
      facing = facing === "environment" ? "user" : "environment";
      try {
        await start();
      } catch {
        showToast(t("camera.error"));
      }
    },
    capture: () => createImageBitmap(video),
    stop() {
      stopTracks();
      video.srcObject = null;
      video.remove();
    },
  };
}
