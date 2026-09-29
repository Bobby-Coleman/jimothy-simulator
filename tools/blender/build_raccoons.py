"""
build_raccoons.py - procedurally builds the Jimothy Simulator raccoons and exports GLBs.

Usage (from the project root):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup \
      -P tools/blender/build_raccoons.py -- [--only jimothy,danny,slopothy,mom,kit] [--no-render]

All geometry is authored in game space (+Y up, +Z forward, +X = character's left, metres).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402

import rlib  # noqa: E402
from rlib import (Mesh, Model, T, Rx, Ry, Rz, frame, frame_z, xform, normalize, hexc, mix,  # noqa: E402
                  smoothstep, vnoise, fbm, sd_sphere, sd_ellipsoid, sd_capsule, smin, smax,
                  surface_nets, sdf_raycast, sdf_grad, uv_sphere, cube_sphere, tube, ellipsoid_mesh,
                  bl_decimate, mirrored)

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(os.path.dirname(HERE))
MODELS_DIR = os.path.join(PROJECT, 'public', 'assets', 'models')
RENDER_DIR = os.path.join(HERE, 'renders')

D = math.radians


# =============================================================================================
# palettes
# =============================================================================================

JIMOTHY_PAL = dict(
    top='#857c72', side='#a39d95', dark='#655d56', belly='#e8dfcf', tip='#d2cbc0',
    mask='#1f1b19', white='#f3efe7', stripe='#453d37', brow='#f6f2ea',
    leg='#5a524b', leg_low='#38322e', paw='#2a2624',
    ear_inner='#3a322e', ear_rim='#efe9df', ear_back='#4f4740',
    tail_light='#a59a8d', tail_dark='#2f2a27', tail_tip='#2a2523',
)


# =============================================================================================
# round raccoon (Jimothy / Danny / Slopothy)
# =============================================================================================

class RoundCfg:
    def __init__(self, **kw):
        self.root = 'Jimothy'
        self.fur_mat = 'Fur'
        self.pal = dict(JIMOTHY_PAL)
        self.seed = 1
        # body ellipsoid radii (x = width, y = height, z = length)
        self.RB = np.array([0.365, 0.35, 0.378])
        self.body_n = 14
        self.body_fluff = 0.004
        # head
        self.head_pivot = np.array([0.0, 0.05, 0.14])
        self.inset = 0.016
        self.k_body = 0.06
        self.cran_c = np.array([0.0, 0.10, 0.19])
        self.cran_r = np.array([0.215, 0.19, 0.20])
        self.cheek_c = np.array([0.145, 0.03, 0.27])
        self.cheek_r = np.array([0.105, 0.085, 0.09])
        self.k_cheek = 0.05
        self.brow_c = np.array([0.088, 0.185, 0.315])
        self.brow_r = np.array([0.06, 0.032, 0.045])
        self.k_brow = 0.035
        self.muz_c = np.array([0.0, 0.05, 0.375])
        self.muz_r = np.array([0.078, 0.06, 0.075])
        self.muz_pitch = D(10)
        self.k_muz = 0.045
        self.tip_c = np.array([0.0, 0.037, 0.438])
        self.tip_r = 0.036
        self.k_tip = 0.03
        self.chin_c = np.array([0.0, -0.005, 0.365])
        self.chin_r = np.array([0.05, 0.032, 0.06])
        self.k_chin = 0.03
        self.head_h = 0.0085
        self.head_tris = 3200
        # eyes
        self.eye_xy = np.array([0.098, 0.138])
        self.eye_r = 0.047
        self.eye_protrude = 0.024
        self.eye_gap = 0.003
        self.eye_out = 0.18   # outward gaze bias
        # nose
        self.nose_size = np.array([0.024, 0.0155, 0.018])
        # ears
        self.ear_xz = np.array([0.172, 0.075])
        self.ear_size = np.array([0.052, 0.056, 0.017])  # half width, half height, half thickness
        self.ear_tilt_out = D(22)
        self.ear_scale = (1.0, 1.0)   # (left, right) multipliers
        # limbs
        self.shoulder = np.array([0.150, -0.19, 0.13])
        self.wrist = np.array([0.158, -0.384, 0.195])
        self.arm_r = (0.048, 0.040)
        self.fingers = 5
        self.hip = np.array([0.160, -0.17, -0.12])
        self.ankle = np.array([0.165, -0.382, -0.135])
        self.leg_r = (0.056, 0.046)
        self.foot_y = -0.42
        # tail
        self.tail_base = np.array([0.0, -0.10, -0.29])
        self.tail_len = 0.76
        self.tail_pitch0 = D(-16)
        self.tail_pitch1 = D(38)
        self.tail_yaw = D(0)
        self.tail_rings = 5
        for k, v in kw.items():
            setattr(self, k, v)


# ---------------------------------------------------------------------------------------------
# colour functions
# ---------------------------------------------------------------------------------------------

def body_fur_color(P, N, cfg):
    pal = cfg.pal
    RB = cfg.RB
    y = P[:, 1] / RB[1]
    top, side, dark, belly = hexc(pal['top']), hexc(pal['side']), hexc(pal['dark']), hexc(pal['belly'])
    c = mix(side, top, smoothstep(-0.15, 0.7, y))
    # darker dorsal saddle toward the back/top
    sad = smoothstep(0.45, 0.95, N[:, 1]) * smoothstep(0.35, -0.3, P[:, 2] / RB[2])
    c = mix(c, dark, 0.55 * sad)
    # cream belly and chest bib
    bib = smoothstep(0.30, 0.72, N @ normalize(np.array([0.0, -0.5, 0.86])))
    bel = smoothstep(-0.30, -0.72, y)
    c = mix(c, belly, np.maximum(bib, bel))
    # grizzle
    n1 = fbm(P * 34.0, 2, seed=cfg.seed + 3)
    n2 = vnoise(P * 90.0, seed=cfg.seed + 7)
    c = c * (1.0 + 0.07 * n1 + 0.045 * n2)[:, None]
    tips = smoothstep(0.35, 0.8, vnoise(P * 64.0, seed=cfg.seed + 11)) * smoothstep(-0.3, 0.4, y) * (1 - bib)
    c = mix(c, hexc(pal['tip']), 0.30 * tips)
    return c


def _ell2(x, y, cx, cy, rx, ry, ang=0.0):
    """approx signed distance to a rotated 2D ellipse (negative inside)"""
    dx, dy = x - cx, y - cy
    ca, sa = math.cos(ang), math.sin(ang)
    u = dx * ca + dy * sa
    v = -dx * sa + dy * ca
    k = np.sqrt((u / rx) ** 2 + (v / ry) ** 2)
    return (k - 1.0) * min(rx, ry)


def _smin2(a, b, k):
    return smin(a, b, k)


class FaceFrame:
    """Face-plane coordinates: X lateral (+ = raccoon's left), Y up along face, Z out of face."""

    def __init__(self, origin, fwd):
        self.O = np.asarray(origin, dtype=float)
        self.F = normalize(fwd)
        up = np.array([0.0, 1.0, 0.0])
        self.U = normalize(up - self.F * np.dot(up, self.F))
        self.R = np.cross(self.U, self.F)  # +X

    def coords(self, P):
        q = P - self.O
        return q @ self.R, q @ self.U, q @ self.F


def face_masks(X, Y, Z, cfg, asym=0.0):
    """Returns dict of soft masks (0..1) for the face pattern in face-plane coords (metres)."""
    ex, ey = cfg.face_eye_x, cfg.face_eye_y
    out = {}
    res = {}
    for side in (1, -1):
        ax = X * side
        a = asym * side
        d_eye = _ell2(ax, Y, ex + 0.004, ey - 0.004 - a * 0.02, 0.080, 0.053, D(-17) + a * 0.3)
        d_chk = _ell2(ax, Y, ex + 0.07, ey - 0.052 - a * 0.03, 0.058, 0.03, D(-30))
        d = _smin2(d_eye, d_chk, 0.03)
        res[side] = d
    d_bridge = _ell2(X, Y, 0.0, ey - 0.006, 0.05, 0.03)
    d_mask = _smin2(_smin2(res[1], res[-1], 0.01), d_bridge, 0.02)
    out['d_mask'] = d_mask
    out['mask'] = smoothstep(0.004, -0.006, d_mask)
    # white halo framing the mask + eyebrows + muzzle + cheeks
    halo = smoothstep(0.024, 0.012, d_mask)
    brows = np.zeros_like(X)
    for side in (1, -1):
        ax = X * side
        d_b = _ell2(ax, Y, ex - 0.008, ey + 0.066, 0.058, 0.026, D(14))
        brows = np.maximum(brows, smoothstep(0.006, -0.006, d_b))
    out['brows'] = brows
    d_muz = _ell2(X, Y, 0.0, ey - 0.13, 0.10, 0.085)
    cheeks = np.zeros_like(X)
    for side in (1, -1):
        d_c = _ell2(X * side, Y, ex + 0.05, ey - 0.12, 0.10, 0.065, D(-10))
        cheeks = np.maximum(cheeks, smoothstep(0.01, -0.01, d_c))
    muzzle = smoothstep(0.01, -0.01, d_muz)
    out['white'] = np.maximum.reduce([halo, brows, muzzle, cheeks])
    # nose bridge stripe: from forehead down to the nose
    w = np.interp(Y, [ey - 0.16, ey - 0.08, ey - 0.02, ey + 0.06, ey + 0.13],
                  [0.008, 0.013, 0.02, 0.022, 0.03])
    top_fade = smoothstep(ey + 0.16, ey + 0.10, Y)
    bot_fade = smoothstep(ey - 0.185, ey - 0.15, Y)
    out['stripe'] = smoothstep(0.004, -0.004, np.abs(X) - w) * top_fade * bot_fade
    return out


def head_color(P, N, cfg, ff, asym=0.0):
    c = body_fur_color(P, N, cfg)
    pal = cfg.pal
    X, Y, Z = ff.coords(P)
    g = smoothstep(-0.16, -0.06, Z)   # only on the front of the head
    m = face_masks(X, Y, Z, cfg, asym)
    white = hexc(pal['white'])
    c = mix(c, white, m['white'] * g)
    c = mix(c, hexc(pal['brow']), m['brows'] * g)
    c = mix(c, hexc(pal['stripe']), m['stripe'] * g * (1 - m['mask']))
    c = mix(c, hexc(pal['mask']), m['mask'] * g)
    # slightly darker lip line / chin shadow under the muzzle
    return c


# ---------------------------------------------------------------------------------------------
# geometry
# ---------------------------------------------------------------------------------------------

def body_sdf_fn(cfg):
    RB = cfg.RB

    def f(P):
        return sd_ellipsoid(P, (0, 0, 0), RB)
    return f


def head_sdf_fn(cfg, eyes=None, extra=None):
    RB = cfg.RB
    Rm = Rx(cfg.muz_pitch)

    def f(P):
        d = sd_ellipsoid(P, cfg.cran_c, cfg.cran_r)
        for sx in (1, -1):
            cc = cfg.cheek_c * np.array([sx, 1, 1])
            d = smin(d, sd_ellipsoid(P, cc, cfg.cheek_r), cfg.k_cheek)
            bc = cfg.brow_c * np.array([sx, 1, 1])
            d = smin(d, sd_ellipsoid(P, bc, cfg.brow_r), cfg.k_brow)
        d = smin(d, sd_ellipsoid(P, cfg.muz_c, cfg.muz_r, Rm), cfg.k_muz)
        d = smin(d, sd_sphere(P, cfg.tip_c, cfg.tip_r), cfg.k_tip)
        d = smin(d, sd_ellipsoid(P, cfg.chin_c, cfg.chin_r), cfg.k_chin)
        if extra is not None:
            d = extra(P, d)
        if eyes is not None:
            for (c, r) in eyes:
                d = smax(d, -sd_sphere(P, c, r + cfg.eye_gap), 0.012)
        d = smin(d, sd_ellipsoid(P, (0, 0, 0), RB) + cfg.inset, cfg.k_body)
        return d
    return f


def build_body(cfg):
    m = cube_sphere(cfg.body_n, cfg.fur_mat)
    dirs = m.V.copy()
    m.V = dirs * cfg.RB
    if cfg.body_fluff:
        m.V = m.V + dirs * (cfg.body_fluff * fbm(m.V * 8.0, 2, seed=cfg.seed + 21))[:, None]
    m.paint(lambda V, N, mm: body_fur_color(V, N, cfg))
    return m


def build_head(cfg, sdf, ff, color_fn=None):
    bsdf = body_sdf_fn(cfg)
    bmin = np.array([-0.33, -0.16, 0.0])
    bmax = np.array([0.33, 0.37, 0.52])
    m = surface_nets(sdf, bmin, bmax, cfg.head_h)
    # keep only the part of the hood that is visible or near-visible
    import mathutils
    V = m.V
    cen = np.array([V[list(f)].mean(axis=0) for f in m.F])
    vis = bsdf(cen) > -0.003
    kd = mathutils.kdtree.KDTree(int(vis.sum()))
    for i, c in enumerate(cen[vis]):
        kd.insert(c.tolist(), i)
    kd.balance()
    keep = []
    for i, c in enumerate(cen):
        if vis[i]:
            keep.append(True)
            continue
        _, _, dist = kd.find(c.tolist())
        keep.append(dist is not None and dist < 0.045)
    m.F = [f for f, k in zip(m.F, keep) if k]
    m.FM = [cfg.fur_mat] * len(m.F)
    m.compact()
    print('  head raw tris', m.tri_count())
    m = bl_decimate(m, target_tris=cfg.head_tris, symmetric=True)
    m.set_mat(cfg.fur_mat)
    fn = color_fn or (lambda V, N, mm: head_color(V, N, cfg, ff))
    m.paint(fn)
    return m


def build_eye(center, gaze, r, highlight_dir, mat='Eye', hl_mat='EyeHighlight', nu=18, nv=12):
    """Eye sphere + two catchlights. Returned in world space."""
    m = uv_sphere(nu, nv, mat)
    M = frame_z(center, gaze, (0, 1, 0))
    m.V = m.V * r
    m.transform(M)
    # catchlights: flattened ellipsoids hugging the surface
    for (off, size) in ((highlight_dir, 0.30), (-0.55 * highlight_dir + np.array([0, -0.2, 0]), 0.13)):
        d = normalize(gaze + off)
        c = center + d * (r * 1.005)
        hl = uv_sphere(8, 6, hl_mat)
        hl.V = hl.V * np.array([r * size, r * size * 1.1, r * 0.05])
        hl.transform(frame_z(c, d, (0, 1, 0)))
        m.add(hl)
    return m


def build_nose(center, fwd, size, mat='Nose'):
    m = uv_sphere(16, 12, mat)
    V = m.V.copy()
    yn = V[:, 1]
    # rounded inverted triangle: narrower at the bottom, flat-ish top, tiny central groove
    V[:, 0] *= 1.0 - 0.30 * smoothstep(0.3, -1.0, yn)
    V[:, 1] = np.where(yn > 0, yn * 0.85, yn)
    groove = np.exp(-(V[:, 0] / 0.18) ** 2) * smoothstep(0.2, -0.8, yn)
    V[:, 2] -= 0.18 * groove * (V[:, 2] > 0)
    m.V = V * size
    m.transform(frame_z(center, fwd, (0, 1, 0)))
    return m


def build_ear(cfg, side, scale=1.0):
    """Ear in local space: base at origin, +Y up along ear, +Z = front (concave inner side)."""
    a, b, t = cfg.ear_size * scale
    m = uv_sphere(18, 14, cfg.fur_mat)
    V = m.V.copy()
    yc = b * 0.62
    V[:, 0] *= a
    V[:, 1] = V[:, 1] * b + yc
    V[:, 2] *= t
    rel = (V[:, 1] - yc) / b
    # rounded-triangle taper toward the top
    V[:, 0] *= 1.0 - 0.22 * smoothstep(0.0, 1.0, rel)
    # concave cup on the front
    rr = (V[:, 0] / a) ** 2 + ((V[:, 1] - yc) / b) ** 2
    cup = np.clip(1.0 - rr / 0.75, 0, 1) * (V[:, 2] > 0)
    V[:, 2] -= cup * t * 1.25
    # gentle forward curl of the top
    V[:, 2] += (np.clip(rel, 0, 1) ** 2) * t * 0.9
    m.V = V
    pal = cfg.pal

    def col(Vv, N, mm):
        rel2 = (Vv[:, 1] - yc) / b
        rad = np.sqrt((Vv[:, 0] / (a * (1 - 0.22 * smoothstep(0.0, 1.0, rel2)))) ** 2 + rel2 ** 2)
        front = smoothstep(-0.1, 0.35, N[:, 2])
        inner = hexc(pal['ear_inner'])
        back = hexc(pal['ear_back'])
        c = mix(back, inner, front)
        rim = smoothstep(0.66, 0.8, rad) * smoothstep(-0.55, -0.25, rel2)
        c = mix(c, hexc(pal['ear_rim']), rim)
        # blend into head fur at the base
        base = smoothstep(0.012, -0.004, Vv[:, 1])
        c = mix(c, hexc(pal['top']), base)
        return c
    m.paint(col)
    return m


def build_limb_arm(cfg, side):
    sx = side
    S = cfg.shoulder * np.array([sx, 1, 1])
    W = cfg.wrist * np.array([sx, 1, 1])
    pts = [S + (W - S) * t for t in np.linspace(0, 1, 6)]
    radii = [cfg.arm_r[0] + (cfg.arm_r[1] - cfg.arm_r[0]) * t for t in np.linspace(0, 1, 6)]
    m = tube(pts, radii, n_around=10, cap_rings=3, mat=cfg.fur_mat, up_hint=(0, 0, 1))
    pal = cfg.pal

    def col(V, N, mm):
        t = smoothstep(-0.26, -0.37, V[:, 1])
        c = mix(hexc(pal['leg']), hexc(pal['leg_low']), t)
        return c * (1 + 0.05 * vnoise(V * 80, seed=5))[:, None]
    m.paint(col)
    return m, S, W


def build_hand(cfg, side, W, n_fingers=5, finger_scale=1.0):
    """Palm + fingers, world space. side=+1 left(+X), -1 right."""
    sx = side
    pal = cfg.pal
    palm_c = W + np.array([0.0, -0.017, 0.016])
    palm_r = np.array([0.034, 0.019, 0.036])
    m = ellipsoid_mesh(palm_c, palm_r, 14, 9, mat='Paw')
    # fingers fan out forward; thumb is medial (toward -X on the left hand)
    if n_fingers == 5:
        angles = [-62, -27, -5, 17, 40]
        lens = [0.020, 0.028, 0.032, 0.030, 0.024]
    else:
        angles = list(np.linspace(-70, 55, n_fingers))
        lens = list(0.022 + 0.01 * np.sin(np.linspace(0, math.pi, n_fingers)))
    for ang, ln in zip(angles, lens):
        a = D(ang) * sx
        dirf = np.array([math.sin(a), 0.0, math.cos(a)])
        base = palm_c + np.array([dirf[0] * 0.026, -0.004, dirf[2] * 0.03])
        ln = ln * finger_scale
        p1 = base + dirf * ln * 0.55 + np.array([0, -0.001, 0])
        p2 = base + dirf * ln + np.array([0, -0.009, 0])
        pts = [base, p1, p2]
        f = tube(pts, [0.0078, 0.0072, 0.0062], n_around=6, cap_rings=2, mat='Paw', up_hint=(0, 1, 0))
        m.add(f)
    m.set_mat('Paw')
    m.paint(lambda V, N, mm: np.tile(hexc(pal['paw']), (len(V), 1)) * (1 + 0.06 * vnoise(V * 120, seed=9))[:, None])
    return m


def build_leg(cfg, side, n_toes=5):
    sx = side
    pal = cfg.pal
    H = cfg.hip * np.array([sx, 1, 1])
    A = cfg.ankle * np.array([sx, 1, 1])
    pts = [H + (A - H) * t for t in np.linspace(0, 1, 6)]
    radii = [cfg.leg_r[0] + (cfg.leg_r[1] - cfg.leg_r[0]) * t for t in np.linspace(0, 1, 6)]
    leg = tube(pts, radii, n_around=10, cap_rings=3, mat=cfg.fur_mat, up_hint=(0, 0, 1))

    def col(V, N, mm):
        t = smoothstep(-0.27, -0.37, V[:, 1])
        return mix(hexc(pal['leg']), hexc(pal['leg_low']), t) * (1 + 0.05 * vnoise(V * 80, seed=6))[:, None]
    leg.paint(col)
    # foot: elongated sole + toes
    fy = cfg.foot_y
    foot_c = np.array([A[0], fy + 0.021, A[2] + 0.028])
    foot = ellipsoid_mesh(foot_c, (0.037, 0.021, 0.060), 14, 9, mat='Paw')
    toe_angles = np.linspace(-50, 50, n_toes)
    for ang in toe_angles:
        a = D(ang)
        tc = foot_c + np.array([math.sin(a) * 0.028, -0.010, 0.050 + math.cos(a) * 0.012])
        toe = ellipsoid_mesh(tc, (0.0095, 0.0085, 0.012), 8, 6, mat='Paw')
        foot.add(toe)
    foot.set_mat('Paw')
    foot.paint(lambda V, N, mm: np.tile(hexc(pal['paw']), (len(V), 1)) * (1 + 0.06 * vnoise(V * 120, seed=10))[:, None])
    leg.add(foot)
    return leg, H


def tail_curve(cfg, n=200):
    """Rest-pose tail centreline: returns points (n,3), arc-length s (n,)."""
    L = cfg.tail_len
    s = np.linspace(0, L, n)
    pts = [cfg.tail_base.copy()]
    ds = L / (n - 1)
    for i in range(1, n):
        u = s[i] / L
        pitch = cfg.tail_pitch0 + (cfg.tail_pitch1 - cfg.tail_pitch0) * u ** 1.4
        yaw = cfg.tail_yaw * u ** 2
        d = np.array([math.sin(yaw) * math.cos(pitch), math.sin(pitch), -math.cos(yaw) * math.cos(pitch)])
        pts.append(pts[-1] + d * ds)
    return np.array(pts), s


def tail_radius(s, L):
    u = s / L
    r = np.interp(u, [0.0, 0.12, 0.35, 0.62, 0.85, 1.0], [0.050, 0.066, 0.086, 0.086, 0.068, 0.048])
    return r


def tail_color_fn(cfg, s_exit):
    pal = cfg.pal
    L = cfg.tail_len
    n = cfg.tail_rings
    tip_start = L - 0.075
    span = tip_start - s_exit
    period = span / (n + 0.35)
    centres = [s_exit + period * (k + 0.85) for k in range(n)]
    half = period * 0.24

    def col(V, N, mm):
        s = mm.attrs['s']
        dark = np.zeros(len(s))
        for c in centres:
            dark = np.maximum(dark, smoothstep(half + 0.006, half - 0.006, np.abs(s - c)))
        dark = np.maximum(dark, smoothstep(tip_start - 0.006, tip_start + 0.006, s))
        light = hexc(pal['tail_light'])
        # a touch darker along the top of the tail, lighter underneath
        light_c = mix(light * 1.06, light * 0.9, smoothstep(-0.5, 0.8, N[:, 1]))
        c = mix(light_c, hexc(pal['tail_dark']), dark)
        # base of the tail blends into body colour
        c = mix(c, hexc(pal['top']), smoothstep(s_exit + 0.02, s_exit - 0.03, s))
        c = c * (1 + 0.06 * fbm(V * 60, 2, seed=cfg.seed + 4))[:, None]
        return c
    return col


def build_tail(cfg, model, parent_name, prefix='Tail', count=5, base=None, curve=None, radius_scale=1.0):
    """Builds a tail chain as child parts. Each segment extends along its local -Z."""
    if curve is None:
        pts, s = tail_curve(cfg)
    else:
        pts, s = curve
    L = s[-1]
    seg_len = L / count
    bsdf = body_sdf_fn(cfg)
    inside = bsdf(pts) < 0
    s_exit = s[np.argmax(~inside)] if (~inside).any() else 0.0
    colf = tail_color_fn(cfg, s_exit)
    parent = parent_name
    parts = []
    tang_all = np.gradient(pts, axis=0)
    for k in range(count):
        s0, s1 = k * seg_len, (k + 1) * seg_len
        sel = (s >= s0 - 1e-9) & (s <= s1 + 1e-9)
        idx = np.where(sel)[0]
        idx = idx[:: max(1, len(idx) // 11)]
        if idx[-1] != np.where(sel)[0][-1]:
            idx = np.append(idx, np.where(sel)[0][-1])
        seg_pts = pts[idx]
        seg_s = s[idx]
        radii = [tail_radius(v, L) * radius_scale for v in seg_s]
        radii = [(r * 1.0, r * 0.92) for r in radii]
        m = tube(seg_pts, radii, n_around=12, cap_rings=3, mat=cfg.fur_mat, s_values=seg_s, up_hint=(0, 1, 0))
        # fluffy irregularity
        m.V = m.V + (m.V - m.V.mean(axis=0)) * 0.0
        m.paint(colf)
        t0 = normalize(tang_all[idx[0]])
        M = frame_z(seg_pts[0], -t0, (0, 1, 0))
        name = '%s%d' % (prefix, k + 1)
        part = model.add(name, parent, M)
        part.add_mesh(m)
        parts.append(part)
        parent = name
    return parts


# ---------------------------------------------------------------------------------------------
# assembling the round raccoon
# ---------------------------------------------------------------------------------------------

def round_raccoon(cfg, variant_hook=None):
    model = Model(cfg.root)
    body = model.add('Body', cfg.root, T(0, 0, 0))
    body.add_mesh(build_body(cfg))

    # --- head: place eyes on the socket-less surface first
    sdf0 = head_sdf_fn(cfg)
    eyes = []
    eye_info = []
    for side in (1, -1):
        x, y = cfg.eye_xy[0] * side, cfg.eye_xy[1]
        Ps, Ns = sdf_raycast(sdf0, (x, y, 0.9), (0, 0, -1), 0, 1.0, 600)
        c = Ps - Ns * (cfg.eye_r - cfg.eye_protrude)
        gaze = normalize(Ns * 0.45 + np.array([0, 0.02, 1.0]) * 0.55 + np.array([side * cfg.eye_out, 0, 0]))
        eyes.append((c, cfg.eye_r))
        eye_info.append((side, c, gaze))
    sdf = head_sdf_fn(cfg, eyes)
    # face frame: origin between the eyes on the surface
    mid = (eye_info[0][1] + eye_info[1][1]) / 2
    Pm, Nm = sdf_raycast(sdf0, (0, mid[1], 0.9), (0, 0, -1), 0, 1.0, 600)
    ff = rlib_face = FaceFrame(Pm, normalize(Nm * 0.3 + np.array([0, 0.25, 1.0])))
    Xe, Ye, _ = ff.coords(np.array([eye_info[0][1]]))
    cfg.face_eye_x, cfg.face_eye_y = float(Xe[0]), float(Ye[0])

    head = model.add('Head', 'Body', T(cfg.head_pivot))
    head.add_mesh(build_head(cfg, sdf, ff))

    # eyes
    hl_dir = np.array([-0.30, 0.36, 0.0])
    for side, c, gaze in eye_info:
        nm = 'EyeL' if side > 0 else 'EyeR'
        e = model.add(nm, 'Head', T(c))
        e.add_mesh(build_eye(c, gaze, cfg.eye_r, hl_dir))

    # nose at muzzle tip
    Rm = Rx(cfg.muz_pitch)
    axis = normalize(np.array([0, (cfg.tip_c - cfg.muz_c)[1], (cfg.tip_c - cfg.muz_c)[2]]))
    Pn, Nn = sdf_raycast(sdf, cfg.tip_c + axis * 0.3, -axis, 0, 0.5, 400)
    nfwd = normalize(Nn * 0.5 + axis * 0.5 + np.array([0, 0.08, 0]))
    nc = Pn - nfwd * cfg.nose_size[2] * 0.25 + np.array([0, 0.004, 0])
    nose = model.add('Nose', 'Head', T(nc))
    nose.add_mesh(build_nose(nc, nfwd, cfg.nose_size))

    # ears on top of the ball
    bsdf = body_sdf_fn(cfg)
    for side in (1, -1):
        x, z = cfg.ear_xz[0] * side, cfg.ear_xz[1]
        Pe, Ne = sdf_raycast(bsdf, (x, 0.9, z), (0, -1, 0), 0, 1.0, 600)
        up = normalize(Ne * 0.55 + np.array([0, 1.0, 0]) * 0.45)
        # tilt outward a bit more
        up = normalize(up + np.array([side * math.sin(cfg.ear_tilt_out) * 0.3, 0, 0]))
        fwd = normalize(np.array([side * 0.28, 0.0, 1.0]))
        base = Pe - Ne * 0.012
        M = frame(base, up, fwd)
        nm = 'EarL' if side > 0 else 'EarR'
        sc = cfg.ear_scale[0] if side > 0 else cfg.ear_scale[1]
        ear_local = build_ear(cfg, side, sc)
        ear_local.transform(M)
        e = model.add(nm, 'Head', M)
        e.add_mesh(ear_local)

    # arms + hands
    for side in (1, -1):
        arm, S, W = build_limb_arm(cfg, side)
        nm = 'ArmL' if side > 0 else 'ArmR'
        a = model.add(nm, 'Body', T(S))
        a.add_mesh(arm)
        hn = 'HandL' if side > 0 else 'HandR'
        h = model.add(hn, nm, T(W))
        h.add_mesh(build_hand(cfg, side, W, cfg.fingers))

    # legs
    for side in (1, -1):
        leg, H = build_leg(cfg, side)
        nm = 'LegL' if side > 0 else 'LegR'
        l = model.add(nm, 'Body', T(H))
        l.add_mesh(leg)

    # tail
    build_tail(cfg, model, 'Body')

    if variant_hook:
        variant_hook(model, cfg, dict(sdf=sdf, sdf0=sdf0, eyes=eye_info, face=ff))
    return model


FaceFrame_ = FaceFrame


# =============================================================================================
# materials
# =============================================================================================

def raccoon_materials(fur_name='Fur', slop=False):
    mats = {}
    mats[fur_name] = rlib.make_material(fur_name, '#ffffff', rough=0.92, spec=0.25, vcol=True)
    mats['Paw'] = rlib.make_material('Paw', '#ffffff', rough=0.7, spec=0.35, vcol=True)
    mats['Eye'] = rlib.make_material('Eye', '#060505', rough=0.06, spec=0.8, coat=0.0)
    mats['EyeHighlight'] = rlib.make_material('EyeHighlight', '#ffffff', rough=0.3, spec=0.2,
                                              emission='#ffffff', emission_strength=1.5)
    mats['Nose'] = rlib.make_material('Nose', '#141111', rough=0.28, spec=0.6)
    return mats


# =============================================================================================
# build + export + render driver
# =============================================================================================

def finish(model, mats, out_name, render=True, floor_y=-0.42, closeup=None):
    print(model.report())
    import bpy
    objs = rlib.realize(model, mats)
    root = objs[model.root.name]
    path = os.path.join(MODELS_DIR, out_name + '.glb')
    rlib.export_glb(path, root)
    if render:
        rlib.setup_preview_scene(floor_z=floor_y)
        mesh_objs = [o for o in objs.values() if o.type == 'MESH']
        rlib.render_views(mesh_objs, os.path.join(RENDER_DIR, out_name + '_views.png'))
        if closeup is not None:
            focus_g, rad = closeup
            fb = np.array([focus_g[0], -focus_g[2], focus_g[1]])
            rlib.render_views(mesh_objs, os.path.join(RENDER_DIR, out_name + '_face.png'),
                              views=('front', 'three_quarter'), focus=fb, radius=rad, size=640, elevation=8)
    return objs


def build_jimothy(render=True):
    rlib.reset_scene()
    cfg = RoundCfg()
    model = round_raccoon(cfg)
    mats = raccoon_materials()
    finish(model, mats, 'jimothy', render, closeup=((0, 0.1, 0.3), 0.3))
    return model


BUILDERS = {
    'jimothy': build_jimothy,
}


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    only = None
    render = True
    i = 0
    while i < len(argv):
        if argv[i] == '--only':
            only = argv[i + 1].split(',')
            i += 2
        elif argv[i] == '--no-render':
            render = False
            i += 1
        else:
            i += 1
    names = only or list(BUILDERS)
    for n in names:
        print('=' * 20, 'BUILDING', n)
        BUILDERS[n](render=render)


if __name__ == '__main__':
    main()
