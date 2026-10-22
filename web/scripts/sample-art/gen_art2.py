#!/usr/bin/env python3
"""一工夫ある元画像：輪になって手をつなぐ天使／昆虫をあしらったトランプ。
gen_samples.py の道具（扇形座標・展開式）を使い回す。全て自前で描いた図形＋作者本人の標本写真。"""
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_samples as g
from gen_samples import K, W, R, PAPER, P, px, spline, poly, disc, ring, line, mirror, star_pts, new_canvas, lerp

T = math.tan(math.pi / K)          # 扇形の縁： |x| = y * T
FONT = "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"


def edge_x(y):
    return y * T


def outlined(d, pts, fill, edge, w=0.004):
    poly(d, pts, fill)
    pp = [P(x, y) for x, y in pts]
    d.line(pp + [pp[0]], fill=edge, width=max(1, int(px(w))), joint="curve")


# ================================================================ 天使
SKIN = (250, 214, 186)
HAIR = (238, 184, 64)
HALO = (250, 204, 40)
GOWN = (170, 204, 240)
GOWN_EDGE = (62, 84, 158)
WING_A = (236, 240, 255)
WING_B = (255, 226, 236)
WING_EDGE = (110, 120, 200)
SASH = (240, 120, 130)


def feather(root, ang_deg, length, width):
    """root から ang_deg（真上=0°、右回り）へ伸びる羽根 1 枚（葉の形）。"""
    a = math.radians(ang_deg)
    ux, uy = math.sin(a), math.cos(a)
    vx, vy = uy, -ux
    left, right = [], []
    for t in np.linspace(0, 1, 18):
        wd = width * (math.sin(math.pi * min(1.0, t * 1.0)) ** 0.7) * (1 - 0.25 * t)
        left.append((root[0] + ux * length * t + vx * wd, root[1] + uy * length * t + vy * wd))
        right.append((root[0] + ux * length * t - vx * wd, root[1] + uy * length * t - vy * wd))
    return left + right[::-1]


def angel():
    img, d = new_canvas()
    hand_y = 0.585
    hand = (edge_x(hand_y), hand_y)                  # 手は扇形の縁の上：隣の天使の手と重なって繋がる

    # --- 翼（片側ずつ。外側の羽根から重ねる）
    for s in (1, -1):
        rows = [
            # (根元, 角度の列, 長さの列, 太さ, 色)
            ((0.07, 0.665), [14, 26, 38, 50, 62, 74], [0.275, 0.285, 0.285, 0.27, 0.25, 0.22], 0.050),
            ((0.07, 0.625), [86, 100, 114, 128], [0.22, 0.22, 0.21, 0.19], 0.045),
        ]
        for ri, (root, angs, lens, wd) in enumerate(rows):
            for i in reversed(range(len(angs))):
                pts = feather((s * root[0], root[1]), s * angs[i], lens[i], wd)
                outlined(d, pts, WING_A if (i + ri) % 2 == 0 else WING_B, WING_EDGE, 0.003)

    # --- 袖＋腕
    for s in (1, -1):
        sleeve = [(s * 0.060, 0.675), (s * 0.060, 0.600), (s * 0.20, 0.545), (s * (hand[0] - 0.05), hand_y - 0.052),
                  (s * (hand[0] - 0.05), hand_y + 0.050), (s * 0.20, 0.655)]
        outlined(d, spline(sleeve, n=6), GOWN, GOWN_EDGE, 0.003)
        line(d, [(s * (hand[0] - 0.06), hand_y), (s * hand[0], hand_y)], 0.030, SKIN)
        disc(d, s * hand[0], hand_y, 0.026, SKIN)

    # --- ガウン
    right_side = [(0.0, 0.69), (0.075, 0.675), (0.072, 0.60), (0.062, 0.50), (0.095, 0.40), (0.150, 0.29), (0.155, 0.275)]
    gown = right_side + mirror(right_side[::-1])[1:]
    pts = spline(gown, n=8)
    outlined(d, pts, GOWN, GOWN_EDGE, 0.004)
    # 腰の帯
    belt = [(-0.067, 0.515), (0.067, 0.515), (0.071, 0.485), (-0.071, 0.485)]
    poly(d, belt, SASH)
    # すその折り目
    for k_, x in enumerate((-0.09, -0.045, 0.0, 0.045, 0.09)):
        line(d, [(x * 0.55, 0.47), (x * 1.35, 0.30)], 0.003, lerp(GOWN, GOWN_EDGE, 0.45))
    # 足
    for s in (1, -1):
        disc(d, s * 0.05, 0.262, 0.024, SKIN)

    # --- 頭
    disc(d, 0, 0.800, 0.080, HAIR)
    disc(d, 0, 0.780, 0.062, SKIN)
    bangs = spline([(-0.065, 0.790), (-0.040, 0.835), (0.0, 0.842), (0.040, 0.835), (0.065, 0.790), (0.030, 0.815), (0.0, 0.800), (-0.030, 0.815)], n=8)
    poly(d, bangs, HAIR)
    for s in (1, -1):                                 # 閉じた目（弧）と頬
        d.arc([P(s * 0.022 - 0.014, 0.783)[0], P(0, 0.783)[1], P(s * 0.022 + 0.014, 0.783)[0], P(0, 0.761)[1]],
              200, 340, fill=(90, 60, 70), width=max(1, int(px(0.003))))
        disc(d, s * 0.040, 0.756, 0.011, (246, 150, 150))
    d.arc([P(-0.011, 0)[0], P(0, 0.760)[1], P(0.011, 0)[0], P(0, 0.742)[1]], 20, 160, fill=(200, 80, 90), width=max(1, int(px(0.003))))
    # 光輪
    cxp, cyp = P(0, 0.915)
    d.ellipse([cxp - px(0.075), cyp - px(0.020), cxp + px(0.075), cyp + px(0.020)], outline=HALO, width=max(1, int(px(0.011))))

    # --- 手のあいだのきらめき（縁の上に中心→隣と左右対称に合わさる）
    spark = star_pts(hand[0], hand_y + 0.075, 0.034, 0.010, rot=0.0, n=4)
    poly(d, spark, HALO)
    # --- 中心に小さな星（5 つで五芒星の輪）
    poly(d, star_pts(0, 0.145, 0.045, 0.019, rot=math.pi, n=5), HALO)
    return img


# ================================================================ トランプ
CW, CH = 1000, 1400
SPADE_C = (24, 24, 34)
HEART_C = (206, 36, 62)
DIAM_C = (206, 36, 62)


def _heart_pts(cx, cy, size):
    pts = []
    for t in np.linspace(0, 2 * math.pi, 120):
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((cx + x * size / 34, cy - y * size / 34))
    return pts


def draw_suit(d, suit, cx, cy, size, color):
    if suit == "heart":
        d.polygon(_heart_pts(cx, cy, size), fill=color)
    elif suit == "spade":
        pts = [(cx + (x - cx), cy - (y - cy)) for x, y in _heart_pts(cx, cy, size)]
        d.polygon(pts, fill=color)
        d.polygon([(cx, cy + size * 0.20), (cx - size * 0.16, cy + size * 0.62), (cx + size * 0.16, cy + size * 0.62)], fill=color)
    elif suit == "diamond":
        d.polygon([(cx, cy - size * 0.52), (cx + size * 0.36, cy), (cx, cy + size * 0.52), (cx - size * 0.36, cy)], fill=color)


def _cut(path, lo=40.0, hi=110.0):
    """標本写真 → 色そのままの RGBA（背景の白を透過）。"""
    a = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    dd = 255.0 - a.min(axis=2)
    t = np.clip((dd - lo) / (hi - lo), 0, 1)
    alpha = t * t * (3 - 2 * t)
    ys, xs = np.nonzero(alpha > 0.15)
    box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    rgba = np.dstack([a, alpha * 255]).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA").crop(box)


def _paste_fit(canvas, art, box, rot180=False):
    x0, y0, x1, y1 = box
    bw, bh = x1 - x0, y1 - y0
    f = min(bw / art.width, bh / art.height) * 0.94
    a = art.resize((int(art.width * f), int(art.height * f)), Image.LANCZOS)
    if rot180:
        a = a.rotate(180)
    canvas.paste(a, (int(x0 + (bw - a.width) / 2), int(y0 + (bh - a.height) / 2)), a)


def draw_pip(face, suit, cx, cy, size, color, flip):
    n = int(size * 1.5)
    tile = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    draw_suit(ImageDraw.Draw(tile), suit, n / 2, n / 2, size, color)
    if flip:
        tile = tile.rotate(180)
    face.alpha_composite(tile, (int(cx - n / 2), int(cy - n / 2)))


def card_face(rank, suit, color, art_path=None, tint=(244, 236, 216), pips=None):
    face = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    d = ImageDraw.Draw(face)
    d.rounded_rectangle([0, 0, CW - 1, CH - 1], radius=70, fill=(255, 254, 250), outline=(32, 32, 44), width=10)
    # 内側の枠と絵のパネル
    fx0, fy0, fx1, fy1 = 140, 150, CW - 140, CH - 150
    d.rounded_rectangle([fx0, fy0, fx1, fy1], radius=28, fill=tint, outline=color, width=8)
    if art_path:
        art = _cut(art_path)
        mid = (fy0 + fy1) // 2
        # 面札のように絵を上下 2 つ（下は 180° 回転）。中央に細い仕切り
        _paste_fit(face, art, (fx0 + 24, fy0 + 24, fx1 - 24, mid - 10))
        _paste_fit(face, art, (fx0 + 24, mid + 10, fx1 - 24, fy1 - 24), rot180=True)
        d.line([(fx0 + 10, mid), (fx1 - 10, mid)], fill=color, width=6)
    elif pips is not None:
        for (x, y, flip) in pips:                      # 数札：下半分のスートは逆さま
            draw_pip(face, suit, x, y, 230, color, flip)
    else:
        # エース：大きなスート 1 つと同心の飾り
        cx, cy = (fx0 + fx1) // 2, (fy0 + fy1) // 2
        draw_suit(d, suit, cx, cy, 520, color)
        for k_, (sz, c) in enumerate([(380, tint), (250, color), (130, (250, 204, 40))]):
            draw_suit(d, suit, cx, cy, sz, c)
        for ang in range(0, 360, 30):
            rr = 330
            x = cx + rr * math.cos(math.radians(ang)) * 0.62
            y = cy + rr * math.sin(math.radians(ang)) * 1.0
            d.ellipse([x - 9, y - 9, x + 9, y + 9], fill=(250, 204, 40))
    # コーナーインデックス（左上と、180°回した右下）
    font = ImageFont.truetype(FONT, 150)
    idx = Image.new("RGBA", (140, 330), (0, 0, 0, 0))
    idd = ImageDraw.Draw(idx)
    bb = idd.textbbox((0, 0), rank, font=font)
    idd.text(((140 - (bb[2] - bb[0])) / 2 - bb[0], 16 - bb[1]), rank, font=font, fill=color)
    draw_suit(idd, suit, 70, 250, 92, color)
    face.paste(idx, (0, 18), idx)
    r = idx.rotate(180)
    face.paste(r, (CW - 140, CH - 330 - 18), r)
    return face


def place_card(face, width, bottom):
    """カードを扇形の中央（体軸上）に、幅 width・下端 bottom で置く。"""
    img, d = new_canvas()
    h = width * CH / CW
    wpx, hpx = int(px(width)), int(px(h))
    f = face.resize((wpx, hpx), Image.LANCZOS)
    img.paste(f, (int(R - wpx / 2), int(R - px(bottom + h))), f)
    # 扇形の縁に当たらないか確認（警告のみ）
    cx, cy = width / 2, bottom
    assert cx <= edge_x(cy) * 0.97, f"カード下端が扇形から出る: {cx:.3f} > {edge_x(cy):.3f}"
    assert math.hypot(cx, bottom + h) <= 0.97, "カード上端が円から出る"
    return img


def trump_king_beetle():
    return place_card(card_face("K", "spade", SPADE_C, "photos/miyama.jpg"), 0.42, 0.34)


def trump_queen_dragonfly():
    return place_card(card_face("Q", "heart", HEART_C, "photos/kawatonbo.jpg"), 0.42, 0.34)


def trump_ace_diamond():
    return place_card(card_face("A", "diamond", DIAM_C, None, tint=(250, 240, 222)), 0.42, 0.34)


def place_card_fan(face, width, center_y, tilt):
    """カードを風車のように 5 枚重ねる。各カードは隣のカードの上に重なる（扇形の縁をまたいで見える）。
    扇形の中身は、5 回対称のシーンを 1/5 に切り出したもの。"""
    h = width * CH / CW
    wpx, hpx = int(px(width)), int(px(h))
    f = face.resize((wpx, hpx), Image.LANCZOS)
    f = f.rotate(tilt, expand=True, resample=Image.BICUBIC)
    base = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    base.paste(f, (int(R - f.width / 2), int(R - px(center_y) - f.height / 2)), f)
    img, d = new_canvas()
    img = img.convert("RGBA")
    for j in (1, 0, -1):                       # 下から順に：時計回り隣 → 自分 → 反時計回り隣
        layer = base.rotate(-j * 360 / K, center=(R, R), resample=Image.BICUBIC)
        img.alpha_composite(layer)
    return img.convert("RGB")


def trump_fan_king():
    return place_card_fan(card_face("K", "spade", SPADE_C, "photos/miyama.jpg"), 0.62, 0.50, 22)


def trump_fan_queen():
    return place_card_fan(card_face("Q", "heart", HEART_C, "photos/kawatonbo.jpg"), 0.62, 0.50, 22)


def trump_fan_ace():
    return place_card_fan(card_face("A", "diamond", DIAM_C, None, tint=(250, 240, 222)), 0.62, 0.50, 22)


DESIGNS = [
    ("angels-ring", "手をつなぐ天使", angel),
    ("trump-king-miyama", "トランプ K（ミヤマクワガタ）", trump_king_beetle),
    ("trump-queen-kawatonbo", "トランプ Q（ニホンカワトンボ）", trump_queen_dragonfly),
    ("trump-ace-diamond", "トランプ A（ダイヤ）", trump_ace_diamond),
    ("fan-king-miyama", "重なるトランプ K", trump_fan_king),
    ("fan-queen-kawatonbo", "重なるトランプ Q", trump_fan_queen),
    ("fan-ace-diamond", "重なるトランプ A", trump_fan_ace),
]


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "out2"
    os.makedirs(out, exist_ok=True)
    cols = len(DESIGNS)
    sheet = Image.new("RGB", (cols * 400, 2 * 400), (20, 20, 24))
    for i, (slug, label, fn) in enumerate(DESIGNS):
        wedge = fn()
        wedge.save(f"{out}/_wedge-{slug}.png")
        full = g.wedge_to_full(wedge)
        full.save(f"{out}/{slug}.png")
        rec = g.reconstruction(wedge)
        rec.save(f"{out}/_recon-{slug}.png")
        for row, im in enumerate((full, rec)):
            sheet.paste(im.resize((400, 400), Image.LANCZOS), (i * 400, row * 400))
        print("generated", slug)
    sheet.save(f"{out}/_sheet.png")
