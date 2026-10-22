"""ユーザーが別に作った『猫が輪になる 5 分割像』から、アプリ用の 360° 原盤を作る。
5 分割像のうち 72° 分を切り出し（頂点＝円の中心、軸＝真上へ回転）、wedgeToFull で全周へ展開する。"""
import math, sys
import numpy as np
from PIL import Image
sys.path.insert(0, ".")
import gen_samples as g

K = 5
SRC = "../images/9.webp"
cx, cy, RS = np.load("cat_circle.npy")
img = np.asarray(Image.open(SRC).convert("RGB")).astype(np.float32)
PAPER = np.array(g.PAPER, np.float32)

def bilinear(a, x, y):
    x = np.clip(x, 0, a.shape[1] - 1.001); y = np.clip(y, 0, a.shape[0] - 1.001)
    x0, y0 = x.astype(int), y.astype(int); fx, fy = (x - x0)[..., None], (y - y0)[..., None]
    return (a[y0, x0]*(1-fx)*(1-fy) + a[y0, x0+1]*fx*(1-fy) + a[y0+1, x0]*(1-fx)*fy + a[y0+1, x0+1]*fx*fy)

def polar(theta_deg, r_norm):
    """元画像の (角度[度, 真上=0 で時計回り], 半径[円の半径=1]) の色。"""
    t = np.radians(theta_deg)
    return bilinear(img, cx + r_norm * RS * np.sin(t), cy - r_norm * RS * np.cos(t))

def seam_cost(theta0, width=3.0):
    r = np.linspace(0.15, 0.97, 200)[None, :]
    d = np.linspace(0, width, 12)[:, None]
    a = polar(theta0 + d, r); b = polar(theta0 + 72 + d, r)
    return float(np.abs(a - b).mean())

def wedge_image(phi, size=800, blend=0.0):
    """軸が phi 度（元画像の真上から時計回り）の 72° 扇形を、頂点中心・軸真上の size 四方に切り出す。
    blend>0 なら、扇形の終わりぎわ blend 度ぶんを『始まりぎわ』とクロスフェードして、左右の縁を一致させる。"""
    c = size / 2
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    dx, dy = xx - c, c - yy
    r = np.hypot(dx, dy) / c
    beta = np.degrees(np.arctan2(dx, dy))                 # 軸からの角度（-36..36）
    out = polar(phi + beta, r)
    if blend > 0:
        w = np.clip((beta - (36 - blend)) / blend, 0, 1)[..., None]     # 右端で 1
        wrap = polar(phi + beta - 72, r)                                # 反対側の縁の続き
        out = out * (1 - w) + wrap * w
        w2 = np.clip(((-36 + blend) - beta) / blend, 0, 1)[..., None] * 0   # 左端は元のまま（周期は右端で閉じる）
    inside = (r <= 1.0) & (np.abs(beta) <= 36)
    return out, inside
