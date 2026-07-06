// 扇形（円の 1/K）⇔ 360° 全周画像の、極座標ラップによる相互変換。
// ペイントモード（wedgeToFull）と圧縮モード（fullToWedge）の両方で使う共有ロジック。
// 幾何は検証済み（web/scripts/verify-stretch.mjs）: 半径は中心からの実際のユークリッド
// 距離をそのまま保存し、角度だけを K 倍/K 分の1にする（高さを半径にする、ではない）。

const CENTER_ANGLE = -Math.PI / 2; // 扇形の中心方向（真上）

/**
 * 扇形の内容（1辺 size の正方形、中心 (size/2,size/2) に扇の頂点）を、
 * 極座標で 360° へラップして展開する（ペイントモードの「引き伸ばし」）。
 *   逆変換（出力ピクセル → 元画像）: R=hypot(dx,dy)（半径そのまま）、
 *   θ=atan2(dx,-dy)（真上=0）、β=θ/K、元画像=(c+R·sinβ, c−R·cosβ)。
 */
export function wedgeToFull(src: ImageData, size: number, outN: number, divisions: number): ImageData {
  const out = new ImageData(outN, outN);
  const s = src.data;
  const o = out.data;
  const c = outN / 2;
  const cx = size / 2;
  const cy = size / 2;
  const scale = size / outN; // 出力半径 → 元画像半径
  const K = divisions;

  for (let y = 0; y < outN; y++) {
    const dy = y - c;
    for (let x = 0; x < outN; x++) {
      const dx = x - c;
      const rOut = Math.hypot(dx, dy);
      if (rOut > c) continue; // 円外は透明
      const theta = Math.atan2(dx, -dy);
      const beta = theta / K;
      const r = rOut * scale;
      const fx = cx + r * Math.sin(beta);
      const fy = cy - r * Math.cos(beta);

      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      if (x0 < 0 || y0 < 0 || x0 >= size - 1 || y0 >= size - 1) continue;
      const ax = fx - x0;
      const ay = fy - y0;
      const i00 = (y0 * size + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + size * 4;
      const i11 = i01 + 4;
      const w00 = (1 - ax) * (1 - ay);
      const w10 = ax * (1 - ay);
      const w01 = (1 - ax) * ay;
      const w11 = ax * ay;
      const di = (y * outN + x) * 4;
      for (let ch = 0; ch < 4; ch++) {
        o[di + ch] = s[i00 + ch] * w00 + s[i10 + ch] * w10 + s[i01 + ch] * w01 + s[i11 + ch] * w11;
      }
    }
  }
  return out;
}

/**
 * wedgeToFull の厳密な逆（順写像）：360° 全周画像 full を、扇形（1/K）へ圧縮する
 * （圧縮モードの本体、およびペイントモードの再編集時の扇形復元に使う）。
 *   元画像の点 (x,y): dx=x−c, dy=c−y, r=hypot(dx,dy), β=atan2(dx,dy)（中心軸から）、
 *   |β| ≤ π/K のみ扇形内。θ=K·β、展開後位置=(c+r·sinθ, c−r·cosθ) から色を拾う。
 */
export function fullToWedge(full: ImageData, size: number, divisions: number): ImageData {
  const out = new ImageData(size, size);
  const s = full.data;
  const o = out.data;
  const c = size / 2;
  const R = size / 2;
  const K = divisions;
  const halfBeta = Math.PI / K;

  for (let y = 0; y < size; y++) {
    const dy = c - y; // 高さ（中心より上のみ）
    if (dy <= 0) continue;
    for (let x = 0; x < size; x++) {
      const dx = x - c;
      const r = Math.hypot(dx, dy);
      if (r > R) continue;
      const beta = Math.atan2(dx, dy);
      if (Math.abs(beta) > halfBeta) continue; // 扇形外
      const theta = K * beta;
      const sx = Math.round(c + r * Math.sin(theta));
      const sy = Math.round(c - r * Math.cos(theta));
      if (sx < 0 || sy < 0 || sx >= size || sy >= size) continue;
      const si = (sy * size + sx) * 4;
      const di = (y * size + x) * 4;
      o[di] = s[si];
      o[di + 1] = s[si + 1];
      o[di + 2] = s[si + 2];
      o[di + 3] = s[si + 3];
    }
  }
  return out;
}

// CENTER_ANGLE は他モジュールでの扇形パス描画（この幾何と対応する上向き基準）用に export
export { CENTER_ANGLE };
