import {
  BASE_OMEGA,
  STAGE_MAX_HEIGHT,
  TRIM_HEIGHT,
  TRIM_OFFSET,
  ZOOM_MAX,
  ZOOM_MIN,
  type Params,
} from "../config";
import type { Picture } from "../images";

/** 表示モード：両方 / 左のみフォーカス / 右のみフォーカス */
export type FocusMode = "both" | "left" | "right";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * アノルソスコープの描画エンジン。
 *
 * 設計上の要点（クラッシュ対策）:
 *  - 内部解像度をステージ高さ STAGE_MAX_HEIGHT で頭打ちにし、表示は CSS で拡大。
 *    プロジェクタの物理解像度に依存せず負荷が一定。
 *  - オフスクリーン Canvas を使い回す。毎フレームの getImageData / 新規確保を行わず、
 *    ストリップ抽出は drawImage のソース矩形クロップ（GPU 支援・無確保）で行う。
 *  - requestAnimationFrame の delta-time で角度を進め、フレームレート非依存。
 *
 * フォーカスモード：どちらかの円をクリックすると、その円だけをステージ全体に
 * 表示する（`setFocus`）。フォーカス中はその円のバッファをステージ全体解像度
 * （stageW x stageH）で再構築し、ドラッグでパン・ボタンでズームができる。
 * 非表示側のパネルは描画自体をスキップする（stampRightPanel は this.left に
 * 依存しないため、focus='right' のとき drawLeftPanel を丸ごと省略できる）。
 */
export class Simulation {
  private readonly view: HTMLCanvasElement;
  private readonly vctx: CanvasRenderingContext2D;

  // オフスクリーンバッファ（使い回し）
  private readonly left = document.createElement("canvas");
  private readonly right = document.createElement("canvas");
  private readonly sample = document.createElement("canvas");
  private readonly plate = document.createElement("canvas"); // スリット板（黒円盤＋透明窓）
  private lctx!: CanvasRenderingContext2D;
  private rctx!: CanvasRenderingContext2D;
  private sctx!: CanvasRenderingContext2D;
  private platectx!: CanvasRenderingContext2D;

  // 内部解像度
  private stageW = 0;
  private stageH = 0;

  private picture: Picture | null = null;
  private scale = 1; // 画像表示スケール
  private trimWidth = 0; // スリット長
  private sampleSize = 0; // sample バッファ一辺
  // 2 円の間に中央スペースを空けるための、各バッファ内での円盤中心 X/Y
  // （フォーカス中は該当パネルのみ stageW/2, stageH/2 に設定される）
  private leftCx = 0;
  private leftCy = 0;
  private rightCx = 0;
  private rightCy = 0;
  private plateR = 0; // スリット板の半径（回転画像を覆う）

  // 縦横モード
  private stackAxis: "horizontal" | "vertical" = "horizontal";

  // スリット板の表示/非表示クロスフェード（0=非表示, 1=表示）
  private slitPlateOpacity = 0;
  private static readonly SLIT_PLATE_FADE_SEC = 0.3;

  // 蓄積される回転角
  private imageAngle = 0;
  private slitAngle = 0;

  // フォーカスモード・パン・ズーム
  private focus: FocusMode = "both";
  private panX = 0;
  private panY = 0;
  private zoomScale = 1;

  constructor(view: HTMLCanvasElement) {
    this.view = view;
    this.vctx = must(view.getContext("2d", { alpha: false }));
    this.lctx = must(this.left.getContext("2d", { alpha: false }));
    this.rctx = must(this.right.getContext("2d", { alpha: false }));
    this.sctx = must(this.sample.getContext("2d", { alpha: true }));
    this.platectx = must(this.plate.getContext("2d", { alpha: true }));
  }

  /** CSS 表示サイズ（px）に合わせて内部解像度を決め直す */
  resize(cssW: number, cssH: number): void {
    const dispW = Math.max(1, Math.floor(cssW));
    const dispH = Math.max(1, Math.floor(cssH));

    // 内部高さを上限で頭打ち。幅はアスペクト維持だが過大にならないよう制限
    const h = Math.min(STAGE_MAX_HEIGHT, dispH);
    const w = Math.min(Math.round((h * dispW) / dispH), STAGE_MAX_HEIGHT * 4);
    this.stageW = Math.max(2, w);
    this.stageH = Math.max(2, h);

    // 表示解像度＝内部解像度（CSS で拡大表示）
    this.view.width = this.stageW;
    this.view.height = this.stageH;

    // バッファサイズは recomputeLayout（フォーカスモードに応じて分岐）が決める
    this.recomputeLayout();
    this.reset();
    this.clampPan();
  }

  setImage(picture: Picture | null): void {
    this.picture = picture;
    this.recomputeLayout();
    this.reset();
  }

  // =========================================================
  // フォーカス・パン・ズーム
  // =========================================================
  getFocus(): FocusMode {
    return this.focus;
  }

  /** 内部ステージ高さ[px]。main.ts が CSS px ↔ ステージ px の換算に使う */
  getStageHeight(): number {
    return this.stageH;
  }

  getRotRatioAnchor(): { axis: "horizontal" | "vertical"; x: number; y: number } {
    if (this.stackAxis === "vertical") {
      const topCircleBottom = this.leftCy + this.plateR;
      const bottomCircleTop = this.left.height + this.rightCy - this.plateR;
      return { axis: "vertical", x: this.stageW / 2, y: (topCircleBottom + bottomCircleTop) / 2 };
    }
    return { axis: "horizontal", x: this.stageW / 2, y: this.stageH * 0.94 };
  }

  setFocus(mode: FocusMode): void {
    if (mode === this.focus) return;
    this.focus = mode;
    this.panX = 0;
    this.panY = 0;
    this.zoomScale = 1;
    this.recomputeLayout();
    this.reset();
  }

  /** dx/dy はステージ内部px単位（呼び出し側で CSS px から変換済み） */
  pan(dx: number, dy: number): void {
    if (this.focus === "both") return;
    this.panX += dx;
    this.panY += dy;
    this.clampPan();
  }

  zoomBy(factor: number): void {
    if (this.focus === "both") return;
    this.zoomScale = clamp(this.zoomScale * factor, ZOOM_MIN, ZOOM_MAX);
    this.clampPan();
  }

  resetView(): void {
    if (this.focus === "both") return;
    this.panX = 0;
    this.panY = 0;
    this.zoomScale = 1;
  }

  /** ズーム後、拡大された画像が常にステージ全体を覆うようパン量を制限する */
  private clampPan(): void {
    const maxX = (this.stageW * (this.zoomScale - 1)) / 2;
    const maxY = (this.stageH * (this.zoomScale - 1)) / 2;
    this.panX = clamp(this.panX, -maxX, maxX);
    this.panY = clamp(this.panY, -maxY, maxY);
  }

  /** 画像スケール・スリット長・バッファサイズ・円盤中心を再計算（フォーカスモードで分岐） */
  private recomputeLayout(): void {
    if (!this.picture || this.stageH === 0) return;
    if (this.focus === "both") {
      this.layoutBoth();
    } else {
      this.layoutFocused(this.focus);
    }
  }

  private isPortraitStage(): boolean {
    return this.stageW < this.stageH;
  }

  /** 両方表示：軸分岐 */
  private layoutBoth(): void {
    this.stackAxis = this.isPortraitStage() ? "vertical" : "horizontal";
    if (this.stackAxis === "vertical") {
      this.layoutBothVertical();
    } else {
      this.layoutBothHorizontal();
    }
  }

  /** 両方表示（水平）：左右バッファを半幅ずつ、中央にギャップ・外側に余白 */
  private layoutBothHorizontal(): void {
    const halfW = Math.floor(this.stageW / 2);
    // stageW が奇数の場合、右バッファは stageW - halfW（= halfW+1）にして
    // 2枚の drawImage が stageW 全域を隙間なく覆うようにする（右端に bgColor の
    // 1px帯が露出するのを防ぐ）。
    const rightW = this.stageW - halfW;
    this.left.width = halfW;
    this.left.height = this.stageH;
    this.right.width = rightW;
    this.right.height = this.stageH;
    this.plate.width = halfW;
    this.plate.height = this.stageH;

    // 2 円の間に中央スペース（回転比パネル用）＋ 左右端の余白を空ける
    const gap = Math.min(380, Math.max(240, this.stageW * 0.18));
    const outerM = Math.max(28, this.stageW * 0.035); // ウィンドウ左右端の余白
    const contentW = Math.max(20, halfW - gap / 2 - outerM);
    this.leftCx = outerM + contentW / 2; // 左：外側に余白、中央側にギャップ
    this.rightCx = gap / 2 + contentW / 2; // 右：中央側にギャップ、外側に余白

    this.applyImageMetrics(contentW, this.stageH);
    this.leftCy = this.left.height / 2;
    this.rightCy = this.right.height / 2;
  }

  /** 両方表示（垂直）：上下バッファを半高さずつ、上下にギャップ・外側に余白 */
  private layoutBothVertical(): void {
    const halfH = Math.floor(this.stageH / 2);
    const rightH = this.stageH - halfH;
    this.left.width = this.stageW;
    this.left.height = halfH;
    this.right.width = this.stageW;
    this.right.height = rightH;
    this.plate.width = this.stageW;
    this.plate.height = halfH;

    const gap = Math.min(220, Math.max(120, this.stageH * 0.14));
    const outerM = Math.max(20, this.stageH * 0.03);
    const contentH = Math.max(20, halfH - gap / 2 - outerM);
    this.leftCx = this.stageW / 2;
    this.rightCx = this.stageW / 2;
    this.leftCy = outerM + contentH / 2;
    this.rightCy = gap / 2 + contentH / 2;

    const contentSize = Math.min(this.stageW, contentH);
    this.applyImageMetrics(contentSize, contentSize);
  }

  /** 単一パネルにフォーカス：そのバッファをステージ全体解像度にして中央に大きく表示 */
  private layoutFocused(which: "left" | "right"): void {
    const buf = which === "left" ? this.left : this.right;
    buf.width = this.stageW;
    buf.height = this.stageH;
    // スリット板は左パネル専用の概念だが、フォーカス中も解像度を合わせておく
    this.plate.width = this.stageW;
    this.plate.height = this.stageH;

    if (which === "left") {
      this.leftCx = this.stageW / 2;
      this.leftCy = this.stageH / 2;
    } else {
      this.rightCx = this.stageW / 2;
      this.rightCy = this.stageH / 2;
    }

    this.applyImageMetrics(this.stageW, this.stageH);
  }

  /** 画像スケール・スリット長・plateR・sample バッファサイズを計算（両モード共通） */
  private applyImageMetrics(contentW: number, contentH: number): void {
    if (!this.picture) return;
    const { width: iw, height: ih } = this.picture;
    this.scale = Math.min(contentW / iw, contentH / ih);
    const dw = iw * this.scale;
    const dh = ih * this.scale;
    this.trimWidth = Math.max(1, Math.floor(Math.min(dw, dh) / 2) - TRIM_OFFSET);
    // 円盤は画像が通常表示で占めるのと同じ大きさ（赤いガイド枠と見た目の比率を揃える）
    this.plateR = Math.min(contentW, contentH) / 2;

    // 回転した画像がはみ出さない一辺（対角）。中心にストリップ抽出領域が収まる
    const diag = Math.ceil(Math.hypot(dw, dh)) + 2 * TRIM_OFFSET;
    if (diag !== this.sampleSize) {
      this.sampleSize = diag;
      this.sample.width = diag;
      this.sample.height = diag;
    }
  }

  /** バッファを現在の背景色でクリアし角度を初期化 */
  reset(): void {
    this.imageAngle = 0;
    this.slitAngle = 0;
    fillSolid(this.lctx, this.left, this.bgColor);
    fillSolid(this.rctx, this.right, this.bgColor);
    this.composite(false);
  }

  /**
   * 1 フレーム進める。
   * @param dt   経過秒
   * @param params 現在のパラメータ
   * @param paused 停止中か
   */
  render(dt: number, params: Params, paused: boolean): void {
    this.currentNumSlits = params.numSlits;
    this.advanceSlitPlateFade(dt, params.slitPlate);
    if (this.picture && !paused) {
      this.advance(dt, params);
      // 完全にフェードインし終わるまでは残像ありの通常描画のまま
      // （円盤オーバーレイがまだ薄いうちに、下の絵だけ先にクリップ・残像消去されるのを防ぐ）
      const useSlitClip = this.slitPlateOpacity >= 1;
      if (this.focus !== "right") this.drawLeftPanel(useSlitClip, params.fadeAlpha, this.bgColor);
      if (this.focus !== "left") this.stampRightPanel(params);
    }
    this.composite(params.showGuideLines);
  }

  /** スリット板の表示/非表示を SLIT_PLATE_FADE_SEC 秒かけて滑らかに切り替える */
  private advanceSlitPlateFade(dt: number, slitPlate: boolean): void {
    const target = slitPlate ? 1 : 0;
    const rate = dt / Simulation.SLIT_PLATE_FADE_SEC;
    if (this.slitPlateOpacity < target) {
      this.slitPlateOpacity = Math.min(target, this.slitPlateOpacity + rate);
    } else if (this.slitPlateOpacity > target) {
      this.slitPlateOpacity = Math.max(target, this.slitPlateOpacity - rate);
    }
  }

  private advance(dt: number, p: Params): void {
    const omega = BASE_OMEGA * p.speed * dt;
    this.imageAngle += omega * p.imageRotFactor;
    this.slitAngle += omega * p.slitRotFactor;
  }

  /** 左パネル：回転画像を描画。通常は残像フェード、スリット板モード時は残像なし */
  private drawLeftPanel(slitPlate: boolean, fadeAlpha: number, bgColor: string): void {
    const ctx = this.lctx;
    const cx = this.leftCx;
    const cy = this.leftCy;

    if (slitPlate) {
      // スリット板モード：残像なし。画像は円盤内だけに描く
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, this.plateR, 0, Math.PI * 2);
      ctx.clip();
      this.drawPictureRotated(ctx, cx, cy, this.imageAngle);
      ctx.restore();
    } else {
      // 通常モード：bgColor へフェード（このバッファがそのまま composite で描画されるため）
      ctx.globalAlpha = fadeAlpha;
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, this.left.width, this.left.height);
      ctx.globalAlpha = 1;
      this.drawPictureRotated(ctx, cx, cy, this.imageAngle);
    }
  }

  /** 右パネル：各スリットのストリップを抽出し、蓄積バッファへ配置 */
  private stampRightPanel(p: Params): void {
    const ctx = this.rctx;
    // 蓄積フェード（bgColor へフェード。このバッファがそのまま composite で描画されるため）
    ctx.globalAlpha = p.fadeAlpha;
    ctx.fillStyle = this.bgColor;
    ctx.fillRect(0, 0, this.right.width, this.right.height);
    ctx.globalAlpha = 1;

    if (!this.picture) return;

    const cx = this.rightCx;
    const cy = this.rightCy;
    const sc = this.sampleSize / 2; // sample バッファ中心
    const n = p.numSlits;

    for (let i = 0; i < n; i++) {
      const theta = (i * Math.PI * 2) / n;

      // sample バッファに、スリット方向が水平になる向きで回転画像を描画
      this.sctx.clearRect(0, 0, this.sampleSize, this.sampleSize);
      this.drawPictureRotated(
        this.sctx,
        sc,
        sc,
        this.imageAngle - this.slitAngle - theta,
      );

      // 中心から +x 側の水平ストリップを、右パネルの該当スリット位置へ配置
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.slitAngle + theta);
      ctx.drawImage(
        this.sample,
        sc + TRIM_OFFSET, // sx
        sc - TRIM_HEIGHT / 2, // sy
        this.trimWidth, // sw
        TRIM_HEIGHT, // sh
        TRIM_OFFSET, // dx
        -TRIM_HEIGHT / 2, // dy
        this.trimWidth, // dw
        TRIM_HEIGHT, // dh
      );
      ctx.restore();
    }
  }

  private drawPictureRotated(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    angle: number,
  ): void {
    if (!this.picture) return;
    const dw = this.picture.width * this.scale;
    const dh = this.picture.height * this.scale;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.drawImage(this.picture.bitmap, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }

  /** 可視 Canvas を再構成：両方表示 or 単一パネルにフォーカス（パン・ズーム適用） */
  private composite(showGuides: boolean): void {
    if (this.focus === "both") {
      this.compositeBoth(showGuides);
    } else {
      this.compositeFocused(this.focus, showGuides);
    }
  }

  private compositeBoth(showGuides: boolean): void {
    const ctx = this.vctx;
    ctx.fillStyle = this.bgColor;
    ctx.fillRect(0, 0, this.stageW, this.stageH);

    let leftGx: number, leftGy: number, rightGx: number, rightGy: number;

    if (this.stackAxis === "vertical") {
      const offsetY = this.left.height;
      ctx.drawImage(this.left, 0, 0);
      ctx.drawImage(this.right, 0, offsetY);
      leftGx = this.leftCx;
      leftGy = this.leftCy;
      rightGx = this.rightCx;
      rightGy = offsetY + this.rightCy;
    } else {
      const offsetX = this.left.width;
      ctx.drawImage(this.left, 0, 0);
      ctx.drawImage(this.right, offsetX, 0);
      leftGx = this.leftCx;
      leftGy = this.leftCy;
      rightGx = offsetX + this.rightCx;
      rightGy = this.rightCy;
    }

    // スリット板（フェードイン）と赤ガイド枠（フェードアウト）をクロスフェード
    if (this.slitPlateOpacity > 0 && this.picture) {
      this.drawSlitPlate(this.leftCx, this.leftCy, this.slitPlateOpacity);
    }
    if (showGuides && this.picture && this.slitPlateOpacity < 1) {
      const guideAlpha = 1 - this.slitPlateOpacity;
      this.drawGuideLines(leftGx, leftGy, guideAlpha);
      this.drawGuideLines(rightGx, rightGy, guideAlpha);
    }
  }

  /** 単一パネルにフォーカス：そのバッファをパン・ズームしてステージ全体に表示 */
  private compositeFocused(which: "left" | "right", showGuides: boolean): void {
    const ctx = this.vctx;
    ctx.fillStyle = this.bgColor;
    ctx.fillRect(0, 0, this.stageW, this.stageH);

    const buf = which === "left" ? this.left : this.right;
    const cx = which === "left" ? this.leftCx : this.rightCx; // stageW/2（layoutFocused 済み）
    const cy = this.stageH / 2;

    ctx.save();
    ctx.translate(this.stageW / 2 + this.panX, this.stageH / 2 + this.panY);
    ctx.scale(this.zoomScale, this.zoomScale);
    ctx.translate(-cx, -cy);
    ctx.drawImage(buf, 0, 0);

    if (which === "left" && this.slitPlateOpacity > 0 && this.picture) {
      // スリット板は左パネル専用の概念（both モードと同じ扱い）
      this.drawSlitPlate(cx, cy, this.slitPlateOpacity);
    }
    if (showGuides && this.picture && (which !== "left" || this.slitPlateOpacity < 1)) {
      const guideAlpha = which === "left" ? 1 - this.slitPlateOpacity : 1;
      this.drawGuideLines(cx, cy, guideAlpha);
    }
    ctx.restore();
  }

  /** 左パネルに、黒い円盤＋透明のスリット窓（スリット板）を重ねる */
  private drawSlitPlate(cx: number, cy: number, alpha: number): void {
    const ctx = this.platectx;
    const n = this.currentNumSlits;
    ctx.clearRect(0, 0, this.plate.width, this.plate.height);

    // 黒い円盤
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(cx, cy, this.plateR, 0, Math.PI * 2);
    ctx.fill();

    // スリット窓を切り抜く（透明化）
    ctx.globalCompositeOperation = "destination-out";
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.slitAngle);
    for (let i = 0; i < n; i++) {
      ctx.save();
      ctx.rotate((i * Math.PI * 2) / n);
      ctx.fillRect(TRIM_OFFSET, -TRIM_HEIGHT / 2, this.trimWidth, TRIM_HEIGHT);
      ctx.restore();
    }
    ctx.restore();
    ctx.globalCompositeOperation = "source-over";

    // 円周枠線（白色1px）
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, this.plateR, 0, Math.PI * 2);
    ctx.stroke();

    this.vctx.globalAlpha = alpha;
    this.vctx.drawImage(this.plate, 0, 0);
    this.vctx.globalAlpha = 1;
  }

  private drawGuideLines(cx: number, cy: number, alpha: number): void {
    const ctx = this.vctx;
    const n = this.currentNumSlits;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.rotate(this.slitAngle);
    ctx.strokeStyle = "rgba(240,0,0,0.9)";
    ctx.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      ctx.save();
      ctx.rotate((i * Math.PI * 2) / n);
      ctx.strokeRect(TRIM_OFFSET, -TRIM_HEIGHT / 2, this.trimWidth, TRIM_HEIGHT);
      ctx.restore();
    }
    ctx.restore();
  }

  // composite 時に使用するパラメータ
  private currentNumSlits = 4;
  private bgColor = "#000000";

  setBgColor(hex: string): void {
    this.bgColor = hex;
    // フェード合成は8bit丸め誤差により厳密に収束しきらないため、
    // 色変更時はバッファを新しい背景色で即座に塗りつぶし、体感の遅延・誤差を無くす。
    fillSolid(this.lctx, this.left, hex);
    fillSolid(this.rctx, this.right, hex);
  }
}

function must<T>(v: T | null): T {
  if (!v) throw new Error("2D context unavailable");
  return v;
}

function fillSolid(ctx: CanvasRenderingContext2D, c: HTMLCanvasElement, color: string): void {
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
}
