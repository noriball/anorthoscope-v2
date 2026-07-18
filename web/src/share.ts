import {
  type Params,
  SPEED_MIN,
  SPEED_MAX,
  ROT_FACTOR_MIN,
  ROT_FACTOR_MAX,
  SLITS_MIN,
  SLITS_MAX,
  FADE_MIN,
  FADE_MAX,
  BG_MIN,
  BG_MAX,
} from "./config";

/** 共有リンクにエンコードする現在の状態 */
export interface ShareState {
  params: Params;
  /** 背景色スライダーの値（0〜255）。hex では丸め・変換の分だけ誤差が出るため生値で持つ */
  bgValue: number;
  /** サンプル画像のファイル名。自作の絵はこのブラウザにしか無く共有できないため省略する */
  imageName?: string;
  /** プリセットのスリット形状 id。自作スリットは同様の理由で省略する */
  slitId?: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 現在の状態を URL クエリ文字列にエンコードする（先頭に "?" は付かない） */
export function encodeShareState(s: ShareState): string {
  const p = s.params;
  const q = new URLSearchParams();
  q.set("sp", p.speed.toFixed(2));
  q.set("ir", String(Math.round(p.imageRotFactor)));
  q.set("sr", String(Math.round(p.slitRotFactor)));
  q.set("sl", String(Math.round(p.numSlits)));
  q.set("fa", p.fadeAlpha.toFixed(4));
  q.set("si", p.showImage ? "1" : "0");
  q.set("gl", p.showGuideLines ? "1" : "0");
  q.set("pl", p.slitPlate ? "1" : "0");
  q.set("bg", String(Math.round(s.bgValue)));
  if (s.imageName) q.set("img", s.imageName);
  if (s.slitId) q.set("slit", s.slitId);
  return q.toString();
}

export interface DecodedShareState {
  params: Partial<Params>;
  bgValue?: number;
  imageName?: string;
  slitId?: string;
}

/** URL クエリ文字列から状態を復元する。クエリが無ければ null。
 *  壊れた値・無い値は個別に省略し、来歴不明な数値は可動域にクランプする
 *  （手で書き換えた URL などで不正な値が来ても壊れないようにする）。 */
export function decodeShareState(search: string): DecodedShareState | null {
  const q = new URLSearchParams(search);
  if ([...q.keys()].length === 0) return null;

  const num = (key: string): number | undefined => {
    const v = q.get(key);
    if (v === null) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const bool = (key: string): boolean | undefined => {
    const v = q.get(key);
    return v === null ? undefined : v === "1";
  };

  const params: Partial<Params> = {};
  const sp = num("sp");
  if (sp !== undefined) params.speed = clamp(sp, SPEED_MIN, SPEED_MAX);
  const ir = num("ir");
  if (ir !== undefined) params.imageRotFactor = clamp(Math.round(ir), ROT_FACTOR_MIN, ROT_FACTOR_MAX);
  const sr = num("sr");
  if (sr !== undefined) params.slitRotFactor = clamp(Math.round(sr), ROT_FACTOR_MIN, ROT_FACTOR_MAX);
  const sl = num("sl");
  if (sl !== undefined) params.numSlits = clamp(Math.round(sl), SLITS_MIN, SLITS_MAX);
  const fa = num("fa");
  if (fa !== undefined) params.fadeAlpha = clamp(fa, FADE_MIN, FADE_MAX);
  const si = bool("si");
  if (si !== undefined) params.showImage = si;
  const gl = bool("gl");
  if (gl !== undefined) params.showGuideLines = gl;
  const pl = bool("pl");
  if (pl !== undefined) params.slitPlate = pl;

  const bgRaw = num("bg");
  const bgValue = bgRaw !== undefined ? clamp(Math.round(bgRaw), BG_MIN, BG_MAX) : undefined;
  const imageName = q.get("img") ?? undefined;
  const slitId = q.get("slit") ?? undefined;

  return { params, bgValue, imageName, slitId };
}
