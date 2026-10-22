#!/usr/bin/env python3
"""連鎖する元画像：前の天使の服をつかむ天使／3枚→15枚の重なるトランプ／前の猫の尻尾をかじる猫。
5回対称のシーンを 1/5 に切り出す（扇形の外へはみ出した部分は、隣の複製が持ち込んでくれる）。"""
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_samples as g
import gen_art2 as a2
from gen_samples import K, W, R, PAPER, P, px, spline, mirror, star_pts, lerp

ANG = 360 / K


def layer():
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def compose(seq):
    """seq=[(layer, j), ...] を下から順に重ねる。j は時計回りに j 個隣の複製。"""
    out = Image.new("RGBA", (W, W), PAPER + (255,))
    for lay, j in seq:
        out.alpha_composite(lay if j == 0 else lay.rotate(-j * ANG, center=(R, R), resample=Image.BICUBIC))
    return out.convert("RGB")


def rot_cw(pt, deg):
    a = math.radians(deg)
    x, y = pt
    return (x * math.cos(a) + y * math.sin(a), -x * math.sin(a) + y * math.cos(a))


def outlined(d, pts, fill, edge, w=0.004):
    pp = [P(x, y) for x, y in pts]
    d.polygon(pp, fill=fill)
    d.line(pp + [pp[0]], fill=edge, width=max(1, int(px(w))), joint="curve")


def disc(d, x, y, r, fill):
    cx, cy = P(x, y)
    d.ellipse([cx - px(r), cy - px(r), cx + px(r), cy + px(r)], fill=fill)


def blob(d, x, y, rx, ry, fill, edge=None, w=0.004, rot=0.0, n=40):
    pts = []
    for t in np.linspace(0, 2 * math.pi, n, endpoint=False):
        ex, ey = rx * math.cos(t), ry * math.sin(t)
        pts.append((x + ex * math.cos(rot) - ey * math.sin(rot), y + ex * math.sin(rot) + ey * math.cos(rot)))
    if edge:
        outlined(d, pts, fill, edge, w)
    else:
        d.polygon([P(a, b) for a, b in pts], fill=fill)


def stroke(d, pts, w0, w1, fill, n_circ=60):
    """先細りの太い線（折れ線を滑らかにして円を並べる）。"""
    path = spline(pts, closed=False, n=14)
    m = len(path)
    for i, (x, y) in enumerate(path):
        t = i / max(1, m - 1)
        disc(d, x, y, (w0 + (w1 - w0) * t) / 2, fill)
    return path


# ================================================================ 天使：前の天使の裾をつかむ
CLOTH = (250, 190, 200)
TAIL_TIP = (-0.315, 0.40)          # 自分の裾の先（左の縁の外）。時計回り隣の天使の手がここをつかむ
SHOULDER_R = (0.070, 0.645)


def angel_chain():
    body, d = layer()
    arm, da = layer()
    # 翼
    for s in (1, -1):
        rows = [((0.07, 0.665), [14, 26, 38, 50, 62, 74], [0.275, 0.285, 0.285, 0.27, 0.25, 0.22], 0.050),
                ((0.07, 0.625), [86, 100, 114, 128], [0.22, 0.22, 0.21, 0.19], 0.045)]
        for ri, (root, angs, lens, wd) in enumerate(rows):
            for i in reversed(range(len(angs))):
                pts = a2.feather((s * root[0], root[1]), s * angs[i], lens[i], wd)
                outlined(d, pts, a2.WING_A if (i + ri) % 2 == 0 else a2.WING_B, a2.WING_EDGE, 0.003)
    # 左の裾（長くはためく布。時計回りの隣の天使がこれをつかむ）
    cloth = spline([(-0.06, 0.545), (-0.15, 0.590), (-0.24, 0.565), (-0.30, 0.470), TAIL_TIP,
                    (-0.275, 0.430), (-0.22, 0.505), (-0.15, 0.510), (-0.07, 0.480)], n=8)
    outlined(d, cloth, CLOTH, a2.GOWN_EDGE, 0.003)
    for k_ in range(3):
        stroke(d, [(-0.09, 0.52 + 0.004 * k_), (-0.18, 0.545 - 0.01 * k_), (-0.26 + 0.01 * k_, 0.48)], 0.003, 0.003, lerp(CLOTH, a2.GOWN_EDGE, 0.45))
    # ガウン
    right_side = [(0.0, 0.69), (0.075, 0.675), (0.072, 0.60), (0.062, 0.50), (0.095, 0.40), (0.150, 0.29), (0.155, 0.275)]
    gown = spline(right_side + mirror(right_side[::-1])[1:], n=8)
    outlined(d, gown, a2.GOWN, a2.GOWN_EDGE, 0.004)
    poly = lambda pts, c: d.polygon([P(x, y) for x, y in pts], fill=c)
    poly([(-0.067, 0.515), (0.067, 0.515), (0.071, 0.485), (-0.071, 0.485)], a2.SASH)
    for x in (-0.09, -0.045, 0.0, 0.045, 0.09):
        d.line([P(x * 0.55, 0.47), P(x * 1.35, 0.30)], fill=lerp(a2.GOWN, a2.GOWN_EDGE, 0.45), width=max(1, int(px(0.003))))
    for s in (1, -1):
        disc(d, s * 0.05, 0.262, 0.024, a2.SKIN)
    # 左腕（上げて手を振る）
    outlined(d, spline([(-0.060, 0.675), (-0.060, 0.610), (-0.16, 0.650), (-0.215, 0.725), (-0.19, 0.745), (-0.12, 0.700)], n=6), a2.GOWN, a2.GOWN_EDGE, 0.003)
    disc(d, -0.215, 0.745, 0.026, a2.SKIN)
    # 頭
    disc(d, 0, 0.800, 0.080, a2.HAIR)
    disc(d, 0, 0.780, 0.062, a2.SKIN)
    poly(spline([(-0.065, 0.790), (-0.040, 0.835), (0.0, 0.842), (0.040, 0.835), (0.065, 0.790), (0.030, 0.815), (0.0, 0.800), (-0.030, 0.815)], n=8), a2.HAIR)
    for s in (1, -1):
        d.arc([P(s * 0.022 - 0.014, 0.783)[0], P(0, 0.783)[1], P(s * 0.022 + 0.014, 0.783)[0], P(0, 0.761)[1]], 200, 340, fill=(90, 60, 70), width=max(1, int(px(0.003))))
        disc(d, s * 0.040, 0.756, 0.011, (246, 150, 150))
    d.arc([P(-0.011, 0)[0], P(0, 0.760)[1], P(0.011, 0)[0], P(0, 0.742)[1]], 20, 160, fill=(200, 80, 90), width=max(1, int(px(0.003))))
    cxp, cyp = P(0, 0.915)
    d.ellipse([cxp - px(0.075), cyp - px(0.020), cxp + px(0.075), cyp + px(0.020)], outline=a2.HALO, width=max(1, int(px(0.011))))
    poly(star_pts(0, 0.145, 0.045, 0.019, rot=math.pi, n=5), a2.HALO)

    # 右腕：時計回りの隣の天使の裾の先をつかむ（手を置く位置は、その裾を隣の位置へ回した座標）
    gx, gy = rot_cw((TAIL_TIP[0] + 0.03, TAIL_TIP[1] + 0.03), ANG)
    sx, sy = SHOULDER_R
    dx, dy = gx - sx, gy - sy
    L = math.hypot(dx, dy)
    nx, ny = -dy / L, dx / L
    sleeve = [(sx + nx * 0.040, sy + ny * 0.040), (gx - dx * 0.18 + nx * 0.052, gy - dy * 0.18 + ny * 0.052),
              (gx - dx * 0.18 - nx * 0.052, gy - dy * 0.18 - ny * 0.052), (sx - nx * 0.040, sy - ny * 0.040)]
    outlined(da, spline(sleeve, n=6), a2.GOWN, a2.GOWN_EDGE, 0.003)
    stroke(da, [(gx - dx * 0.20, gy - dy * 0.20), (gx, gy)], 0.030, 0.030, a2.SKIN)
    disc(da, gx, gy, 0.030, a2.SKIN)
    for k_ in (-1, 0, 1):                              # 握った指
        disc(da, gx + nx * 0.016 * k_ + dx / L * 0.014, gy + ny * 0.016 * k_ + dy / L * 0.014, 0.012, lerp(a2.SKIN, (200, 140, 110), 0.35))
    print(f"  angel: 腕の長さ {L:.3f}, つかむ点 ({gx:.3f}, {gy:.3f})")
    return compose([(body, j) for j in (-1, 0, 1)] + [(arm, j) for j in (-1, 0, 1)])


# ================================================================ トランプ：3 枚 → 15 枚
CARDS = [("7", "diamond", a2.DIAM_C,
          [(340, 370, 0), (660, 370, 0), (340, 700, 0), (660, 700, 0), (340, 1030, 1), (660, 1030, 1), (500, 535, 0)]),
         ("A", "spade", a2.SPADE_C, None),
         ("5", "heart", a2.HEART_C,
          [(340, 370, 0), (660, 370, 0), (500, 700, 0), (340, 1030, 1), (660, 1030, 1)])]


def trump15():
    seq = []
    width, rho, tilt = 0.36, 0.56, 24
    faces = [a2.card_face(r, s, c, None, tint=(250, 240, 222), pips=p) for r, s, c, p in CARDS]
    cards = []
    for k, face in enumerate(faces):
        ang = (k - 1) * 24
        wpx = int(px(width))
        f = face.resize((wpx, int(wpx * a2.CH / a2.CW)), Image.LANCZOS).rotate(ang + tilt, expand=True, resample=Image.BICUBIC)
        cx, cy = rho * math.sin(math.radians(ang)), rho * math.cos(math.radians(ang))
        lay = Image.new("RGBA", (W, W), (0, 0, 0, 0))
        lay.alpha_composite(f, (int(P(cx, cy)[0] - f.width / 2), int(P(cx, cy)[1] - f.height / 2)))
        cards.append(lay)
    for j in (-1, 0, 1):                               # 番号の小さい順に重ねる（次のカードが前のカードの上）
        for k in range(3):
            seq.append((cards[k], j))
    return compose(seq)


# ================================================================ 猫：前の猫の尻尾をかじる（ちびキャラ風）
FUR = (250, 182, 98)
FUR_DARK = (226, 132, 56)
FUR_LIGHT = (255, 244, 226)
OUTL = (128, 72, 48)
PINK = (250, 150, 168)
MOUTH = (0.300, 0.548)             # 自分の口の位置
CAT_T = rot_cw(MOUTH, -ANG)         # 自分の尻尾の先＝時計回りの隣の猫の口（に回すとここ）


def tri(d, pts, fill, edge=None, w=0.003):
    if edge:
        outlined(d, pts, fill, edge, w)
    else:
        d.polygon([P(x, y) for x, y in pts], fill=fill)


def cat_chain():
    tails, dt = layer()
    body, d = layer()
    # --- 尻尾：ふさふさ。腰から後ろへ上がり、左の縁の外を回って、先が隣の猫の口に収まる
    path = stroke(dt, [(-0.16, 0.545), (-0.26, 0.690), (-0.38, 0.690), (-0.445, 0.590), CAT_T], 0.085, 0.045, OUTL)
    path = stroke(dt, [(-0.16, 0.545), (-0.26, 0.690), (-0.38, 0.690), (-0.445, 0.590), CAT_T], 0.075, 0.036, FUR)
    for i in range(8, len(path) - 6, 13):             # 縞
        x, y = path[i]
        x2, y2 = path[i + 3]
        ang = math.atan2(y2 - y, x2 - x) + math.pi / 2
        w_ = 0.034 - 0.0004 * i / 3
        dt.line([P(x - w_ * math.cos(ang), y - w_ * math.sin(ang)), P(x + w_ * math.cos(ang), y + w_ * math.sin(ang))],
                fill=FUR_DARK, width=max(1, int(px(0.013))))
    # --- ずんぐりした脚（肉球ちらり）
    for x in (-0.12, -0.065, 0.085, 0.140):
        blob(d, x, 0.405, 0.027, 0.060, FUR, OUTL, 0.0035)
        blob(d, x, 0.352, 0.032, 0.020, FUR_LIGHT, OUTL, 0.0035)
        for dx_ in (-0.011, 0.011):
            d.line([P(x + dx_, 0.347), P(x + dx_, 0.365)], fill=lerp(OUTL, FUR_LIGHT, 0.4), width=max(1, int(px(0.002))))
    # --- まるい胴
    blob(d, -0.01, 0.505, 0.170, 0.098, FUR, OUTL, 0.0045)
    blob(d, 0.015, 0.470, 0.120, 0.048, FUR_LIGHT, None)
    for x in (-0.13, -0.07, -0.01, 0.05):
        stroke(d, [(x, 0.596), (x + 0.005, 0.560), (x + 0.001, 0.535)], 0.020, 0.008, FUR_DARK)
    # --- 首輪と鈴
    blob(d, 0.150, 0.545, 0.030, 0.085, (222, 60, 70), OUTL, 0.003, rot=0.35)
    disc(d, 0.176, 0.490, 0.026, (255, 210, 70))
    disc(d, 0.176, 0.490, 0.026, (255, 210, 70))
    d.arc([P(0.176 - 0.026, 0)[0], P(0, 0.490 + 0.026)[1], P(0.176 + 0.026, 0)[0], P(0, 0.490 - 0.026)[1]], 0, 360, fill=OUTL, width=max(1, int(px(0.003))))
    d.line([P(0.158, 0.490), P(0.194, 0.490)], fill=OUTL, width=max(1, int(px(0.003))))
    disc(d, 0.176, 0.478, 0.005, OUTL)
    # --- 頭：大きなまる顔。ほっぺのふわふわ・まるい耳
    blob(d, 0.205, 0.600, 0.118, 0.100, FUR, OUTL, 0.0045)
    for sgn in (-1, 1):                              # ほっぺの毛
        x0 = 0.205 + sgn * 0.112
        tri(d, [(x0, 0.600), (x0 + sgn * 0.030, 0.585), (x0 + sgn * 0.002, 0.570)], FUR, OUTL, 0.003)
    for pts, inner in (([(0.120, 0.650), (0.125, 0.770), (0.200, 0.690)], [(0.134, 0.675), (0.138, 0.740), (0.178, 0.697)]),
                       ([(0.215, 0.690), (0.290, 0.770), (0.292, 0.640)], [(0.232, 0.698), (0.272, 0.738), (0.275, 0.665)])):
        tri(d, spline(pts, n=6), FUR, OUTL, 0.0035)
        tri(d, spline(inner, n=6), PINK)
    for k_ in range(3):                              # おでこの縞
        stroke(d, [(0.178 + 0.027 * k_, 0.690), (0.180 + 0.027 * k_, 0.655)], 0.014, 0.007, FUR_DARK)
    blob(d, 0.270, 0.560, 0.052, 0.038, FUR_LIGHT, None)                       # マズル（白）
    # 目：大きくてキラキラ
    for ex in (0.165, 0.250):
        blob(d, ex, 0.605, 0.025, 0.031, (40, 28, 36), OUTL, 0.002)
        blob(d, ex + 0.008, 0.618, 0.010, 0.012, (255, 255, 255), None)
        disc(d, ex - 0.008, 0.592, 0.0055, (255, 255, 255))
    for ex in (0.145, 0.275):                        # ほっぺの赤み
        blob(d, ex, 0.558, 0.020, 0.012, (252, 150, 150), None)
    tri(d, [(0.287, 0.580), (0.309, 0.580), (0.298, 0.567)], PINK, OUTL, 0.002)  # 鼻
    # 口：上あご・下あごのあいだに尻尾の先。ちいさな牙
    blob(d, 0.286, 0.564, 0.040, 0.020, FUR_LIGHT, OUTL, 0.003)                  # 上あご
    blob(d, 0.286, 0.527, 0.030, 0.015, FUR_LIGHT, OUTL, 0.003)                  # 下あご
    for fx in (0.268, 0.300):
        tri(d, [(fx - 0.006, 0.553), (fx + 0.006, 0.553), (fx, 0.540)], (255, 255, 255), OUTL, 0.0015)
    for k_ in (-1, 1):                               # ひげ
        d.line([P(0.325, 0.568 + 0.008 * k_), P(0.378, 0.575 + 0.036 * k_)], fill=OUTL, width=max(1, int(px(0.0025))))
    print(f"  cat: 尻尾の先 {CAT_T}")
    return compose([(tails, j) for j in (-1, 0, 1)] + [(body, j) for j in (-1, 0, 1)])


DESIGNS = [("trump-15", "3枚→15枚のトランプ", trump15),
           ("cat-chain", "前の猫の尻尾をかじる猫", cat_chain)]


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "out3"
    os.makedirs(out, exist_ok=True)
    sheet = Image.new("RGB", (len(DESIGNS) * 500, 1000), (20, 20, 24))
    for i, (slug, label, fn) in enumerate(DESIGNS):
        wedge = fn()
        wedge.save(f"{out}/_wedge-{slug}.png")
        full = g.wedge_to_full(wedge)
        full.save(f"{out}/{slug}.png")
        rec = g.reconstruction(wedge)
        rec.save(f"{out}/_recon-{slug}.png")
        for row, im in enumerate((full, rec)):
            sheet.paste(im.resize((500, 500), Image.LANCZOS), (i * 500, row * 500))
        print("generated", slug)
    sheet.save(f"{out}/_sheet.png")
