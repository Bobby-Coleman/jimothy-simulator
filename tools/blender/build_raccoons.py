"""
build_raccoons.py - procedurally builds the Jimothy Simulator raccoons and exports GLBs.

Usage (from the project root):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup \
      -P tools/blender/build_raccoons.py -- [--only jimothy,danny,mom,kit] [--no-render]

All geometry is authored in game space (+Y up, +Z forward, +X = character's left, metres).
"""
import math
import os
import sys

sys.dont_write_bytecode = True   # keep tools/blender free of __pycache__
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402

import rlib  # noqa: E402
from rlib import (Mesh, Model, T, Rx, Ry, Rz, frame, frame_z, xform, normalize, hexc, mix,  # noqa: E402
                  smoothstep, vnoise, fbm, sd_sphere, sd_ellipsoid, sd_capsule, sd_round_cone, smin, smax,
                  surface_nets, sdf_raycast, sdf_grad, uv_sphere, cube_sphere, tube, ellipsoid_mesh,
                  bl_decimate, sdf_clump, sdf_mesh)

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(os.path.dirname(HERE))
MODELS_DIR = os.path.join(PROJECT, 'public', 'assets', 'models')
RENDER_DIR = os.path.join(HERE, 'renders')

D = math.radians


# =============================================================================================
# palettes
# =============================================================================================

JIMOTHY_PAL = dict(
    top='#857c72', side='#a69f96', dark='#62594f', belly='#e4dac8', tip='#cdc5b9',
    mask='#1f1b19', white='#f3efe7', stripe='#453d37', brow='#f6f2ea',
    leg='#6f665e', leg_low='#3a3430', paw='#2a2624',
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
        self.body_n = 11
        self.body_fluff = 0.0025
        # head
        self.head_pivot = np.array([0.0, 0.0, 0.0])   # ball centre: the face slides around the ball, no seams
        self.inset = 0.011
        self.k_body = 0.065
        self.head_margin = 0.022
        self.cran_c = np.array([0.0, 0.095, 0.215])
        self.cran_r = np.array([0.20, 0.165, 0.175])
        self.cheek_c = np.array([0.14, 0.03, 0.27])
        self.cheek_r = np.array([0.095, 0.085, 0.09])
        self.k_cheek = 0.05
        self.brow_c = np.array([0.088, 0.185, 0.315])
        self.brow_r = np.array([0.06, 0.032, 0.045])
        self.k_brow = 0.035
        self.muz_c = np.array([0.0, 0.05, 0.38])
        self.muz_r = np.array([0.078, 0.06, 0.075])
        self.muz_pitch = D(10)
        self.k_muz = 0.045
        self.tip_c = np.array([0.0, 0.036, 0.447])
        self.tip_r = 0.035
        self.k_tip = 0.03
        self.chin_c = np.array([0.0, -0.005, 0.365])
        self.chin_r = np.array([0.05, 0.032, 0.06])
        self.k_chin = 0.03
        self.head_h = 0.009
        self.head_tris = 5000
        # eyes
        self.eye_xy = np.array([0.104, 0.132])
        self.eye_r = 0.05
        self.eye_protrude = 0.024
        self.eye_gap = 0.003
        self.eye_out = 0.18   # outward gaze bias
        # nose
        self.nose_size = np.array([0.029, 0.019, 0.021])
        # ears
        self.ear_xz = np.array([0.178, 0.085])
        self.ear_size = np.array([0.066, 0.07, 0.024])  # half width, half height, half thickness
        self.ear_tilt_out = D(22)
        self.ear_out = 0.42
        self.ear_scale = (1.0, 1.0)   # (left, right) multipliers
        # limbs
        self.shoulder = np.array([0.122, -0.20, 0.13])
        self.wrist = np.array([0.128, -0.384, 0.19])
        self.arm_r = (0.066, 0.046)
        self.fingers = 5
        self.hip = np.array([0.132, -0.18, -0.12])
        self.ankle = np.array([0.138, -0.382, -0.13])
        self.leg_r = (0.072, 0.05)
        self.foot_y = -0.42
        # tail
        self.tail_base = np.array([0.0, -0.10, -0.29])
        self.tail_len = 0.76
        self.tail_pitch0 = D(-16)
        self.tail_pitch1 = D(38)
        self.tail_yaw = D(24)
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
    c = mix(side, top, smoothstep(-0.3, 0.45, y))
    # darker, streaky dorsal saddle over the top/back
    sad = smoothstep(0.25, 0.9, N[:, 1]) * smoothstep(0.45, -0.25, P[:, 2] / RB[2])
    streak = 0.75 + 0.25 * fbm(P * np.array([12.0, 6.0, 12.0]), 2, seed=cfg.seed + 31)
    c = mix(c, dark, np.clip(0.75 * sad * streak, 0, 1))
    # cream belly and chest bib
    bib = smoothstep(0.55, 0.86, N @ normalize(np.array([0.0, -0.55, 0.84])))
    bel = smoothstep(-0.45, -0.85, y)
    c = mix(c, belly, np.maximum(bib, bel))
    # grizzle
    n1 = fbm(P * 11.0, 2, seed=cfg.seed + 3)
    c = c * (1.0 + 0.06 * n1)[:, None]
    tips = smoothstep(0.1, 0.7, vnoise(P * 9.0, seed=cfg.seed + 11)) * smoothstep(-0.3, 0.4, y) * (1 - bib)
    c = mix(c, hexc(pal['tip']), getattr(cfg, 'grizzle_tips', 0.16) * tips)
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
    """Returns dict of soft masks (0..1) for the face pattern in face-plane coords (metres).
    All shapes are designed at Jimothy's scale and scaled by cfg.face_scale."""
    fs = getattr(cfg, 'face_scale', 1.0)
    X = X / fs
    Y = Y / fs
    ex, ey = cfg.face_eye_x / fs, cfg.face_eye_y / fs
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
    halo = smoothstep(0.021, 0.011, d_mask)
    brows = np.zeros_like(X)
    for side in (1, -1):
        ax = X * side
        d_b = _ell2(ax, Y, ex - 0.004, ey + 0.068, 0.058, 0.025, D(-9))
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
                  [0.007, 0.011, 0.018, 0.021, 0.028])
    top_fade = smoothstep(ey + 0.125, ey + 0.07, Y)
    ny = getattr(cfg, 'face_nose_y', (ey - 0.15) * fs) / fs
    bot_fade = smoothstep(ny - 0.004, ny + 0.012, Y)
    nx = getattr(cfg, 'face_nose_x', 0.0) / fs
    xs = X - nx * smoothstep(ey - 0.02, ny, Y)
    out['stripe'] = smoothstep(0.004, -0.004, np.abs(xs) - w) * top_fade * bot_fade
    return out


def head_color(P, N, cfg, ff, asym=None, base_fn=None):
    c = (base_fn or body_fur_color)(P, N, cfg)
    pal = cfg.pal
    X, Y, Z = ff.coords(P)
    if asym is None:
        asym = getattr(cfg, 'face_asym', 0.0)
    warp = getattr(cfg, 'face_warp', 0.0)
    if warp:
        X = X + warp * vnoise(P * 18.0, seed=cfg.seed + 41)
        Y = Y + warp * vnoise(P * 18.0, seed=cfg.seed + 43)
    fs = getattr(cfg, 'face_scale', 1.0)
    g = smoothstep(-0.16 * fs, -0.06 * fs, Z)   # only on the front of the head
    if getattr(cfg, 'lift_fade', True):
        # fade the face pattern out where the head surface sinks back into the body -> invisible seam
        lift = sd_ellipsoid(P, (0, 0, 0), cfg.RB)
        g = g * smoothstep(0.001, 0.014, lift)
    m = face_masks(X, Y, Z, cfg, asym)
    white = hexc(pal['white'])
    c = mix(c, white, m['white'] * g)
    c = mix(c, hexc(pal['brow']), m['brows'] * g)
    c = mix(c, hexc(pal['stripe']), m['stripe'] * g * (1 - m['mask']))
    c = mix(c, hexc(pal['mask']), m['mask'] * g)
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
    """Head 'hood': the face bulge surface, plus a thin margin buried just under the body surface.
    Meshed with surface nets at a uniform density (good for vertex-colour patterns)."""
    bsdf = body_sdf_fn(cfg)
    h = cfg.head_h
    hx = h * math.ceil(0.34 / h)   # grid symmetric about x = 0 -> symmetric mesh
    bmin = np.array([-hx, -0.17, 0.0])
    bmax = np.array([hx, 0.37, 0.52])
    m = surface_nets(sdf, bmin, bmax, h)
    import mathutils
    V = m.V
    cen = np.array([V[list(f)].mean(axis=0) for f in m.F])
    vis = bsdf(cen) > -0.002
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
        keep.append(dist is not None and dist < cfg.head_margin)
    m.F = [f for f, k in zip(m.F, keep) if k]
    m.FM = [cfg.fur_mat] * len(m.F)
    m.compact()
    print('  head raw tris', m.tri_count(), 'visible faces', int(vis.sum()))
    if m.tri_count() > cfg.head_tris * 1.04:
        m = bl_decimate(m, target_tris=cfg.head_tris, symmetric=getattr(cfg, 'symmetric', True))
    m.set_mat(cfg.fur_mat)
    fn = color_fn or (lambda V, N, mm: head_color(V, N, cfg, ff))
    m.paint(fn)
    return m


def build_eye(center, gaze, r, highlight_dir, mat='Eye', hl_mat='EyeHighlight', nu=16, nv=11):
    """Eye sphere + two catchlights. Returned in world space."""
    m = uv_sphere(nu, nv, mat)
    M = frame_z(center, gaze, (0, 1, 0))
    m.V = m.V * r
    m.transform(M)
    # catchlights: flattened ellipsoids hugging the surface
    for (off, size) in ((highlight_dir, 0.30), (-0.55 * highlight_dir + np.array([0, -0.2, 0]), 0.13)):
        d = normalize(gaze + off)
        c = center + d * (r * 1.005)
        hl = uv_sphere(8, 5, hl_mat)
        hl.V = hl.V * np.array([r * size, r * size * 1.1, r * 0.05])
        hl.transform(frame_z(c, d, (0, 1, 0)))
        m.add(hl)
    return m


def build_nose(center, fwd, size, mat='Nose'):
    m = uv_sphere(14, 10, mat)
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


def build_mouth(sdf, top, width=0.024, drop=0.011, r=0.0026, mat='Nose', asym=0.0):
    """Philtrum line + ':3' curve, projected onto the head surface below the nose. World space."""
    def proj(x, y):
        P, N = sdf_raycast(sdf, (x, y, 0.9), (0, 0, -1), 0, 1.0, 900)
        return P - N * (r * 0.45)
    x0, y0 = top[0], top[1]
    m = Mesh()
    phil = [proj(x0, y0 - drop * t) for t in np.linspace(0, 1, 4)]
    m.add(tube(phil, [r] * len(phil), n_around=6, cap_rings=2, mat=mat, up_hint=(0, 0, 1)))
    q = width / 0.026
    for side in (1, -1):
        w = width * (1 + asym * side)
        pts2 = [(0.0, -drop), (0.35 * w, -drop - 0.0065 * q), (0.7 * w, -drop - 0.005 * q), (w, -drop + 0.0015 * q)]
        pts = [proj(x0 + side * px, y0 + py) for px, py in pts2]
        m.add(tube(pts, [r, r, r * 0.95, r * 0.8], n_around=6, cap_rings=2, mat=mat, up_hint=(0, 0, 1)))
    m.set_mat(mat)
    return m


def build_ear(cfg, side, scale=1.0):
    """Ear in local space: base at origin, +Y up along ear, +Z = front (concave inner side)."""
    a, b, t = cfg.ear_size * scale
    m = uv_sphere(16, 12, cfg.fur_mat)
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
    V[:, 2] -= cup * t * 0.95
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
        base = smoothstep(0.18 * b, -0.06 * b, Vv[:, 1])
        c = mix(c, hexc(pal['top']), base)
        return c
    m.paint(col)
    return m


def limb_color_fn(cfg, sock_top=-0.325, sock_bot=-0.378):
    pal = cfg.pal

    def col(V, N, mm):
        base = body_fur_color(V, N, cfg)
        # legs are a little darker than the body even at the top
        base = mix(base, hexc(pal['leg']), 0.35)
        t = smoothstep(sock_top, sock_bot, V[:, 1])
        c = mix(base, hexc(pal['leg_low']), t)
        return c * (1 + 0.04 * vnoise(V * 30, seed=5))[:, None]
    return col


def build_limb_arm(cfg, side):
    sx = side
    S = cfg.shoulder * np.array([sx, 1, 1])
    W = cfg.wrist * np.array([sx, 1, 1])
    Wt = W + np.array([0.0, 0.03, 0.0])   # tube end (its rounded cap sits inside the palm)
    ts = np.linspace(0, 1, 7)
    pts = [S + (Wt - S) * t for t in ts]
    radii = [cfg.arm_r[0] + (cfg.arm_r[1] - cfg.arm_r[0]) * smoothstep(0.35, 1.0, t) for t in ts]
    m = tube(pts, radii, n_around=12, cap_rings=3, mat=cfg.fur_mat, up_hint=(0, 0, 1))
    m.paint(limb_color_fn(cfg))
    return m, S, W


def build_hand(cfg, side, W, n_fingers=5, finger_scale=1.0, scale=1.0, lod=1.0):
    """Palm + fingers, world space. side=+1 left(+X), -1 right. W = wrist; palm bottom at W.y-0.036*scale."""
    sx = side
    pal = cfg.pal
    sc = scale
    palm_c = W + np.array([0.0, -0.017, 0.016]) * sc
    palm_r = np.array([0.034, 0.019, 0.036]) * sc
    m = ellipsoid_mesh(palm_c, palm_r, int(round(14 * lod)), int(round(9 * lod)), mat='Paw')
    # fingers fan out forward; thumb is medial (toward -X on the left hand)
    if n_fingers == 5:
        angles = [-58, -26, -4, 17, 38]
        lens = [0.023, 0.032, 0.036, 0.034, 0.027]
    else:
        angles = list(np.linspace(-70, 55, n_fingers))
        lens = list(0.022 + 0.01 * np.sin(np.linspace(0, math.pi, n_fingers)))
    for ang, ln in zip(angles, lens):
        a = D(ang) * sx
        dirf = np.array([math.sin(a), 0.0, math.cos(a)])
        base = palm_c + np.array([dirf[0] * 0.026, -0.004, dirf[2] * 0.03]) * sc
        ln = ln * finger_scale * sc
        p1 = base + dirf * ln * 0.55 + np.array([0, -0.001, 0]) * sc
        p2 = base + dirf * ln + np.array([0, -0.009, 0]) * sc
        pts = [base, p1, p2]
        f = tube(pts, [0.0092 * sc, 0.0086 * sc, 0.0074 * sc], n_around=6 if lod >= 1 else 5,
                 cap_rings=2, mat='Paw', up_hint=(0, 1, 0))
        m.add(f)
    m.set_mat('Paw')
    m.paint(lambda V, N, mm: np.tile(hexc(pal['paw']), (len(V), 1)) * (1 + 0.06 * vnoise(V * 120, seed=9))[:, None])
    return m


def build_leg(cfg, side, n_toes=5, lod=1.0):
    sx = side
    pal = cfg.pal
    H = cfg.hip * np.array([sx, 1, 1])
    A = cfg.ankle * np.array([sx, 1, 1])
    At = A + np.array([0.0, 0.034, 0.0])   # tube end (cap sits inside the foot)
    ts = np.linspace(0, 1, 7)
    pts = [H + (At - H) * t for t in ts]
    radii = [cfg.leg_r[0] + (cfg.leg_r[1] - cfg.leg_r[0]) * smoothstep(0.35, 1.0, t) for t in ts]
    leg = tube(pts, radii, n_around=int(round(12 * lod)), cap_rings=3, mat=cfg.fur_mat, up_hint=(0, 0, 1))
    leg.paint(limb_color_fn(cfg))
    # foot: elongated sole + toes
    fy = cfg.foot_y
    foot_c = np.array([A[0], fy + 0.021, A[2] + 0.028])
    foot = ellipsoid_mesh(foot_c, (0.037, 0.021, 0.060), int(round(14 * lod)), int(round(9 * lod)), mat='Paw')
    toe_angles = np.linspace(-50, 50, n_toes)
    for ang in toe_angles:
        a = D(ang)
        tc = foot_c + np.array([math.sin(a) * 0.028, -0.010, 0.050 + math.cos(a) * 0.012])
        toe = ellipsoid_mesh(tc, (0.0105, 0.009, 0.013), 7 if lod >= 1 else 6, 5 if lod >= 1 else 4, mat='Paw')
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
    r = np.interp(u, [0.0, 0.12, 0.35, 0.62, 0.85, 1.0], [0.056, 0.076, 0.097, 0.097, 0.078, 0.054])
    return r


def tail_color_fn(cfg, s_exit):
    pal = cfg.pal
    L = cfg.tail_len
    n = cfg.tail_rings
    q = L / 0.76   # scale factor relative to Jimothy's tail
    tip_start = L - 0.1 * L
    span = tip_start - s_exit
    period = span / (n + 0.35)
    centres = [s_exit + period * (k + 0.85) for k in range(n)]
    half = period * 0.24

    def col(V, N, mm):
        s = mm.attrs['s']
        dark = np.zeros(len(s))
        for c in centres:
            dark = np.maximum(dark, smoothstep(half + 0.006 * q, half - 0.006 * q, np.abs(s - c)))
        tip = smoothstep(tip_start - 0.006 * q, tip_start + 0.006 * q, s)
        light = hexc(pal['tail_light'])
        # a touch darker along the top of the tail, lighter underneath
        light_c = mix(light * 1.06, light * 0.9, smoothstep(-0.5, 0.8, N[:, 1]))
        c = mix(light_c, hexc(pal['tail_dark']), dark)
        c = mix(c, hexc(pal['tail_tip']), tip)
        # base of the tail blends into body colour
        c = mix(c, hexc(pal['top']), smoothstep(s_exit + 0.02 * q, s_exit - 0.03 * q, s))
        c = c * (1 + 0.05 * fbm(V * 25 / q, 2, seed=cfg.seed + 4))[:, None]
        return c
    return col


def build_tail(cfg, model, parent_name, prefix='Tail', count=5, base=None, curve=None, radius_scale=1.0, n_around=11,
               body_sdf=None):
    """Builds a tail chain as child parts. Each segment extends along its local -Z."""
    if curve is None:
        pts, s = tail_curve(cfg)
    else:
        pts, s = curve
    L = s[-1]
    seg_len = L / count
    bsdf = body_sdf or body_sdf_fn(cfg)
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
        idx = idx[:: max(1, len(idx) // 8)]
        if idx[-1] != np.where(sel)[0][-1]:
            idx = np.append(idx, np.where(sel)[0][-1])
        seg_pts = pts[idx]
        seg_s = s[idx]
        radii = [tail_radius(v, L) * radius_scale for v in seg_s]
        radii = [(r * 1.0, r * 0.92) for r in radii]
        m = tube(seg_pts, radii, n_around=n_around, cap_rings=3, mat=cfg.fur_mat, s_values=seg_s, up_hint=(0, 1, 0))
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

def default_eye_specs(cfg):
    return [dict(name='EyeL', x=cfg.eye_xy[0], y=cfg.eye_xy[1], r=cfg.eye_r, out=cfg.eye_out),
            dict(name='EyeR', x=-cfg.eye_xy[0], y=cfg.eye_xy[1], r=cfg.eye_r, out=-cfg.eye_out)]


def round_raccoon(cfg, variant_hook=None):
    model = Model(cfg.root)
    body = model.add('Body', cfg.root, T(0, 0, 0))
    body.add_mesh(build_body(cfg))

    # --- head: place eyes on the socket-less surface first
    extra = getattr(cfg, 'head_extra', None)
    sdf0 = head_sdf_fn(cfg, extra=extra)
    specs = getattr(cfg, 'eyes', None) or default_eye_specs(cfg)
    sockets, eye_info = [], []
    for e in specs:
        Ps, Ns = sdf_raycast(sdf0, (e['x'], e['y'], 0.9), (0, 0, -1), 0, 1.0, 600)
        c = Ps - Ns * (e['r'] - e['r'] * cfg.eye_protrude / cfg.eye_r)
        gaze = normalize(Ns * 0.45 + np.array([0, 0.02, 1.0]) * 0.55 + np.array([e['out'], e.get('up', 0.0), 0]))
        sockets.append((c, e['r']))
        eye_info.append(dict(name=e['name'], c=c, gaze=gaze, r=e['r'], res=e.get('res', (16, 11))))
    sdf = head_sdf_fn(cfg, sockets, extra=extra)
    # face frame: origin between the two main eyes, on the surface
    mid = (eye_info[0]['c'] + eye_info[1]['c']) / 2
    Pm, Nm = sdf_raycast(sdf0, (0, mid[1], 0.9), (0, 0, -1), 0, 1.0, 600)
    ff = FaceFrame(Pm, normalize(Nm * 0.3 + np.array([0, 0.25, 1.0])))
    Xe, Ye, _ = ff.coords(np.array([eye_info[0]['c']]))
    cfg.face_eye_x, cfg.face_eye_y = abs(float(Xe[0])), float(Ye[0])

    # nose at muzzle tip (placed before painting the head so the nose stripe can end at it)
    axis = normalize(cfg.tip_c - cfg.muz_c)
    Pn, Nn = sdf_raycast(sdf, cfg.tip_c + axis * 0.3, -axis, 0, 0.5, 400)
    nfwd = normalize(Nn * 0.5 + axis * 0.5 + np.array([0, 0.08, 0]))
    nc = Pn - nfwd * cfg.nose_size[2] * 0.25 + np.array([0, 0.004, 0])
    Xn, Yn, _ = ff.coords(np.array([nc + np.array([0, cfg.nose_size[1] * 0.8, 0])]))
    cfg.face_nose_y = float(Yn[0])
    cfg.face_nose_x = float(Xn[0])

    head = model.add('Head', 'Body', T(cfg.head_pivot))
    head.add_mesh(build_head(cfg, sdf, ff))

    # eyes
    hl_dir = np.array([-0.30, 0.36, 0.0])
    for e in eye_info:
        ep = model.add(e['name'], 'Head', T(e['c']))
        nu, nv = e.get('res', (16, 11))
        ep.add_mesh(build_eye(e['c'], e['gaze'], e['r'], hl_dir, nu=nu, nv=nv))

    nose = model.add('Nose', 'Head', T(nc))
    nose.add_mesh(build_nose(nc, nfwd, cfg.nose_size))
    mouth_top = nc + np.array([0.0, -cfg.nose_size[1] * 0.85, 0.0])
    mouth = model.add('Mouth', 'Head', T(mouth_top))
    mouth.add_mesh(build_mouth(sdf, mouth_top, width=0.026, drop=0.012, r=0.0036,
                               asym=getattr(cfg, 'mouth_asym', 0.0)))

    # ears on top of the ball
    bsdf = body_sdf_fn(cfg)
    for side in (1, -1):
        x, z = cfg.ear_xz[0] * side, cfg.ear_xz[1]
        Pe, Ne = sdf_raycast(bsdf, (x, 0.9, z), (0, -1, 0), 0, 1.0, 600)
        up = normalize(Ne * 0.55 + np.array([0, 1.0, 0]) * 0.45)
        up = normalize(up + np.array([side * math.sin(cfg.ear_tilt_out) * 0.3, 0, 0]))
        fwd = normalize(np.array([side * cfg.ear_out, 0.0, 1.0]))
        base = Pe - Ne * 0.012
        M = frame(base, up, fwd)
        nm = 'EarL' if side > 0 else 'EarR'
        sc = cfg.ear_scale[0] if side > 0 else cfg.ear_scale[1]
        ear_local = build_ear(cfg, side, sc)
        ear_local.transform(M)
        ep = model.add(nm, 'Head', M)
        ep.add_mesh(ear_local)

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
        lp = model.add(nm, 'Body', T(H))
        lp.add_mesh(leg)

    # tail
    build_tail(cfg, model, 'Body')

    if variant_hook:
        variant_hook(model, cfg, dict(sdf=sdf, sdf0=sdf0, eyes=eye_info, face=ff, nose=nc))
    return model


# ---------------------------------------------------------------------------------------------
# Danny: 12% bigger, greyer, bushy white "old man" eyebrows (BrowL/BrowR)
# ---------------------------------------------------------------------------------------------

def danny_hook(model, cfg, ctx):
    """Bushy white 'old man' eyebrows: soft SDF fur clumps (BrowL/BrowR, children of Head,
    pivot at the middle of the brow line) drooping over the eyes."""
    sdf = ctx['sdf']
    white = hexc(cfg.pal['brow'])
    root_col = hexc('#bdb8b1')

    def paint_clump(m):
        def col(V, N, mm):
            t = smoothstep(0.004, 0.03, mm.attrs['base'])
            return mix(root_col, white, t) * (1 + 0.035 * vnoise(V * 160, seed=3))[:, None]
        m.paint(col)
        return m

    for e in ctx['eyes'][:2]:
        side = 1 if e['c'][0] > 0 else -1
        c, r = e['c'], e['r']
        bases, cones = [], []
        ts = np.linspace(-0.95, 1.05, 6)
        for t in ts:
            x = c[0] + side * r * 1.0 * t
            y = c[1] + r * 1.12 + r * 0.22 * (1 - t * t) - r * 0.18 * max(t, 0)
            Pb, Nb = sdf_raycast(sdf, (x, y, 0.9), (0, 0, -1), 0, 1.0, 700)
            bases.append((Pb - Nb * 0.004, Nb))
        for i, t in enumerate(ts):
            b, nb = bases[i]
            u = (t + 1) / 2
            d = normalize(nb * 0.55 + np.array([side * (0.35 + 0.6 * u), 0.3 - 0.55 * u, 0.12]))
            L = 0.038 + 0.04 * u
            cones.append((b, b + d * L, 0.017, 0.0045))
            if i + 1 < len(ts):
                cones.append((b, bases[i + 1][0], 0.016, 0.016))
        clump = sdf_clump(cones, h=0.0035, k=0.012, target_tris=460, mat=cfg.fur_mat)
        paint_clump(clump)
        pivot = bases[len(ts) // 2][0]
        nm = 'BrowL' if side > 0 else 'BrowR'
        bp = model.add(nm, 'Head', T(pivot))
        bp.add_mesh(clump)


def danny_cfg():
    cfg = RoundCfg(root='Danny', seed=7)
    cfg.pal = dict(JIMOTHY_PAL)
    cfg.pal.update(top='#8b8680', side='#b1ada7', dark='#6c6761', belly='#e2dfd9', tip='#ecebe7',
                   white='#efeeea', brow='#f7f6f2', stripe='#524c47', mask='#292522',
                   leg='#7d7771', tail_light='#b3aea6', ear_back='#5a544f', ear_rim='#f4f2ee')
    cfg.grizzle_tips = 0.26
    cfg.head_tris = 4000
    cfg.eye_r = 0.046
    cfg.eye_xy = np.array([0.104, 0.125])
    cfg.RB = np.array([0.37, 0.345, 0.38])
    cfg.tail_yaw = D(-20)
    cfg.tail_pitch1 = D(22)
    return cfg


# =============================================================================================
# quadruped raccoons (Mom, Kit)
# =============================================================================================

MOM_PAL = dict(JIMOTHY_PAL)
MOM_PAL.update(top='#7c736a', side='#9d968d', dark='#5a5149', belly='#d3cabc', tip='#c9c1b5',
               leg='#5e564f', leg_low='#2f2a27', paw='#272321', tail_light='#9e9386')

KIT_PAL = dict(JIMOTHY_PAL)
KIT_PAL.update(top='#90877d', side='#aea79e', dark='#6e655d', belly='#ebe3d6', tip='#d8d1c6',
               leg='#6d655e', leg_low='#3a3430', paw='#2e2a27', tail_light='#b0a598')


class QuadCfg:
    def __init__(self, **kw):
        self.root = 'Mom'
        self.fur_mat = 'Fur'
        self.pal = dict(MOM_PAL)
        self.seed = 5
        self.lift_fade = False
        self.symmetric = True
        for k, v in kw.items():
            setattr(self, k, v)


def quad_fur_color(P, N, cfg):
    pal = cfg.pal
    up = N[:, 1]
    top, side, dark, belly = hexc(pal['top']), hexc(pal['side']), hexc(pal['dark']), hexc(pal['belly'])
    c = mix(side, top, smoothstep(-0.25, 0.55, up))
    # darker, streaky saddle along the spine
    spine = smoothstep(0.35, 0.92, up) * smoothstep(cfg.spine_w, 0.0, np.abs(P[:, 0]))
    streak = 0.75 + 0.25 * fbm(P * np.array([9.0, 9.0, 3.0]) / cfg.size, 2, seed=cfg.seed + 31)
    c = mix(c, dark, np.clip(0.8 * spine * streak, 0, 1))
    # lighter belly / throat
    c = mix(c, belly, smoothstep(-0.2, -0.7, up))
    c = c * (1.0 + 0.06 * fbm(P * 11.0 / cfg.size, 2, seed=cfg.seed + 3))[:, None]
    return c


def quad_leg_color_fn(cfg):
    pal = cfg.pal

    def col(V, N, mm):
        base = mix(quad_fur_color(V, N, cfg), hexc(pal['leg']), 0.45)
        t = smoothstep(cfg.sock_top, cfg.sock_bot, V[:, 1])
        return mix(base, hexc(pal['leg_low']), t) * (1 + 0.04 * vnoise(V * 60 / cfg.size, seed=5))[:, None]
    return col


def quad_body_sdf_fn(cfg):
    parts = cfg.body_parts

    def f(P):
        d = None
        for (c, r, k) in parts:
            for sx in ((1, -1) if c[0] != 0 else (1,)):
                cc = np.array([c[0] * sx, c[1], c[2]])
                di = sd_ellipsoid(P, cc, r)
                d = di if d is None else smin(d, di, k)
        return d
    return f


def quad_head_sdf_fn(cfg, sockets=None):
    Rm = Rx(cfg.muz_pitch)

    def f(P):
        d = sd_ellipsoid(P, cfg.cran_c, cfg.cran_r)
        for sx in (1, -1):
            d = smin(d, sd_ellipsoid(P, cfg.cheek_c * np.array([sx, 1, 1]), cfg.cheek_r), cfg.k_cheek)
            d = smin(d, sd_ellipsoid(P, cfg.brow_c * np.array([sx, 1, 1]), cfg.brow_r), cfg.k_brow)
        d = smin(d, sd_ellipsoid(P, cfg.muz_c, cfg.muz_r, Rm), cfg.k_muz)
        d = smin(d, sd_sphere(P, cfg.tip_c, cfg.tip_r), cfg.k_tip)
        d = smin(d, sd_ellipsoid(P, cfg.chin_c, cfg.chin_r), cfg.k_chin)
        if sockets is not None:
            for (c, r) in sockets:
                d = smax(d, -sd_sphere(P, c, r + cfg.eye_gap), cfg.k_sock)
        a, b, rn = cfg.neck
        d = smin(d, sd_capsule(P, a, b, rn), cfg.k_neck)
        return d
    return f


def _bbox_of_sdf_parts(points_radii, pad):
    P = np.array([p for p, r in points_radii])
    R = np.array([r for p, r in points_radii])
    return (P - R[:, None]).min(axis=0) - pad, (P + R[:, None]).max(axis=0) + pad


def catmull(points, n):
    """Catmull-Rom through points, n samples."""
    P = np.asarray(points, dtype=float)
    P = np.vstack([P[0] * 2 - P[1], P, P[-1] * 2 - P[-2]])
    out = []
    segs = len(P) - 3
    for i in range(n):
        t = i / (n - 1) * segs
        k = min(int(t), segs - 1)
        u = t - k
        p0, p1, p2, p3 = P[k], P[k + 1], P[k + 2], P[k + 3]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u
                          + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    return np.array(out)


def build_foot(cfg, A, scale, n_toes=5, lod=1.0):
    """Plantigrade hind foot: sole ellipsoid + toe beads. A = ankle; sole bottom at y=A.y-0.037*scale."""
    pal = cfg.pal
    sc = scale
    foot_c = A + np.array([0.0, -0.016, 0.03]) * sc
    foot = ellipsoid_mesh(foot_c, np.array([0.037, 0.021, 0.060]) * sc, int(round(14 * lod)), int(round(9 * lod)), mat='Paw')
    for ang in np.linspace(-50, 50, n_toes):
        a = D(ang)
        tc = foot_c + np.array([math.sin(a) * 0.028, -0.010, 0.050 + math.cos(a) * 0.012]) * sc
        foot.add(ellipsoid_mesh(tc, np.array([0.0105, 0.009, 0.013]) * sc, 7 if lod >= 1 else 6, 5 if lod >= 1 else 4, mat='Paw'))
    foot.set_mat('Paw')
    foot.paint(lambda V, N, mm: np.tile(hexc(pal['paw']), (len(V), 1)) * (1 + 0.06 * vnoise(V * 120 / sc, seed=10))[:, None])
    return foot


def quad_raccoon(cfg):
    model = Model(cfg.root)
    body = model.add('Body', cfg.root, T(0, 0, 0))
    bsdf = quad_body_sdf_fn(cfg)
    pr = [(np.array(c), max(r)) for (c, r, k) in cfg.body_parts] + [(np.array(c) * np.array([-1, 1, 1]), max(r)) for (c, r, k) in cfg.body_parts]
    bmin, bmax = _bbox_of_sdf_parts(pr, cfg.body_h * 3 + 0.02)
    hx = cfg.body_h * math.ceil(max(abs(bmin[0]), abs(bmax[0])) / cfg.body_h)
    bmin[0], bmax[0] = -hx, hx
    bm = surface_nets(bsdf, bmin, bmax, cfg.body_h)
    print('  body raw tris', bm.tri_count())
    bm = bl_decimate(bm, target_tris=cfg.body_tris, symmetric=True)
    bm.set_mat(cfg.fur_mat)
    bm.paint(lambda V, N, mm: quad_fur_color(V, N, cfg))
    body.add_mesh(bm)

    # --- head (+neck) : eyes first
    sdf0 = quad_head_sdf_fn(cfg)
    sockets, eye_info = [], []
    for side, nm in ((1, 'EyeL'), (-1, 'EyeR')):
        x, y = cfg.eye_xy[0] * side, cfg.eye_xy[1]
        Ps, Ns = sdf_raycast(sdf0, (x, y, cfg.cran_c[2] + 0.5), (0, 0, -1), 0, 1.0, 900)
        c = Ps - Ns * (cfg.eye_r * (1 - cfg.eye_protrude_ratio))
        gaze = normalize(Ns * 0.5 + np.array([0, 0.0, 1.0]) * 0.5 + np.array([side * cfg.eye_out, 0, 0]))
        sockets.append((c, cfg.eye_r))
        eye_info.append(dict(name=nm, c=c, gaze=gaze, r=cfg.eye_r))
    sdf = quad_head_sdf_fn(cfg, sockets)
    mid = (eye_info[0]['c'] + eye_info[1]['c']) / 2
    Pm, Nm = sdf_raycast(sdf0, (0, mid[1], cfg.cran_c[2] + 0.5), (0, 0, -1), 0, 1.0, 900)
    ff = FaceFrame(Pm, normalize(Nm * 0.3 + np.array([0, cfg.face_tilt, 1.0])))
    Xe, Ye, _ = ff.coords(np.array([eye_info[0]['c']]))
    cfg.face_eye_x, cfg.face_eye_y = abs(float(Xe[0])), float(Ye[0])
    axis = normalize(cfg.tip_c - cfg.muz_c)
    Pn, Nn = sdf_raycast(sdf, cfg.tip_c + axis * 0.2, -axis, 0, 0.3, 600)
    nfwd = normalize(Nn * 0.5 + axis * 0.5 + np.array([0, 0.08, 0]))
    nc = Pn - nfwd * cfg.nose_size[2] * 0.25 + np.array([0, cfg.nose_size[1] * 0.2, 0])
    Xn, Yn, _ = ff.coords(np.array([nc + np.array([0, cfg.nose_size[1] * 0.8, 0])]))
    cfg.face_nose_y, cfg.face_nose_x = float(Yn[0]), float(Xn[0])

    a, b, rn = cfg.neck
    pr = [(cfg.cran_c, max(cfg.cran_r)), (cfg.cheek_c, max(cfg.cheek_r)),
          (cfg.cheek_c * np.array([-1, 1, 1]), max(cfg.cheek_r)), (cfg.muz_c, max(cfg.muz_r)),
          (cfg.tip_c, cfg.tip_r), (np.array(a), rn), (np.array(b), rn)]
    hmin, hmax = _bbox_of_sdf_parts(pr, cfg.head_h * 3 + 0.01)
    hx = cfg.head_h * math.ceil(max(abs(hmin[0]), abs(hmax[0])) / cfg.head_h)
    hmin[0], hmax[0] = -hx, hx
    hm = surface_nets(sdf, hmin, hmax, cfg.head_h)
    cen = np.array([hm.V[list(f)].mean(axis=0) for f in hm.F])
    keep = bsdf(cen) > -cfg.neck_cull
    hm.F = [f for f, k in zip(hm.F, keep) if k]
    hm.FM = [cfg.fur_mat] * len(hm.F)
    hm.compact()
    print('  head raw tris', hm.tri_count())
    hm = bl_decimate(hm, target_tris=cfg.head_tris, symmetric=True)
    hm.set_mat(cfg.fur_mat)
    hm.paint(lambda V, N, mm: head_color(V, N, cfg, ff, base_fn=quad_fur_color))
    head = model.add('Head', 'Body', T(cfg.head_pivot))
    head.add_mesh(hm)

    hl_dir = np.array([-0.30, 0.36, 0.0])
    for e in eye_info:
        ep = model.add(e['name'], 'Head', T(e['c']))
        ep.add_mesh(build_eye(e['c'], e['gaze'], e['r'], hl_dir, nu=cfg.eye_res[0], nv=cfg.eye_res[1]))
    nose = model.add('Nose', 'Head', T(nc))
    nose.add_mesh(build_nose(nc, nfwd, cfg.nose_size))
    if getattr(cfg, 'mouth', True):
        mouth_top = nc + np.array([0.0, -cfg.nose_size[1] * 0.85, 0.0])
        mouth = model.add('Mouth', 'Head', T(mouth_top))
        k = cfg.face_scale
        mouth.add_mesh(build_mouth(sdf, mouth_top, width=0.026 * k * 1.3, drop=0.012 * k * 1.3, r=0.0036 * k * 1.5))

    # ears
    for side, nm in ((1, 'EarL'), (-1, 'EarR')):
        base = cfg.ear_base * np.array([side, 1, 1])
        up = normalize(cfg.ear_up * np.array([side, 1, 1]))
        fwd = normalize(np.array([side * cfg.ear_out, 0.0, 1.0]))
        M = frame(base, up, fwd)
        ec = RoundCfg(**{k2: v for k2, v in vars(cfg).items() if k2 in ('pal', 'fur_mat')})
        ec.ear_size = cfg.ear_size
        ear = build_ear(ec, side)
        ear.transform(M)
        ep = model.add(nm, 'Head', M)
        ep.add_mesh(ear)

    # legs
    for nm, spec in cfg.legs.items():
        for side, suffix in ((1, 'L'), (-1, 'R')):
            J = np.array(spec['joint']) * np.array([side, 1, 1])
            K = np.array(spec['knee']) * np.array([side, 1, 1])
            E = np.array(spec['end']) * np.array([side, 1, 1])
            Et = E + np.array([0.0, spec.get('end_lift', 0.0), 0.0])
            pts = catmull([J, K, Et], 9)
            rr = np.interp(np.linspace(0, 1, 9), [0, 0.5, 1], spec['radii'])
            leg = tube(pts, list(rr), n_around=spec.get('n_around', 10), cap_rings=3, mat=cfg.fur_mat,
                       up_hint=(0, 0, 1))
            leg.paint(quad_leg_color_fn(cfg))
            if spec['paw'] == 'hand':
                paw = build_hand(cfg, side, E, 5, scale=spec['paw_scale'], lod=spec.get('lod', 1.0))
            else:
                paw = build_foot(cfg, E, spec['paw_scale'], lod=spec.get('lod', 1.0))
            leg.add(paw)
            part = model.add('%s%s' % (nm, suffix) if nm.endswith(('F', 'B')) else nm + suffix, 'Body', T(J))
            part.add_mesh(leg)

    # tail
    build_tail(cfg, model, 'Body', radius_scale=cfg.tail_radius_scale, n_around=cfg.tail_n_around,
               body_sdf=bsdf)
    return model


def mom_cfg():
    cfg = QuadCfg(root='Mom', pal=dict(MOM_PAL), seed=5)
    cfg.size = 1.0
    cfg.spine_w = 0.07
    cfg.body_parts = [
        ((0.0, 0.25, -0.03), (0.132, 0.12, 0.25), 0.05),      # torso
        ((0.0, 0.285, -0.20), (0.138, 0.135, 0.15), 0.05),    # rump (hunched)
        ((0.0, 0.235, 0.12), (0.105, 0.112, 0.12), 0.05),     # chest
        ((0.0, 0.20, -0.06), (0.11, 0.085, 0.17), 0.05),      # belly
        ((0.075, 0.23, -0.20), (0.065, 0.10, 0.10), 0.04),    # haunches
        ((0.07, 0.235, 0.10), (0.055, 0.085, 0.07), 0.04),    # shoulders
    ]
    cfg.body_h = 0.012
    cfg.body_tris = 2600
    cfg.head_pivot = np.array([0.0, 0.285, 0.15])
    cfg.neck = ((0.0, 0.255, 0.09), (0.0, 0.30, 0.245), 0.066)
    cfg.k_neck = 0.04
    cfg.cran_c = np.array([0.0, 0.318, 0.282])
    cfg.cran_r = np.array([0.08, 0.07, 0.074])
    cfg.cheek_c = np.array([0.058, 0.292, 0.292])
    cfg.cheek_r = np.array([0.05, 0.043, 0.048])
    cfg.k_cheek = 0.025
    cfg.brow_c = np.array([0.034, 0.346, 0.33])
    cfg.brow_r = np.array([0.028, 0.016, 0.02])
    cfg.k_brow = 0.015
    cfg.muz_c = np.array([0.0, 0.292, 0.36])
    cfg.muz_r = np.array([0.035, 0.029, 0.055])
    cfg.muz_pitch = D(12)
    cfg.k_muz = 0.022
    cfg.tip_c = np.array([0.0, 0.281, 0.405])
    cfg.tip_r = 0.016
    cfg.k_tip = 0.015
    cfg.chin_c = np.array([0.0, 0.266, 0.338])
    cfg.chin_r = np.array([0.028, 0.017, 0.035])
    cfg.k_chin = 0.015
    cfg.k_sock = 0.006
    cfg.eye_gap = 0.0015
    cfg.head_h = 0.0056
    cfg.head_tris = 2600
    cfg.neck_cull = 0.02
    cfg.eye_xy = np.array([0.038, 0.33])
    cfg.eye_r = 0.0172
    cfg.eye_protrude_ratio = 0.5
    cfg.eye_out = 0.2
    cfg.eye_res = (14, 9)
    cfg.face_tilt = 0.1
    cfg.face_scale = 0.37
    cfg.nose_size = np.array([0.0145, 0.0095, 0.011])
    cfg.ear_base = np.array([0.058, 0.368, 0.262])
    cfg.ear_up = np.array([0.45, 1.0, -0.15])
    cfg.ear_out = 0.35
    cfg.ear_size = np.array([0.029, 0.031, 0.010])
    cfg.sock_top, cfg.sock_bot = 0.13, 0.04
    cfg.legs = {
        'LegF': dict(joint=(0.07, 0.22, 0.12), knee=(0.074, 0.12, 0.128), end=(0.077, 0.023, 0.14),
                     end_lift=0.012, radii=(0.046, 0.03, 0.022), paw='hand', paw_scale=0.64),
        'LegB': dict(joint=(0.08, 0.25, -0.20), knee=(0.088, 0.14, -0.15), end=(0.09, 0.024, -0.235),
                     end_lift=0.012, radii=(0.058, 0.036, 0.024), paw='foot', paw_scale=0.64),
    }
    cfg.tail_base = np.array([0.0, 0.30, -0.30])
    cfg.tail_len = 0.44
    cfg.tail_pitch0 = D(-28)
    cfg.tail_pitch1 = D(-8)
    cfg.tail_yaw = D(12)
    cfg.tail_rings = 5
    cfg.tail_radius_scale = 0.66
    cfg.tail_n_around = 10
    return cfg


def kit_cfg():
    cfg = QuadCfg(root='Kit', pal=dict(KIT_PAL), seed=9)
    cfg.size = 0.35
    cfg.spine_w = 0.03
    cfg.body_parts = [
        ((0.0, 0.07, -0.035), (0.052, 0.05, 0.068), 0.03),
        ((0.0, 0.074, 0.018), (0.045, 0.047, 0.045), 0.03),
        ((0.03, 0.062, -0.065), (0.026, 0.035, 0.035), 0.02),   # little haunches
    ]
    cfg.body_h = 0.005
    cfg.body_tris = 1100
    cfg.head_pivot = np.array([0.0, 0.086, 0.02])
    cfg.neck = ((0.0, 0.078, 0.0), (0.0, 0.103, 0.045), 0.034)
    cfg.k_neck = 0.02
    cfg.cran_c = np.array([0.0, 0.117, 0.058])
    cfg.cran_r = np.array([0.058, 0.052, 0.052])
    cfg.cheek_c = np.array([0.036, 0.1, 0.073])
    cfg.cheek_r = np.array([0.032, 0.028, 0.03])
    cfg.k_cheek = 0.016
    cfg.brow_c = np.array([0.022, 0.138, 0.092])
    cfg.brow_r = np.array([0.018, 0.010, 0.013])
    cfg.k_brow = 0.01
    cfg.muz_c = np.array([0.0, 0.099, 0.098])
    cfg.muz_r = np.array([0.02, 0.016, 0.022])
    cfg.muz_pitch = D(8)
    cfg.k_muz = 0.012
    cfg.tip_c = np.array([0.0, 0.096, 0.115])
    cfg.tip_r = 0.009
    cfg.k_tip = 0.008
    cfg.chin_c = np.array([0.0, 0.088, 0.094])
    cfg.chin_r = np.array([0.015, 0.009, 0.015])
    cfg.k_chin = 0.008
    cfg.k_sock = 0.004
    cfg.eye_gap = 0.0008
    cfg.head_h = 0.0029
    cfg.head_tris = 2300
    cfg.neck_cull = 0.008
    cfg.eye_xy = np.array([0.0285, 0.121])
    cfg.eye_r = 0.0148
    cfg.eye_protrude_ratio = 0.5
    cfg.eye_out = 0.14
    cfg.eye_res = (14, 10)
    cfg.face_tilt = 0.18
    cfg.face_scale = 0.27
    cfg.nose_size = np.array([0.0088, 0.006, 0.0068])
    cfg.ear_base = np.array([0.037, 0.154, 0.042])
    cfg.ear_up = np.array([0.55, 1.0, -0.1])
    cfg.ear_out = 0.35
    cfg.ear_size = np.array([0.02, 0.021, 0.0068])
    cfg.sock_top, cfg.sock_bot = 0.035, 0.012
    cfg.legs = {
        'LegF': dict(joint=(0.03, 0.06, 0.02), knee=(0.031, 0.036, 0.024), end=(0.032, 0.011, 0.03),
                     end_lift=0.004, radii=(0.019, 0.015, 0.012), paw='hand', paw_scale=0.3, n_around=8, lod=0.7),
        'LegB': dict(joint=(0.034, 0.06, -0.07), knee=(0.036, 0.036, -0.066), end=(0.037, 0.011, -0.078),
                     end_lift=0.004, radii=(0.021, 0.016, 0.012), paw='foot', paw_scale=0.3, n_around=8, lod=0.7),
    }
    cfg.tail_base = np.array([0.0, 0.075, -0.09])
    cfg.tail_len = 0.12
    cfg.tail_pitch0 = D(12)
    cfg.tail_pitch1 = D(62)
    cfg.tail_yaw = D(28)
    cfg.tail_rings = 4
    cfg.tail_radius_scale = 0.34
    cfg.tail_n_around = 8
    return cfg


def build_mom(render=True):
    rlib.reset_scene()
    cfg = mom_cfg()
    model = quad_raccoon(cfg)
    mats = raccoon_materials()
    finish(model, mats, 'mom', render, floor_y=0.0, closeup=((0, 0.31, 0.33), 0.14))
    return model


def build_kit(render=True):
    rlib.reset_scene()
    cfg = kit_cfg()
    model = quad_raccoon(cfg)
    mats = raccoon_materials()
    finish(model, mats, 'kit', render, floor_y=0.0, closeup=((0, 0.11, 0.09), 0.08))
    return model


# =============================================================================================
# materials
# =============================================================================================

def raccoon_materials(fur_name='Fur', slop=False):
    mats = {}
    mats[fur_name] = rlib.make_material(fur_name, '#ffffff', rough=0.92, vcol=True)
    mats['Paw'] = rlib.make_material('Paw', '#ffffff', rough=0.72, vcol=True)
    mats['Eye'] = rlib.make_material('Eye', '#060505', rough=0.05)
    mats['EyeHighlight'] = rlib.make_material('EyeHighlight', '#ffffff', rough=0.4,
                                              emission='#ffffff', emission_strength=1.0)
    mats['Nose'] = rlib.make_material('Nose', '#161212', rough=0.3)
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
    """Jimothy rolled up into a ball: the rolling form (the walking Jimothy is build_jimothy.py). The real Jimothy's
    tail is a very short puff, so the ball's tail is a short, fat stub too."""
    rlib.reset_scene()
    cfg = RoundCfg()
    cfg.tail_len = 0.26
    cfg.tail_rings = 2
    cfg.tail_pitch1 = D(30)
    cfg.tail_yaw = D(12)
    model = round_raccoon(cfg)
    mats = raccoon_materials()
    finish(model, mats, 'jimothy_ball', render, closeup=((0, 0.1, 0.3), 0.3))
    return model


def build_danny(render=True):
    rlib.reset_scene()
    cfg = danny_cfg()
    model = round_raccoon(cfg, danny_hook)
    model.scale_all(1.12)
    mats = raccoon_materials()
    finish(model, mats, 'danny', render, floor_y=-0.42 * 1.12, closeup=((0, 0.11, 0.34), 0.34))
    return model


BUILDERS = {
    'jimothy': build_jimothy,
    'danny': build_danny,
    'mom': build_mom,
    'kit': build_kit,
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
