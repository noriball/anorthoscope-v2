// ===========================================================
// 定数・型定義
// ===========================================================

/**
 * ステージ（2パネル描画領域）の内部レンダリング高さの上限[px]。
 *
 * これがクラッシュ対策の要。プロジェクタの物理解像度に関わらず、
 * 内部バッファは常にこの高さを超えないため、メモリ・GPU 負荷が
 * 解像度² で膨張しない。CSS で表示サイズへ引き伸ばす。
 */
export const STAGE_MAX_HEIGHT = 900;

/** スリット（切片）の幅[内部px] */
export const TRIM_HEIGHT = 6;
/** 中心からスリット内側端までのオフセット[内部px] */
export const TRIM_OFFSET = 10;

/** 残像フェードの不透明度（1フレームあたり）の既定値。小さいほど残像が長く残る */
export const FADE_ALPHA = 0.01;
export const FADE_MIN = 0;
export const FADE_MAX = 0.01;
export const FADE_STEP = 0.0005;

/** 基本角速度[rad/sec]。回転比係数と速度スケールに掛かる */
export const BASE_OMEGA = 0.6;

// パラメータの可動域
export const SPEED_MIN = 0.1;
export const SPEED_MAX = 3.0;
export const SPEED_STEP = 0.1;

export const ROT_FACTOR_MIN = -360;
export const ROT_FACTOR_MAX = 360;
export const ROT_FACTOR_STEP = 1;

export const SLITS_MIN = 1;
export const SLITS_MAX = 20;

// 単一パネル・フォーカスモードのズーム可動域
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 8;
export const ZOOM_STEP_FACTOR = 1.2;

/** 画像マニフェストのパス（public/data 配下） */
export const DATA_DIR = "data";
export const MANIFEST_URL = `${DATA_DIR}/manifest.json`;

// ペイントモード
/** ペイント用キャンバスの一辺[px]（正方形。source 画像と同じ 800 に合わせる） */
export const PAINT_SIZE = 800;
/** 円の分割数（描画可能な扇形の数）の可動域 */
export const DIV_MIN = 2;
export const DIV_MAX = 8;
export const DIV_DEFAULT = 5;
/** localStorage ギャラリーのキー */
export const GALLERY_KEY = "anortho.gallery.v1";

// 圧縮モード（360°画像 → 1/K 扇形）
/** 分割数（圧縮先の扇形が円の何分の1か）の可動域。1/2〜1/16 */
export const COMPRESS_DIV_MIN = 2;
export const COMPRESS_DIV_MAX = 16;
export const COMPRESS_DIV_DEFAULT = 5;

export interface Params {
  /** 全体速度スケール */
  speed: number;
  /** 画像回転係数（整数） */
  imageRotFactor: number;
  /** スリット回転係数（整数） */
  slitRotFactor: number;
  /** スリット数 */
  numSlits: number;
  /** 右パネルの赤ガイドライン表示 */
  showGuideLines: boolean;
  /** スリット板モード：左パネルの回転画像に黒い円盤＋透明スリット窓を重ねる（赤は非表示） */
  slitPlate: boolean;
  /** 残像フェードの不透明度（左右パネル共通）。小さいほど残像が長く残る */
  fadeAlpha: number;
}

export const DEFAULT_PARAMS: Params = {
  speed: 1.0,
  imageRotFactor: -4, // 絵
  slitRotFactor: 1, // スリット
  numSlits: 4,
  showGuideLines: true,
  slitPlate: false,
  fadeAlpha: FADE_ALPHA,
};
