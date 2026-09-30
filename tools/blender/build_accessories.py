"""
build_accessories.py - mutator cosmetics for Jimothy, authored in Jimothy's HEAD space.

Every accessory is a root-level node at the origin with identity transform whose geometry is
expressed relative to Jimothy's `Head` pivot, which is the ball centre (0, 0, 0) in Jimothy space.
In the game:
    head.add(accessory)   // local position/rotation/scale = identity
puts it exactly where it belongs.  For Danny (1.12x) also set accessory.scale = 1.12.

Usage:
  blender.exe -b --factory-startup -P tools/blender/build_accessories.py -- [--no-render]
"""
import math
import os
import sys

sys.dont_write_bytecode = True   # keep tools/blender free of __pycache__
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402

import rlib  # noqa: E402
from rlib import (Mesh, Model, T, Rx, Ry, Rz, frame, frame_z, xform, normalize, hexc, mix,  # noqa: E402
                  smoothstep, vnoise, fbm, sd_sphere, sd_ellipsoid, smin, uv_sphere, tube, loft,
                  ellipsoid_mesh, sdf_clump, sdf_mesh, fix_winding)
import build_raccoons as br  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(os.path.dirname(HERE))
MODELS_DIR = os.path.join(PROJECT, 'public', 'assets', 'models')
RENDER_DIR = os.path.join(HERE, 'renders')
D = math.radians

JCFG = br.RoundCfg()
HEAD_PIVOT = JCFG.head_pivot.copy()     # (0, 0, 0) in Jimothy space (ball centre)
RB = JCFG.RB                             # Jimothy's body ellipsoid radii


def ball_surface(dirs):
    """Point on Jimothy's body ellipsoid along unit directions from the body centre."""
    dirs = np.atleast_2d(dirs)
    t = 1.0 / np.sqrt(np.sum((dirs / RB) ** 2, axis=1))
    return dirs * t[:, None]


def ball_height_along(p, axis, offset=0.0):
    """Project points p along +axis onto the (offset-inflated) ball surface (from inside)."""
    p = np.atleast_2d(p)
    a = normalize(axis)
    R = RB + offset
    # solve |(p + t a)/R| = 1 for the largest t
    A = np.sum((a / R) ** 2)
    B = 2 * np.sum((p / R) * (a / R), axis=1)
    C = np.sum((p / R) ** 2, axis=1) - 1
    t = (-B + np.sqrt(np.maximum(B * B - 4 * A * C, 0))) / (2 * A)
    return p + t[:, None] * a


def solid_color(m, col):
    m.C = np.tile(hexc(col), (len(m.V), 1))
    return m


# =============================================================================================
# Graduation cap (mortarboard + tassel)
# =============================================================================================

def grad_cap():
    m = Mesh()
    cz = 0.06
    # skull cap: cylinder hugging the top of the ball between the ears
    r = 0.108
    n = 28
    rings = []
    top_y = 0.405
    for k, frac in enumerate((0.0, 0.35, 0.7, 1.0)):
        ring = []
        for i in range(n):
            a = -2 * math.pi * i / n
            x, z = r * math.cos(a), cz + r * math.sin(a)
            base = ball_height_along(np.array([[x, 0.0, z]]), (0, 1, 0), 0.004)[0]
            y = base[1] - 0.012 + (top_y - base[1] + 0.012) * frac
            ring.append((x, y, z))
        rings.append(np.array(ring))
    skull = loft(rings, None, np.array([0, top_y, cz]), mat='CapBlack')
    fix_winding(skull)
    m.add(solid_color(skull, '#1d1c22'))
    # board
    s, th = 0.175, 0.013
    by = 0.412
    V = []
    for yy in (by - th / 2, by + th / 2):
        for (x, z) in ((-s, -s), (s, -s), (s, s), (-s, s)):
            V.append((x, yy, cz + z))
    F = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    board = Mesh(np.array(V), F, 'CapBlack')
    fix_winding(board)
    m.add(solid_color(board, '#232228'))
    # button
    btn = ellipsoid_mesh((0, by + th / 2 + 0.004, cz), (0.014, 0.007, 0.014), 12, 6, mat='Tassel')
    m.add(solid_color(btn, '#e9b731'))
    # tassel cord: across the board to the +X edge, then hanging down
    ex = s + 0.004
    cord = [np.array(p) for p in [(0, by + th / 2 + 0.006, cz), (0.08, by + th / 2 + 0.005, cz + 0.05),
                                   (0.15, by + th / 2 + 0.004, cz + 0.095), (ex, by + 0.002, cz + 0.11),
                                   (ex + 0.004, by - 0.03, cz + 0.112), (ex + 0.006, by - 0.07, cz + 0.114)]]
    m.add(solid_color(tube(cord, [0.0035] * len(cord), n_around=6, cap_rings=1, mat='Tassel'), '#e9b731'))
    knot = ellipsoid_mesh(cord[-1], (0.009, 0.008, 0.009), 10, 6, mat='Tassel')
    m.add(solid_color(knot, '#e9b731'))
    # tassel bundle (flared)
    top = cord[-1] + np.array([0, -0.004, 0])
    pts = [top + np.array([0, -0.012 * i, 0]) for i in range(6)]
    radii = [0.008, 0.009, 0.011, 0.013, 0.015, 0.016]
    bundle = tube(pts, radii, n_around=12, cap_start=False, cap_end=True, cap_rings=1, mat='Tassel')
    V = bundle.V
    # stringy ridges
    ang = np.arctan2(V[:, 2] - top[2], V[:, 0] - top[0])
    rel = V - np.array([top[0], V[0, 1], top[2]])
    bundle.V[:, 0] = top[0] + (V[:, 0] - top[0]) * (1 + 0.12 * np.cos(ang * 6))
    bundle.V[:, 2] = top[2] + (V[:, 2] - top[2]) * (1 + 0.12 * np.cos(ang * 6))
    m.add(solid_color(bundle, '#f0c43c'))
    return m


# =============================================================================================
# Sunglasses
# =============================================================================================

def lens_outline(w_top=0.132, w_bot=0.106, h=0.086, rc=0.022, n=32):
    """Rounded trapezoid outline (x, y) centred at 0, counter-clockwise."""
    corners = [(-w_bot / 2, -h / 2), (w_bot / 2, -h / 2), (w_top / 2, h / 2), (-w_top / 2, h / 2)]
    pts = []
    k = len(corners)
    for i in range(k):
        p0 = np.array(corners[i - 1])
        p1 = np.array(corners[i])
        p2 = np.array(corners[(i + 1) % k])
        d0 = normalize(p1 - p0)
        d1 = normalize(p2 - p1)
        a = p1 - d0 * rc
        b = p1 + d1 * rc
        for t in np.linspace(0, 1, n // k):
            # quadratic bezier around the corner
            q = (1 - t) ** 2 * a + 2 * (1 - t) * t * p1 + t ** 2 * b
            pts.append(q)
    return np.array(pts)


def sunglasses():
    m = Mesh()
    ol = lens_outline()
    for side in (1, -1):
        c = np.array([side * 0.1, 0.142, 0.412])
        M = frame_z(c, normalize(np.array([side * 0.26, 0.12, 1.0])), (0, 1, 0))
        # lens: fan with a slight forward bulge
        o3 = np.stack([ol[:, 0] * side, ol[:, 1], np.zeros(len(ol))], axis=1)
        if side < 0:
            o3 = o3[::-1]
        inner = o3 * 0.55 + np.array([0, 0, 0.004])
        centre = np.array([0, 0, 0.006])
        V = np.concatenate([o3, inner, centre[None]])
        nn = len(o3)
        F = []
        for i in range(nn):
            j = (i + 1) % nn
            F.append((i, j, nn + j, nn + i))
            F.append((nn + i, nn + j, 2 * nn))
        lens = Mesh(V, F, 'Lens')
        # orient front faces toward +Z (local)
        nrm = lens.normals()
        if nrm[:, 2].mean() < 0:
            lens.flip()
        lens.transform(M)
        m.add(solid_color(lens, '#1b2533'))
        # frame rim (closed loop tube)
        loop = np.concatenate([o3, o3[:1]]) * 1.02 + np.array([0, 0, 0.002])
        rim = tube(xform(M, loop), [(0.0065, 0.0065)] * len(loop), n_around=6, cap_start=False,
                   cap_end=False, mat='Frame')
        m.add(solid_color(rim, '#141416'))
        # thicker top bar
        top = [p for p in o3 * 1.02 if p[1] > 0.02]
        top = sorted(top, key=lambda p: p[0])
        bar = tube(xform(M, np.array(top) + np.array([0, 0.004, 0.003])), [0.0085] * len(top), n_around=8,
                   cap_rings=2, mat='Frame')
        m.add(solid_color(bar, '#141416'))
        # temple arm: from outer top corner back along the side of the head
        outer = xform(M, np.array([[side * 0.068, 0.03, 0.0]]))[0]
        pts = [outer, outer + np.array([side * 0.03, -0.002, -0.035]), np.array([side * 0.215, 0.163, 0.30]),
               np.array([side * 0.242, 0.158, 0.235]), np.array([side * 0.25, 0.15, 0.16])]
        arm = tube(pts, [0.0055] * len(pts), n_around=6, cap_rings=2, mat='Frame')
        m.add(solid_color(arm, '#141416'))
    # bridge over the nose
    br_pts = [np.array([-0.04, 0.165, 0.418]), np.array([-0.02, 0.174, 0.426]), np.array([0.0, 0.177, 0.428]),
              np.array([0.02, 0.174, 0.426]), np.array([0.04, 0.165, 0.418])]
    m.add(solid_color(tube(br_pts, [0.006] * 5, n_around=8, cap_rings=2, mat='Frame'), '#141416'))
    return m


# =============================================================================================
# Baseball cap (teal crown, navy brim)
# =============================================================================================

def baseball_cap():
    m = Mesh()
    tilt = D(28)
    axis = normalize(np.array([0.0, math.cos(tilt), math.sin(tilt)]))
    p0 = ball_surface(axis)[0]
    Mc = frame(p0, axis, (0, 0, 1))
    Mci = np.linalg.inv(Mc)
    R, H = 0.182, 0.125
    n_around, n_up = 36, 9
    rings = []
    for k in range(n_up):
        phi = (k / (n_up - 1)) * (math.pi / 2) * 0.93
        ring = []
        for i in range(n_around):
            a = -2 * math.pi * i / n_around
            lx, lz = R * math.cos(phi) * math.cos(a), R * math.cos(phi) * math.sin(a)
            ly = H * math.sin(phi) - 0.02
            s_w = ball_height_along(xform(Mc, np.array([[lx, -0.2, lz]])), axis, 0.005)[0]
            s_local = (Mci @ np.append(s_w, 1))[1]
            ly2 = s_local if k == 0 else max(ly, s_local + 0.004 * (1 - k / n_up))
            ring.append(xform(Mc, np.array([[lx, ly2, lz]]))[0])
        rings.append(np.array(ring))
    top = xform(Mc, np.array([[0, H - 0.02 + 0.004, 0]]))[0]
    crown = loft(rings, None, top, mat='CapFabric')
    fix_winding(crown)
    teal, seam, navy = hexc('#1f9190'), hexc('#177574'), hexc('#1b2748')
    Vl = xform(Mci, crown.V)
    az = np.arctan2(Vl[:, 2], Vl[:, 0])
    seams = smoothstep(0.975, 0.997, np.abs(np.cos(az * 3)))
    col = mix(np.tile(teal, (len(Vl), 1)), seam, 0.8 * seams * smoothstep(0.0, 0.03, Vl[:, 1]))
    # navy front badge (a simple roundel - no logos)
    badge = smoothstep(0.034, 0.027, np.sqrt(Vl[:, 0] ** 2 + (Vl[:, 1] - 0.045) ** 2)) * (Vl[:, 2] > 0)
    crown.C = col
    m.add(crown)
    btn = ellipsoid_mesh(top, (0.014, 0.008, 0.014), 10, 6, mat='CapFabric')
    m.add(solid_color(btn, '#1b2748'))
    # brim: root follows the crown's front rim, then juts forward (world +Z), arched and drooping
    nu, nv = 19, 7
    th = 0.008
    fwd = normalize(np.array([0.0, -0.05, 1.0]))
    top_rows, bot_rows = [], []
    for j in range(nv):
        v = j / (nv - 1)
        rt, rb = [], []
        for i in range(nu):
            u = -1 + 2 * i / (nu - 1)
            a = u * D(80) + math.pi / 2
            root = xform(Mc, np.array([[R * 0.985 * math.cos(a), 0.0, R * 0.985 * math.sin(a)]]))[0]
            root = ball_height_along(root[None], axis, 0.006)[0] + axis * 0.004
            L = 0.15 * max(0.0, math.cos(u * math.pi / 2)) ** 0.55
            side = np.array([u * 0.035, 0.0, 0.0])
            p = root + (fwd * L + side * v) * v
            p = p + np.array([0.0, -0.028 * u * u * v - 0.01 * v * v, 0.0])
            rt.append(p)
            rb.append(p + np.array([0.0, -th, 0.0]))
        top_rows.append(rt)
        bot_rows.append(rb)
    gt = np.array(top_rows).reshape(-1, 3)
    gb = np.array(bot_rows).reshape(-1, 3)
    V = np.concatenate([gt, gb])
    F = []
    off = nu * nv
    for j in range(nv - 1):
        for i in range(nu - 1):
            a, b, c, d = j * nu + i, j * nu + i + 1, (j + 1) * nu + i + 1, (j + 1) * nu + i
            F.append((a, d, c, b))
            F.append((off + a, off + b, off + c, off + d))
    for i in range(nu - 1):
        a, b = (nv - 1) * nu + i, (nv - 1) * nu + i + 1
        F.append((a, off + a, off + b, b))
        a, b = i, i + 1
        F.append((a, b, off + b, off + a))
    for j in range(nv - 1):
        a, b = j * nu, (j + 1) * nu
        F.append((a, b, off + b, off + a))
        a, b = j * nu + nu - 1, (j + 1) * nu + nu - 1
        F.append((a, off + a, off + b, b))
    brim = Mesh(V, F, 'CapFabric')
    fix_winding(brim)
    # navy brim with a slightly lighter underside edge
    m.add(solid_color(brim, '#1b2748'))
    return m


# =============================================================================================
# Beanie (Grandma's hand-knitted hat, red, with pompom)
# =============================================================================================

def beanie():
    m = Mesh()
    axis = normalize(np.array([0.0, 1.0, -0.2]))
    Mb = frame(np.zeros(3), axis, (0, 0, 1))
    th_max = D(60)
    n_th, n_ph = 20, 72
    red, red_dk, cream = hexc('#c3303a'), hexc('#9e2029'), hexc('#f1e6cf')
    rings, cols = [], []
    cuff_start = D(47)
    for k in range(1, n_th + 1):
        th = th_max * k / n_th
        ring, cring = [], []
        for i in range(n_ph):
            ph = -2 * math.pi * i / n_ph
            dl = np.array([math.sin(th) * math.cos(ph), math.cos(th), math.sin(th) * math.sin(ph)])
            d = xform(Mb, dl[None])[0]
            base = ball_surface(d)[0]
            thick = 0.013
            if th >= cuff_start:
                # rolled cuff: bulge + fine vertical ribbing
                u = (th - cuff_start) / (th_max - cuff_start)
                thick = 0.016 + 0.012 * math.sin(math.pi * min(1.0, u * 1.1)) + 0.0025 * math.cos(ph * 40)
            else:
                # knit columns
                thick += 0.0022 * math.cos(ph * 30) + 0.0012 * math.cos(th * 90)
            p = base + d * thick
            ring.append(p)
            stripe = smoothstep(0.012, 0.0, abs(th - D(30)) - D(3.2))
            c = mix(red, cream, stripe)
            if th >= cuff_start:
                c = mix(red_dk, red, 0.5 + 0.5 * math.cos(ph * 40))
            c = c * (1 + 0.05 * math.cos(ph * 30) * (th < cuff_start))
            cring.append(c)
        rings.append(np.array(ring))
        cols.append(np.array(cring))
    # tuck the lower edge back into the head so there is no open rim
    last = rings[-1]
    tuck = np.array([ball_surface(normalize(p))[0] - normalize(p) * 0.004 for p in last])
    rings.append(tuck)
    cols.append(cols[-1])
    top = ball_surface(axis)[0] + axis * 0.013
    shell = loft(rings, top, None, mat='Knit')
    fix_winding(shell)
    shell.C = np.concatenate([np.concatenate(cols), [red]])
    m.add(shell)
    # pompom: lumpy yarn ball
    pc = ball_surface(axis)[0] + axis * 0.07
    rng = np.random.default_rng(3)
    cones = []
    for i in range(22):
        d = normalize(rng.normal(size=3))
        a = pc + d * 0.018
        b = pc + d * (0.05 + 0.012 * rng.random())
        cones.append((a, b, 0.03, 0.02))
    pom = sdf_clump(cones, h=0.0055, k=0.018, target_tris=700, mat='Knit')
    pom.C = np.tile(cream, (len(pom.V), 1)) * (1 + 0.05 * vnoise(pom.V * 200, seed=2))[:, None]
    m.add(pom)
    return m


# =============================================================================================
# Bubble helmet (space Jimothy)
# =============================================================================================

def bubble_helmet():
    m = Mesh()
    # collar plane: lower at the front (under the chin), higher at the back
    n = normalize(np.array([0.0, 1.0, 0.36]))
    p_plane = np.array([0.0, -0.055, 0.0])
    cg = np.array([0.0, 0.07, 0.05])
    Rg = 0.47
    dist = np.dot(cg - p_plane, n)
    rclip = math.sqrt(Rg * Rg - dist * dist)
    Mp = frame(p_plane + n * np.dot(cg - p_plane, n) * 0 , n, (0, 0, 1))
    # glass dome: sphere cap above the plane
    ring_centre = cg - n * dist
    Mr = frame(ring_centre, n, (0, 0, 1))
    n_ph, n_th = 48, 22
    th0 = math.acos(-dist / Rg)          # angle from +n axis where the sphere meets the plane
    rings = []
    for k in range(n_th + 1):
        th = th0 * (1 - k / n_th)
        ring = []
        for i in range(n_ph):
            ph = -2 * math.pi * i / n_ph
            dl = np.array([math.sin(th) * math.cos(ph), math.cos(th), math.sin(th) * math.sin(ph)])
            ring.append(cg + xform(frame(np.zeros(3), n, (0, 0, 1)), dl[None])[0] * Rg)
        rings.append(np.array(ring))
    rings = rings[::-1]    # from top to bottom
    top = cg + n * Rg
    dome = loft(rings[1:], top, None, mat='Glass')
    fix_winding_dome = dome.normals()
    # outward = away from cg
    if np.mean(np.sum(fix_winding_dome * (dome.V - cg), axis=1)) < 0:
        dome.flip()
    m.add(solid_color(dome, '#dff4ff'))
    # collar: a chunky ring (annulus with rounded profile) in the plane
    r_in = 0.335
    r_out = rclip + 0.018
    prof = []
    for k in range(10):
        a = math.pi * k / 9
        prof.append(((r_in + r_out) / 2 + (r_out - r_in) / 2 * math.cos(a) * -1, 0.022 * math.sin(a) - 0.004))
    prof = [(r_in, -0.012)] + prof + [(r_out, -0.012)]
    crings = []
    for (r, h) in prof:
        ring = []
        for i in range(n_ph):
            ph = -2 * math.pi * i / n_ph
            ring.append(xform(Mr, np.array([[r * math.cos(ph), h, r * math.sin(ph)]]))[0])
        crings.append(np.array(ring))
    # close underneath
    crings.append(crings[0])
    collar = loft(crings, None, None, mat='HelmetMetal')
    V = collar.V
    cen = collar.normals()
    if np.mean(np.sum(cen * (V - ring_centre - n * 0.0), axis=1)) < -1:  # heuristic (normals mostly radial/up)
        collar.flip()
    fix_winding(collar)
    m.add(solid_color(collar, '#d9dde3'))
    # little antenna nub on top of the collar at the back (cute detail)
    return m


# =============================================================================================
# Crown (gold, slightly too small)
# =============================================================================================

def crown():
    m = Mesh()
    axis = normalize(np.array([0.2, 1.0, 0.08]))     # jaunty tilt
    base_c = np.array([0.0, 0.337, 0.03])
    Mc = frame(base_c, axis, (0, 0, 1))
    n = 60
    r0, r1 = 0.074, 0.083
    h_band, h_spike = 0.036, 0.036
    th = 0.005

    def top_h(a):
        # 5 triangular spikes
        f = (a / (2 * math.pi) * 5) % 1.0
        tri = 1 - abs(f - 0.5) * 2
        return h_band + h_spike * tri ** 1.6

    outer_b, outer_t, inner_t, inner_b = [], [], [], []
    for i in range(n):
        a = -2 * math.pi * i / n
        ht = top_h(-a)
        ca, sa = math.cos(a), math.sin(a)
        rt = r0 + (r1 - r0) * (ht / (h_band + h_spike))
        outer_b.append((r0 * ca, 0.0, r0 * sa))
        outer_t.append((rt * ca, ht, rt * sa))
        inner_t.append(((rt - th) * ca, ht, (rt - th) * sa))
        inner_b.append(((r0 - th) * ca, 0.0, (r0 - th) * sa))
    rings = [np.array(outer_b), np.array(outer_b) * [1, 0, 1] + [0, h_band * 0.5, 0], np.array(outer_t),
             np.array(inner_t), np.array(inner_b), np.array(outer_b)]
    # middle ring of the band slightly bulged for a rounded look
    rings[1] = np.array([(x * 1.03, y, z * 1.03) for (x, y, z) in rings[1]])
    band = loft(rings, None, None, mat='Gold')
    band.transform(Mc)
    fix_winding(band)
    m.add(solid_color(band, '#e8b23a'))
    # balls on the spike tips + gems around the band
    for k in range(5):
        a = -2 * math.pi * (k + 0.5) / 5
        ht = top_h(-a)
        rt = r1 + 0.001
        tip = xform(Mc, np.array([[rt * math.cos(a), ht + 0.008, rt * math.sin(a)]]))[0]
        ball = ellipsoid_mesh(tip, (0.0095, 0.0095, 0.0095), 10, 7, mat='Gold')
        m.add(solid_color(ball, '#f3c64a'))
        ag = -2 * math.pi * k / 5
        gp = xform(Mc, np.array([[(r0 + 0.004) * math.cos(ag), h_band * 0.45, (r0 + 0.004) * math.sin(ag)]]))[0]
        gdir = normalize(gp - xform(Mc, np.array([[0, h_band * 0.45, 0]]))[0])
        gem = ellipsoid_mesh(np.zeros(3), (0.0075, 0.0095, 0.004), 10, 6, mat='GemRed' if k % 2 == 0 else 'GemBlue')
        gem.transform(frame_z(gp, gdir, axis))
        m.add(solid_color(gem, '#d0213a' if k % 2 == 0 else '#2750d8'))
    return m


# =============================================================================================
# driver
# =============================================================================================

ACCESSORIES = [('GradCap', grad_cap), ('Sunglasses', sunglasses), ('BaseballCap', baseball_cap),
               ('Beanie', beanie), ('BubbleHelmet', bubble_helmet), ('Crown', crown)]


def accessory_materials():
    mk = rlib.make_material
    return {
        'CapBlack': mk('CapBlack', '#ffffff', rough=0.8, vcol=True),
        'Tassel': mk('Tassel', '#ffffff', rough=0.55, vcol=True),
        'Frame': mk('Frame', '#141416', rough=0.25),
        'Lens': mk('Lens', '#1b2533', rough=0.04, metallic=0.4),
        'CapFabric': mk('CapFabric', '#ffffff', rough=0.85, vcol=True),
        'Knit': mk('Knit', '#ffffff', rough=0.95, vcol=True),
        'Glass': mk('Glass', '#eef8ff', rough=0.02, alpha=0.13),
        'HelmetMetal': mk('HelmetMetal', '#d9dde3', rough=0.3, metallic=0.9),
        'Gold': mk('Gold', '#e8b23a', rough=0.28, metallic=1.0),
        'GemRed': mk('GemRed', '#d0213a', rough=0.08),
        'GemBlue': mk('GemBlue', '#2750d8', rough=0.08),
    }


# materials that should carry vertex colours in the export; others get their colour from the material
VCOL_MATS = {'CapBlack', 'Tassel', 'CapFabric', 'Knit'}


def build(render=True):
    rlib.reset_scene()
    model = Model('_accessories')
    for name, fn in ACCESSORIES:
        mesh = fn()
        # express in HEAD space
        mesh.V = mesh.V - HEAD_PIVOT
        # vertex colours only where the material uses them
        mats_used = set(mesh.FM)
        if not mats_used & VCOL_MATS:
            mesh.C = None
        part = model.add(name, '_accessories', np.eye(4))
        part.add_mesh(mesh)
        print('  %-12s tris=%d mats=%s' % (name, mesh.tri_count(), sorted(mats_used)))
    mats = accessory_materials()
    objs = rlib.realize(model, mats)
    # the helper root is not wanted: export accessories as independent root-level objects
    root = objs['_accessories']
    import bpy
    for name, _ in ACCESSORIES:
        o = objs[name]
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    bpy.data.objects.remove(root)
    path = os.path.join(MODELS_DIR, 'accessories.glb')
    bpy.ops.object.select_all(action='DESELECT')
    for name, _ in ACCESSORIES:
        objs[name].select_set(True)
    bpy.context.view_layer.objects.active = objs[ACCESSORIES[0][0]]
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_normals=True, export_texcoords=True,
                              export_materials='EXPORT', export_vertex_color='MATERIAL',
                              export_all_vertex_colors=False, export_animations=False, export_extras=False)
    print('EXPORTED', path, os.path.getsize(path), 'bytes')
    if render:
        render_on_jimothy()


def render_on_jimothy():
    """Fresh scene: import jimothy_ball.glb + accessories.glb, parent each accessory to Head (identity)."""
    import bpy
    rlib.reset_scene()
    bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS_DIR, 'jimothy_ball.glb'))
    jim = {o.name: o for o in bpy.context.scene.objects}
    bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS_DIR, 'accessories.glb'))
    acc = {o.name: o for o in bpy.context.scene.objects if o.name not in jim}
    head = jim['Head']
    for name, o in acc.items():
        o.parent = head
        o.matrix_parent_inverse.identity()
        o.matrix_basis.identity()
    bpy.context.view_layer.update()
    rlib.setup_preview_scene(floor_z=-0.42)
    jim_meshes = [o for o in jim.values() if o.type == 'MESH']
    tiles = []
    for view in ('three_quarter', 'front'):
        for name, _ in ACCESSORIES:
            for n2, o in acc.items():
                o.hide_render = (n2 != name)
            out = os.path.join(RENDER_DIR, '_tiles', 'acc_%s_%s.png' % (name, view))
            rlib.render_views(jim_meshes + [acc[name]], out, views=(view,), size=420, cols=1,
                              focus=np.array([0.0, -0.05, 0.12]), radius=0.62, elevation=14)
            tiles.append(out)
    stitch(tiles, os.path.join(RENDER_DIR, 'accessories_on_jimothy.png'), cols=6)


def stitch(files, out_path, cols):
    import bpy
    imgs = [bpy.data.images.load(f) for f in files]
    w, h = imgs[0].size
    rows = int(math.ceil(len(imgs) / cols))
    canvas = np.ones((rows * h, cols * w, 4), dtype=np.float32)
    for i, img in enumerate(imgs):
        px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
        r, c = divmod(i, cols)
        y0 = (rows - 1 - r) * h
        canvas[y0:y0 + h, c * w:(c + 1) * w] = px
    out = bpy.data.images.new('stitch2', cols * w, rows * h, alpha=True)
    out.pixels.foreach_set(canvas.ravel())
    out.filepath_raw = out_path
    out.file_format = 'PNG'
    out.save()
    print('RENDERED', out_path)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    build(render='--no-render' not in argv)
