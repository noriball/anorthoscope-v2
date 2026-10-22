#!/usr/bin/env python3
"""
アノルソスコープ用のオリジナル元画像を、コードだけで描いて生成する。

- 扇形（円の 1/K）の中に絵を描く（頂点=中心、中心軸=真上、半角 π/K）
- web/src/engine/wedge.ts の wedgeToFull と同じ式で、360° 全周に展開して保存
- 既存作品の複製や取り込みは一切ない（すべてこのスクリプトが描く図形）

座標系（扇形の中）: x=右、y=中心から軸方向（外周=1.0）。扇形の内側は |x| <= y*tan(π/K)。
"""
import math
import random
import sys

import numpy as np
from PIL import Image, ImageChops, ImageDraw

K = 5                      # 分割数（扇形は 360/K 度 = 72°）
S = 800                    # 出力サイズ
SS = 3                     # 作画のスーパーサンプリング
W = S * SS                 # 作画キャンバスの一辺
R = W / 2                  # 外周の半径（px）
PAPER = (251, 248, 240)    # 紙の色（ほんのり暖かい白）
INK = (14, 14, 18)         # インクの色（柄の濃い部分。カラー版では各図形が個別の色を持つ）

# カラーパレット（紙の上で映える、少し深みのある色）
GREEN = (38, 150, 86)
LEAF = (86, 170, 60)
CORAL = (240, 96, 60)
ORANGE = (250, 156, 28)
GOLD = (246, 196, 40)
MAGENTA = (205, 38, 122)
RASPBERRY = (226, 48, 92)
VIOLET = (116, 58, 170)
INDIGO = (46, 56, 160)
BLUE = (30, 132, 210)
TEAL = (14, 160, 160)
PINK = (244, 112, 160)
BROWN = (112, 66, 34)


def lerp(c0, c1, t):
    return tuple(int(round(a + (b - a) * t)) for a, b in zip(c0, c1))


def hsv(h, s=0.78, v=0.92):
    """色相 h（0..1）→ RGB。"""
    import colorsys
    return tuple(int(round(c * 255)) for c in colorsys.hsv_to_rgb(h % 1.0, s, v))


def P(x, y):
    """扇形座標 → 作画キャンバスの px。"""
    return (R + x * R, R - y * R)


def px(v):
    """扇形座標の長さ → px。"""
    return v * R


def spline(pts, closed=True, n=14):
    """Catmull-Rom スプラインで滑らかな点列にする。"""
    m = len(pts)
    out = []
    rng = range(m) if closed else range(m - 1)
    for i in rng:
        p0 = pts[(i - 1) % m] if (closed or i > 0) else pts[0]
        p1 = pts[i]
        p2 = pts[(i + 1) % m]
        p3 = pts[(i + 2) % m] if (closed or i + 2 < m) else pts[-1]
        for s in range(n):
            t = s / n
            t2, t3 = t * t, t * t * t
            out.append(tuple(
                0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t
                       + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2
                       + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)
                for k in (0, 1)))
    if not closed:
        out.append(pts[-1])
    return out


def mirror(pts):
    return [(-x, y) for x, y in pts]


def new_canvas():
    img = Image.new("RGB", (W, W), PAPER)
    return img, ImageDraw.Draw(img)


def poly(d, pts, fill):
    d.polygon([P(x, y) for x, y in pts], fill=fill)


def line(d, pts, width, fill=INK):
    pp = [P(x, y) for x, y in pts]
    d.line(pp, fill=fill, width=max(1, int(px(width))), joint="curve")
    r = px(width) / 2
    for x, y in (pp[0], pp[-1]):
        d.ellipse([x - r, y - r, x + r, y + r], fill=fill)


def disc(d, x, y, r, fill=INK):
    cx, cy = P(x, y)
    d.ellipse([cx - px(r), cy - px(r), cx + px(r), cy + px(r)], fill=fill)


def ring(d, x, y, r, width, fill=INK):
    cx, cy = P(x, y)
    d.ellipse([cx - px(r), cy - px(r), cx + px(r), cy + px(r)], outline=fill, width=max(1, int(px(width))))


def shrink(pts, k):
    """重心に向かって縮める（白い縁取り用）。"""
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    return [(cx + (x - cx) * k, cy + (y - cy) * k) for x, y in pts]


def star_pts(cx, cy, ro, ri=None, rot=0.0, n=5):
    ri = ri if ri is not None else ro * 0.42
    out = []
    for i in range(n * 2):
        a = rot + math.pi / n * i
        r = ro if i % 2 == 0 else ri
        out.append((cx + r * math.sin(a), cy + r * math.cos(a)))
    return out


# ---------------------------------------------------------------- 1. 蝶
def butterfly():
    img, d = new_canvas()
    upper = [(0.03, 0.62), (0.12, 0.75), (0.26, 0.87), (0.42, 0.91), (0.50, 0.83),
             (0.47, 0.69), (0.36, 0.59), (0.20, 0.53), (0.06, 0.55)]
    lower = [(0.05, 0.53), (0.22, 0.51), (0.34, 0.44), (0.31, 0.35), (0.21, 0.31),
             (0.11, 0.36), (0.04, 0.45)]
    for wing in (upper, lower):
        for side in (1, -1):
            pts = spline(wing if side == 1 else mirror(wing))
            poly(d, pts, INK)
            # 白い縁取り（内側の線）
            inner = spline(shrink(wing if side == 1 else mirror(wing), 0.82))
            d.line([P(x, y) for x, y in inner + [inner[0]]], fill=PAPER, width=int(px(0.006)))
    for side in (1, -1):
        s = side
        # 白い斑点
        for (x, y, r) in [(0.40, 0.80, 0.045), (0.31, 0.70, 0.03), (0.25, 0.80, 0.022), (0.24, 0.40, 0.04), (0.17, 0.37, 0.022)]:
            disc(d, s * x, y, r, PAPER)
            disc(d, s * x, y, r * 0.45, INK)
        # 翅脈
        for (x1, y1, x2, y2) in [(0.05, 0.60, 0.40, 0.84), (0.05, 0.60, 0.42, 0.68), (0.05, 0.56, 0.30, 0.54), (0.06, 0.50, 0.26, 0.36)]:
            line(d, spline([(s * x1, y1), (s * (x1 + x2) / 2, (y1 + y2) / 2 + 0.01), (s * x2, y2)], closed=False, n=8), 0.004, PAPER)
        # 触角
        line(d, spline([(s * 0.012, 0.85), (s * 0.05, 0.93), (s * 0.11, 0.97)], closed=False, n=8), 0.007)
        disc(d, s * 0.11, 0.97, 0.014)
    body = spline([(0, 0.40), (0.03, 0.50), (0.032, 0.64), (0.02, 0.76), (0.0, 0.79),
                   (-0.02, 0.76), (-0.032, 0.64), (-0.03, 0.50)])
    poly(d, body, INK)
    disc(d, 0, 0.83, 0.036)
    return img


# ---------------------------------------------------------------- 1b. 昆虫（作者本人の標本写真・カラー）
def _smoothstep(x, lo, hi):
    t = np.clip((x - lo) / (hi - lo), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _cutout(path, lo=40.0, hi=110.0):
    """白背景の標本写真 → 紙色に溶け込む RGB と、不透明度 α。
    α は「純白からの距離」。薄い影（黄ばみ）は α が小さくなるので紙に溶ける。"""
    a = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    d = 255.0 - a.min(axis=2)
    alpha = _smoothstep(d, lo, hi)
    paper = np.array(PAPER, dtype=np.float32)
    rgb = paper * (1 - alpha[..., None]) + a * alpha[..., None]
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)), alpha


def _fit(alpha, axis_x, margin=0.90, rim=0.96):
    """全ピクセルが扇形（|x| <= y*tan(π/K)*margin）と円（半径 rim）に収まる最大の高さと下端を探す。"""
    t = math.tan(math.pi / K) * margin
    h, w = alpha.shape
    ys, xs = np.nonzero(alpha[::3, ::3] > 0.15)
    u = (xs * 3 - axis_x) / h                    # 体軸からの横位置（図形の高さ=1）
    v = (h - ys * 3) / h                         # 下端からの高さ（0..1）
    for height in np.arange(0.90, 0.30, -0.005):
        bottom = float(np.max(np.abs(u) * height / t - v * height))   # 扇形の縁に当たらない最小の下端
        bottom = max(bottom, 0.0)
        x, y = u * height, bottom + v * height
        if np.max(np.hypot(x, y)) <= rim:
            return float(height), bottom
    raise RuntimeError("収まる大きさが見つからない")


def _place_photo(path, axis_rows):
    """標本写真を扇形の中に収まる最大の大きさで置く。体軸は x=0。
    axis_rows は体軸を測る行の範囲（図形の高さに対する比率）。"""
    rgb, alpha = _cutout(path)
    ys, xs = np.nonzero(alpha > 0.15)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    rgb = rgb.crop((x0, y0, x1, y1))
    alpha = alpha[y0:y1, x0:x1]
    h, w = alpha.shape
    r0, r1 = int(h * axis_rows[0]), int(h * axis_rows[1])
    _, cols = np.nonzero(alpha[r0:r1] > 0.5)
    axis_x = float(np.median(cols))
    height, bottom = _fit(alpha, axis_x)
    print(f"  fit {path}: height={height:.3f} bottom={bottom:.3f}")
    f = height * R / h
    rgb = rgb.resize((int(round(w * f)), int(round(h * f))), Image.LANCZOS)
    img, _d = new_canvas()
    img.paste(rgb, (int(round(R - axis_x * f)), int(round(R - (bottom + height) * R))))
    return img


def miyama():
    """ミヤマクワガタ"""
    return _place_photo("photos/miyama.jpg", (0.55, 0.75))


def kawatonbo():
    """ニホンカワトンボ"""
    return _place_photo("photos/kawatonbo.jpg", (0.78, 0.90))


# ---------------------------------------------------------------- 2. 花
def flower():
    img, d = new_canvas()
    cx, cy = 0.0, 0.64
    # 茎と葉
    line(d, spline([(0, 0.08), (0.02, 0.22), (-0.01, 0.36), (0, 0.44)], closed=False, n=10), 0.03, GREEN)
    for s, (lx, ly) in ((1, (0.0, 0.0)), (-1, (0.0, 0.0))):
        leaf = spline([(s * 0.01, 0.30), (s * 0.08, 0.34), (s * 0.15, 0.42), (s * 0.10, 0.40), (s * 0.04, 0.36)])
        poly(d, leaf, LEAF)
    # 花びら（外側 16 枚、内側 16 枚を半周期ずらす）
    for layer, (n, length, width, off) in enumerate([(16, 0.30, 0.050, 0.0), (16, 0.21, 0.038, math.pi / 16)]):
        for i in range(n):
            a = 2 * math.pi * i / n + off
            ux, uy = math.sin(a), math.cos(a)
            vx, vy = uy, -ux
            pts = []
            for t in np.linspace(0, 2 * math.pi, 28, endpoint=False):
                along = (1 - math.cos(t)) / 2 * length
                across = math.sin(t) * width * (0.5 + 0.5 * math.sin(math.pi * along / length))
                pts.append((cx + ux * (0.06 + along) + vx * across, cy + uy * (0.06 + along) + vy * across))
            poly(d, pts, lerp(CORAL, MAGENTA, 0.5 * (i % 2)) if layer == 0 else lerp(ORANGE, CORAL, 0.35 * (i % 2)))
            # 花びらの中央の白い筋
            line(d, [(cx + ux * (0.09), cy + uy * 0.09), (cx + ux * (0.06 + length * 0.78), cy + uy * (0.06 + length * 0.78))], 0.004, PAPER)
    # 中心（白地に種のらせん）
    disc(d, cx, cy, 0.105, PAPER)
    ring(d, cx, cy, 0.105, 0.012, MAGENTA)
    golden = math.pi * (3 - math.sqrt(5))
    for i in range(1, 70):
        r = 0.0115 * math.sqrt(i) * 1.12
        a = i * golden
        disc(d, cx + r * math.cos(a), cy + r * math.sin(a), 0.0075, lerp(BROWN, VIOLET, min(1.0, r / 0.1)))
    return img


# ---------------------------------------------------------------- 3. 金魚
def goldfish():
    img, d = new_canvas()
    right = [(0.0, 0.42), (0.05, 0.47), (0.11, 0.56), (0.15, 0.66), (0.15, 0.76), (0.11, 0.85), (0.05, 0.91), (0.0, 0.93)]
    body = spline(right + mirror(right[::-1])[1:-1])
    # 尾びれ（左右 2 枚が裾広がり、ひらひら）
    tail_r = [(0.0, 0.46), (0.06, 0.40), (0.13, 0.34), (0.20, 0.27), (0.23, 0.22), (0.17, 0.24),
              (0.14, 0.30), (0.08, 0.28), (0.04, 0.33), (0.0, 0.30)]
    for s in (1, -1):
        pts = spline(tail_r if s == 1 else mirror(tail_r))
        poly(d, pts, PINK)
        for k in range(5):
            tx = s * (0.04 + k * 0.035)
            line(d, [(s * 0.01, 0.44), (tx + s * 0.04, 0.26 - 0.005 * k)], 0.003, PAPER)
    # 胸びれ
    for s in (1, -1):
        fin = spline([(s * 0.12, 0.70), (s * 0.24, 0.72), (s * 0.34, 0.66), (s * 0.30, 0.58), (s * 0.20, 0.60), (s * 0.13, 0.64)])
        poly(d, fin, ORANGE)
        line(d, [(s * 0.14, 0.67), (s * 0.31, 0.62)], 0.003, PAPER)
        line(d, [(s * 0.14, 0.68), (s * 0.30, 0.67)], 0.003, PAPER)
    poly(d, body, CORAL)
    # うろこ（白い輪）を体の中だけに
    mask = Image.new("L", (W, W), 0)
    ImageDraw.Draw(mask).polygon([P(x, y) for x, y in body], fill=255)
    scales = Image.new("L", (W, W), 0)
    sd = ImageDraw.Draw(scales)
    row = 0
    y = 0.50
    while y < 0.86:
        x0 = -0.17 + (0.026 if row % 2 else 0.0)
        x = x0
        while x < 0.17:
            cxp, cyp = P(x, y)
            r = px(0.030)
            sd.arc([cxp - r, cyp - r, cxp + r, cyp + r], 200, 340, fill=255, width=int(px(0.0045)))
            x += 0.052
        y += 0.034
        row += 1
    img.paste(PAPER, mask=ImageChops.multiply(scales, mask))
    # 背びれの筋・目
    for s in (1, -1):
        disc(d, s * 0.075, 0.855, 0.030, PAPER)
        disc(d, s * 0.078, 0.858, 0.016, INK)
        disc(d, s * 0.071, 0.864, 0.005, PAPER)
    line(d, [(0, 0.50), (0, 0.80)], 0.004, PAPER)
    # あぶく
    for (x, y, r) in [(0.06, 0.97, 0.022), (-0.08, 0.99, 0.014), (0.0, 0.985, 0.009)]:
        ring(d, x, y, r, 0.005, BLUE)
    return img


# ---------------------------------------------------------------- 4. 樹（フラクタル）
def tree():
    img, d = new_canvas()
    rnd = random.Random(7)

    def branch(x, y, ang, length, width, depth):
        x2 = x + length * math.sin(ang)
        y2 = y + length * math.cos(ang)
        col = lerp(BROWN, GREEN, min(1.0, (7 - depth) / 4.0))        # 幹は茶、枝先に向かって緑
        line(d, [(x, y), (x2, y2)], width, col)
        if depth == 0:
            for _ in range(3):
                disc(d, x2 + rnd.uniform(-0.012, 0.012), y2 + rnd.uniform(-0.012, 0.012), rnd.uniform(0.012, 0.022),
                     rnd.choice((PINK, RASPBERRY, CORAL)))                 # 枝先は花
            return
        n = 2 if depth > 2 else rnd.choice((2, 3))
        for i in range(n):
            spread = (i - (n - 1) / 2) * 0.62 + rnd.uniform(-0.12, 0.12)
            branch(x2, y2, ang + spread, length * rnd.uniform(0.70, 0.78), width * 0.70, depth - 1)

    branch(0.0, 0.07, 0.0, 0.25, 0.034, 7)
    # 地面の草
    for i in range(7):
        gx = (i - 3) * 0.018
        line(d, [(gx, 0.07), (gx * 1.7, 0.07 + 0.045 + 0.01 * (i % 3))], 0.004, LEAF)
    return img


# ---------------------------------------------------------------- 5. 月と星
STAR_COLORS = [BLUE, MAGENTA, TEAL, ORANGE, VIOLET, RASPBERRY]


def moon_stars():
    img, d = new_canvas()
    mx, my, mr = 0.0, 0.62, 0.30
    disc(d, mx, my, mr, GOLD)
    disc(d, mx + 0.13, my + 0.07, mr * 0.86, PAPER)   # 三日月に欠く
    # クレーターの白点
    for (x, y, r) in [(-0.17, 0.60, 0.022), (-0.20, 0.70, 0.014), (-0.13, 0.50, 0.012), (-0.22, 0.56, 0.010)]:
        disc(d, x, y, r, PAPER)
    # 星
    stars = [(-0.34, 0.90, 0.060), (0.32, 0.88, 0.050), (0.20, 0.50, 0.045), (-0.30, 0.44, 0.038),
             (0.40, 0.70, 0.034), (0.08, 0.94, 0.030), (-0.10, 0.33, 0.030), (0.30, 0.34, 0.028),
             (-0.44, 0.74, 0.026), (0.45, 0.50, 0.022)]
    for i, (x, y, r) in enumerate(stars):
        poly(d, star_pts(x, y, r, rot=0.35 * i), STAR_COLORS[i % len(STAR_COLORS)])
        if r > 0.04:
            poly(d, star_pts(x, y, r * 0.55, rot=0.35 * i + math.pi / 5, ri=r * 0.25), PAPER)
    rnd = random.Random(3)
    for _ in range(34):
        x = rnd.uniform(-0.55, 0.55)
        y = rnd.uniform(0.25, 0.97)
        if abs(x) <= y * 0.92 and math.hypot(x - mx, y - my) > mr + 0.04 and all(math.hypot(x - sx, y - sy) > sr + 0.03 for sx, sy, sr in stars):
            disc(d, x, y, rnd.uniform(0.004, 0.009), rnd.choice(STAR_COLORS))
    # 流れ星
    line(d, [(0.45, 0.93), (0.24, 0.81)], 0.006, PINK)
    line(d, [(0.45, 0.93), (0.30, 0.905)], 0.003, PINK)
    poly(d, star_pts(0.24, 0.81, 0.028, rot=1.0), ORANGE)
    return img



# ---------------------------------------------------------------- 6. 幾何曼荼羅
def mandala():
    img, d = new_canvas()
    cx, cy = 0.0, 0.62
    poly(d, star_pts(cx, cy, 0.34, 0.21, rot=0.0, n=12), RASPBERRY)
    disc(d, cx, cy, 0.215, PAPER)
    ring(d, cx, cy, 0.215, 0.008, ORANGE)
    poly(d, star_pts(cx, cy, 0.185, 0.095, rot=math.pi / 8, n=8), BLUE)
    disc(d, cx, cy, 0.092, PAPER)
    poly(d, star_pts(cx, cy, 0.075, 0.035, rot=0.0, n=6), VIOLET)
    disc(d, cx, cy, 0.024, PAPER)
    for i in range(12):                       # 外周の小円
        a = 2 * math.pi * (i + 0.5) / 12
        disc(d, cx + 0.375 * math.sin(a), cy + 0.375 * math.cos(a), 0.016, hsv(i / 12 + 0.02))
    for i in range(12):                       # 星の谷に白い点
        a = 2 * math.pi * (i + 0.5) / 12
        disc(d, cx + 0.255 * math.sin(a), cy + 0.255 * math.cos(a), 0.007, PAPER)
    return img


# ---------------------------------------------------------------- 7. スピログラフ
def spirograph():
    img, d = new_canvas()
    cx, cy = 0.0, 0.62
    big, small = 8.0, 3.0
    turns = 3  # 閉じるまでの周回数（R=8, r=3 → 3 周）
    for k, (dd, w, col) in enumerate([(5.2, 0.0052, MAGENTA), (4.0, 0.0052, TEAL), (2.8, 0.0052, ORANGE)]):
        pts = []
        for t in np.linspace(0, 2 * math.pi * turns, 1400):
            x = (big - small) * math.cos(t) + dd * math.cos((big - small) / small * t)
            y = (big - small) * math.sin(t) - dd * math.sin((big - small) / small * t)
            pts.append((cx + x * 0.34 / (big - small + dd), cy + y * 0.34 / (big - small + dd)))
        line(d, pts, w, col)
    ring(d, cx, cy, 0.372, 0.014, INDIGO)
    ring(d, cx, cy, 0.352, 0.004, BLUE)
    disc(d, cx, cy, 0.030, INDIGO)
    disc(d, cx, cy, 0.014, PAPER)
    return img


# ---------------------------------------------------------------- 8. 極座標チェッカー（オプアート）
def polar_checker():
    yy, xx = np.mgrid[0:W, 0:W].astype(np.float64)
    dx = (xx - R) / R
    dy = (R - yy) / R
    r = np.hypot(dx, dy)
    beta = np.arctan2(dx, dy)                 # 軸（上）からの角度
    ring_i = np.floor(np.clip(r, 1e-6, 1) ** 0.8 * 13)
    ang = (beta + math.pi / K) / (2 * math.pi / K)       # 0..1 に正規化
    seg = np.floor(ang * 6 + ring_i * 0.5)               # 6 分割（偶数＝扇形の境目で市松が連続）＋ring ごとにずらす→らせん状
    black = ((ring_i + seg) % 2 == 0) & (r > 0.07) & (r <= 1.0)
    arr = np.empty((W, W, 3), dtype=np.uint8)
    arr[:] = PAPER
    ramp_t = np.clip(r, 0, 1)
    for ch in range(3):                        # 半径方向に 藍 → 紫 → 洋紅 → 橙
        stops = [INDIGO[ch], VIOLET[ch], MAGENTA[ch], ORANGE[ch]]
        arr[..., ch] = np.where(black, np.interp(ramp_t, [0, 0.35, 0.7, 1.0], stops), arr[..., ch]).astype(np.uint8)
    return Image.fromarray(arr, "RGB")


# ---------------------------------------------------------------- 9. フラワー・オブ・ライフ
def flower_of_life():
    img, d = new_canvas()
    cx, cy = 0.0, 0.62
    rr = 0.115
    centers = [(0.0, 0.0)]
    for ring_n in (1, 2):
        for i in range(6 * ring_n):
            seg = i // ring_n
            pos = i % ring_n
            a0 = math.pi / 3 * seg
            a1 = math.pi / 3 * (seg + 1)
            p0 = (ring_n * rr * math.cos(a0), ring_n * rr * math.sin(a0))
            p1 = (ring_n * rr * math.cos(a1), ring_n * rr * math.sin(a1))
            t = pos / ring_n
            centers.append((p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t))
    mask = Image.new("L", (W, W), 0)
    md = ImageDraw.Draw(mask)
    cxp, cyp = P(cx, cy)
    md.ellipse([cxp - px(0.345), cyp - px(0.345), cxp + px(0.345), cyp + px(0.345)], fill=255)
    for i, (ox, oy) in enumerate(centers):    # 円ごとに色相をずらして重ねる
        layer = Image.new("L", (W, W), 0)
        x, y = P(cx + ox, cy + oy)
        ImageDraw.Draw(layer).ellipse([x - px(rr), y - px(rr), x + px(rr), y + px(rr)], outline=255, width=int(px(0.0055)))
        img.paste(hsv(0.55 + 0.45 * (math.atan2(oy, ox) / (2 * math.pi) % 1.0) + 0.0 * i, 0.72, 0.86),
                  mask=ImageChops.multiply(layer, mask))
    ring(d, cx, cy, 0.352, 0.012, INDIGO)
    ring(d, cx, cy, 0.372, 0.0045, VIOLET)
    for (ox, oy) in centers:                  # 中心の小さな点
        disc(d, cx + ox, cy + oy, 0.0075, CORAL)
    return img


# ---------------------------------------------------------------- 展開（wedgeToFull と同じ式）
def wedge_to_full(wedge_img, k=K, out_n=S):
    src = np.asarray(wedge_img.resize((S, S), Image.LANCZOS).convert("RGB"), dtype=np.float64)
    size = S
    yy, xx = np.mgrid[0:out_n, 0:out_n]
    c = out_n / 2
    dx = xx - c
    dy = yy - c
    r_out = np.hypot(dx, dy)
    theta = np.arctan2(dx, -dy)
    beta = theta / k
    r = r_out * (size / out_n)
    fx = size / 2 + r * np.sin(beta)
    fy = size / 2 - r * np.cos(beta)
    x0 = np.floor(fx).astype(int)
    y0 = np.floor(fy).astype(int)
    ok = (r_out <= c) & (x0 >= 0) & (y0 >= 0) & (x0 < size - 1) & (y0 < size - 1)
    x0c = np.clip(x0, 0, size - 2)
    y0c = np.clip(y0, 0, size - 2)
    ax = (fx - x0c)[..., None]
    ay = (fy - y0c)[..., None]
    out = (src[y0c, x0c] * (1 - ax) * (1 - ay) + src[y0c, x0c + 1] * ax * (1 - ay)
           + src[y0c + 1, x0c] * (1 - ax) * ay + src[y0c + 1, x0c + 1] * ax * ay)
    rgba = np.zeros((out_n, out_n, 4), dtype=np.uint8)
    rgba[..., :3] = np.clip(out, 0, 255).astype(np.uint8)
    # 円内は不透明、円外は透明（既存サンプルと同じ）。境界は 1px だけなめらかに
    edge = np.clip((c - r_out) + 0.5, 0, 1)
    rgba[..., 3] = (edge * 255).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def reconstruction(wedge_img, k=K, size=S):
    """右パネル相当：扇形の絵を K 回転ぶん並べた見た目（確認用）。"""
    base = wedge_img.resize((size, size), Image.LANCZOS)
    half = math.pi / k
    mask = Image.new("L", (size, size), 0)
    c = size / 2
    pts = [(c, c)] + [(c + c * 1.5 * math.sin(a), c - c * 1.5 * math.cos(a)) for a in np.linspace(-half, half, 60)]
    ImageDraw.Draw(mask).polygon(pts, fill=255)
    out = Image.new("RGB", (size, size), PAPER)
    for i in range(k):
        out.paste(base.rotate(-360 * i / k, resample=Image.BICUBIC, center=(c, c), fillcolor=PAPER),
                  mask=mask.rotate(-360 * i / k, resample=Image.BICUBIC, center=(c, c)))
    circ = Image.new("L", (size, size), 0)
    ImageDraw.Draw(circ).ellipse([0, 0, size - 1, size - 1], fill=255)
    bg = Image.new("RGB", (size, size), (20, 20, 24))
    bg.paste(out, mask=circ)
    return bg


DESIGNS = [
    ("miyama-kuwagata", "ミヤマクワガタ", miyama),
    ("nihon-kawatonbo", "ニホンカワトンボ", kawatonbo),
    ("flower", "花", flower),
    ("goldfish", "金魚", goldfish),
    ("tree", "樹", tree),
    ("moon-stars", "月と星", moon_stars),
    ("mandala", "幾何曼荼羅", mandala),
    ("spirograph", "スピログラフ", spirograph),
    ("polar-checker", "極座標チェッカー", polar_checker),
    ("flower-of-life", "フラワーオブライフ", flower_of_life),
]

if __name__ == "__main__":
    outdir = sys.argv[1]
    import os
    os.makedirs(outdir, exist_ok=True)
    cols = 5
    rows = (len(DESIGNS) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * 400, rows * 800), (20, 20, 24))
    for i, (slug, label, fn) in enumerate(DESIGNS):
        wedge = fn()
        full = wedge_to_full(wedge)
        full.save(f"{outdir}/{slug}.png", optimize=True)
        bgd = Image.new("RGB", (S, S), (20, 20, 24))
        bgd.paste(full, mask=full.split()[3])
        ox, oy = (i % cols) * 400, (i // cols) * 800
        sheet.paste(bgd.resize((400, 400), Image.LANCZOS), (ox, oy))
        sheet.paste(reconstruction(wedge).resize((400, 400), Image.LANCZOS), (ox, oy + 400))
        wedge.resize((400, 400), Image.LANCZOS).save(f"{outdir}/_wedge-{slug}.png")
        print("generated", slug)
    sheet.save(f"{outdir}/_contact-sheet.png")
