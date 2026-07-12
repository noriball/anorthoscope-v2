#!/usr/bin/env node
//
// スリット形状プリセット生成（幾何学的な、一定太さのライン）
//
// 【重要】ImageMagick の SVG ラスタライザは CSS <style> を無視し、パスを塗り
//   つぶす。よって stroke で「線」を描くと意図せず塗りになり、曲線では
//   「中央が太い葉っぱ形」になってしまう（＝太いところ・細い所）。
//
// 【対策】ストロークに頼らず、各スリットを「一定の水平幅 W を持つ帯（ポリゴン）」
//   として明示的に構築する。水平幅＝スリットの厚み（スリットは放射=縦向き）なので、
//   中心から外周まで完全に一定太さになる。塗り色はインライン属性 fill="#fff"
//   （CSS でなく属性なので ImageMagick も従う）。
//
// 【形状】中心線 cx(u)（u=r/R, r は中心からの距離）だけを形状ごとに変える：
//   直線=0 / 斜め=非放射の傾き / ギザギザ=三角波 / 波形=正弦波 /
//   二重=中心を外した平行2本 / 曲線=弓形。いずれも非放射（直線以外）なので
//   アノルソスコープ像が歪む。
//
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SIZE = 800;
const C = SIZE / 2; // 中心 = 400
const TIP = -6; // 外周側の先端 y（PNG端 <0 まで引いて外周を確実に塗り切る）
const R = C - TIP; // 外周側の到達距離 = 406（半径 400 = ディスク外周を超える）
const R0 = 8; // 中心側の開始半径（中心に小さな穴＝既定スリットの TRIM_OFFSET と同様）
const W = 6; // 線の太さ（一定・変わらない）
const K = 200; // 外周での中心線の最大振れ幅。扇形(半角 atan(K/R)≈26°)に収まる包絡
const N = 240; // 線を刻むステップ数
const OUTPUT_DIR =
  "/Volumes/DATA-20TB01/projects/Anorthoscpe_simulator/web/public/presets/slits";

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const f = (n) => n.toFixed(2);

/** 中心線 off(u)（u=r/R）から「太さ一定 W の線」ポリゴンの d を作る。
 *  太さはパスに対して垂直方向に ±W/2 オフセット＝どこでも厳密に一定。
 *  中心線の振れ幅は各形状側で半径に比例させ、扇形の内側に収める。
 *  rStart/rEnd で半径の一部だけ描ける（分割スリット用）。 */
function line(offFn, rStart = R0, rEnd = R) {
  // まず中心線の点列を作る
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const r = rStart + (rEnd - rStart) * t;
    const u = r / R;
    pts.push([C + offFn(u), C - r]);
  }
  // 各点で接線に垂直な方向へ ±W/2 オフセット
  const left = [];
  const right = [];
  for (let i = 0; i <= N; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(N, i + 1)];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const nx = -ty; // 法線
    const ny = tx;
    const [px, py] = pts[i];
    left.push(`${f(px + (nx * W) / 2)} ${f(py + (ny * W) / 2)}`);
    right.push(`${f(px - (nx * W) / 2)} ${f(py - (ny * W) / 2)}`);
  }
  right.reverse();
  return `M ${left.join(" L ")} L ${right.join(" L ")} Z`;
}

/** 複数の d を1つの white 塗り SVG に（fill はインライン属性＝IM も従う） */
function svg(ds) {
  const body = ds
    .map((d) => `  <path d="${d}" fill="#ffffff" fill-rule="nonzero"/>`)
    .join("\n");
  return `<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
${body}
</svg>`;
}

// 三角波（-1..1）：u に対して f 周期
const tri = (u, freq) => (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * freq * u));

// 名前は「基本」＋以降は番号（1〜）。命名しづらい形が多いため番号で統一。
const presets = [
  {
    id: "basic",
    name: "基本",
    // 中心→外周の放射直線（基準・歪みなし）
    d: () => svg([line(() => 0)]),
  },
  {
    id: "zigzag",
    name: "1",
    // 鋭い三角波（少ない頂点・角ばった折れ線）。波形（滑らか・多い）と強く差別化
    d: () => svg([line((u) => K * u * tri(u, 1.5))]),
  },
  {
    id: "wave",
    name: "2",
    // 滑らかな正弦波（多めの周期）。ギザギザ（角ばる・少ない）と対照的
    d: () => svg([line((u) => K * u * Math.sin(2 * Math.PI * 3 * u))]),
  },
  {
    id: "split",
    name: "3",
    // 外周側の半分＝左ラインのみ／中心側の半分＝右ラインのみ（食い違う2分割）
    d: () =>
      svg([
        line((u) => 0.8 * K * u, R0, R * 0.5), // 中心側（下半分）＝右ライン
        line((u) => -0.8 * K * u, R * 0.5, R), // 外周側（上半分）＝左ライン
      ]),
  },
  {
    id: "curved",
    name: "4",
    // 片側へ反る弓形（sin(πu)は中心で∝u・外周で軸へ戻る）→ 非放射・歪む
    d: () => svg([line((u) => K * Math.sin(Math.PI * u))]),
  },
];

console.log(`Generating constant-width slit presets in ${OUTPUT_DIR}...`);
presets.forEach((preset, idx) => {
  const num = String(idx + 1).padStart(2, "0");
  const filename = `${num}-${preset.id}.png`;
  const filepath = path.join(OUTPUT_DIR, filename);
  const svgFile = path.join(OUTPUT_DIR, `${filename}.svg`);
  fs.writeFileSync(svgFile, preset.d());
  try {
    execSync(`magick -background none "${svgFile}" -alpha on -depth 8 "${filepath}"`, {
      stdio: "pipe",
    });
    console.log(`✓ ${filename}`);
    fs.unlinkSync(svgFile);
  } catch (e) {
    console.error(`✗ ${filename}: ${e.message}`);
  }
});

const manifest = {
  presets: presets.map((p, idx) => ({
    name: p.name,
    file: `${String(idx + 1).padStart(2, "0")}-${p.id}.png`,
    id: p.id,
  })),
};
fs.writeFileSync(
  path.join(OUTPUT_DIR, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log("✓ manifest.json\n\nDone.");
