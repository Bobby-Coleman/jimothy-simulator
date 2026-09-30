"""
build_kit_jimothy.py - one of Mom's lost kits takes after Jimothy: `kit_jimothy.glb`.

The same baby raccoon as `kit.glb` (build_raccoons.py `kit_cfg`), re-proportioned like the real Jimothy: a short,
arched spine (a round dome of a back), next to no neck with the head carried low at the front of the dome and the
nose tipped down, longer legs, and a tiny tail puff instead of the long ringed tail.

Usage (from the project root):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup \
      -P tools/blender/build_kit_jimothy.py -- [--no-render]
"""
import math
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402

import build_raccoons as br  # noqa: E402
import rlib  # noqa: E402

D = math.radians


def pitch_about(p, pivot, a):
    """Pitch a point about `pivot` (around +X): positive a tips things in front of the pivot down."""
    p = np.asarray(p, dtype=float)
    d = p - pivot
    c, s = math.cos(a), math.sin(a)
    return pivot + np.array([d[0], d[1] * c - d[2] * s, d[1] * s + d[2] * c])


def kit_jimothy_cfg():
    cfg = br.kit_cfg()
    cfg.seed = 13
    # the body: one round dome (short, arched spine), carried higher on longer legs
    cfg.body_parts = [
        ((0.0, 0.113, -0.03), (0.052, 0.065, 0.058), 0.03),    # the dome of his back
        ((0.0, 0.099, 0.008), (0.044, 0.05, 0.036), 0.03),     # chest, under the head
        ((0.03, 0.096, -0.058), (0.024, 0.038, 0.03), 0.02),   # haunches
    ]
    cfg.body_tris = 1300
    # the head: lower and a little forward (no neck), nose tipped down
    shift = np.array([0.0, -0.011, 0.004])
    pivot = np.array([0.0, 0.086, 0.02]) + shift
    tip = D(16)
    for k in ('cran_c', 'cheek_c', 'brow_c', 'muz_c', 'tip_c', 'chin_c'):
        setattr(cfg, k, pitch_about(getattr(cfg, k) + shift, pivot, tip))
    cfg.muz_pitch = cfg.muz_pitch + tip
    # eyes are found by a ray along -Z at (x, y): move y with the face
    ey = pitch_about(np.array([0.0, cfg.eye_xy[1], 0.1]) + shift, pivot, tip)[1]
    cfg.eye_xy = np.array([cfg.eye_xy[0], ey])
    cfg.face_tilt = cfg.face_tilt + 0.25
    cfg.ear_base = pitch_about(cfg.ear_base + shift, pivot, tip)
    cfg.ear_up = np.array([0.55, 1.0, 0.1])
    cfg.head_pivot = pivot
    # a short, thick neck that disappears into the dome
    cfg.neck = ((0.0, 0.098, 0.012), tuple(pitch_about(np.array([0.0, 0.1, 0.042]) + shift, pivot, tip)), 0.036)
    # longer legs
    cfg.legs['LegF'].update(joint=(0.03, 0.084, 0.012), knee=(0.031, 0.047, 0.02), end=(0.032, 0.011, 0.028))
    cfg.legs['LegB'].update(joint=(0.034, 0.088, -0.06), knee=(0.036, 0.05, -0.054), end=(0.037, 0.011, -0.066))
    cfg.sock_top, cfg.sock_bot = 0.045, 0.012
    # a tiny tail puff, up and back
    cfg.tail_base = np.array([0.0, 0.122, -0.084])
    cfg.tail_len = 0.034
    cfg.tail_pitch0 = D(40)
    cfg.tail_pitch1 = D(75)
    cfg.tail_yaw = D(10)
    cfg.tail_rings = 1
    cfg.tail_radius_scale = 0.3
    # his puff is grey-brown with a faint ring, not black-tipped
    cfg.pal = dict(cfg.pal, tail_tip='#8c8276', tail_dark='#9a9084', tail_light='#b3a899')
    return cfg


def build(render=True):
    rlib.reset_scene()
    cfg = kit_jimothy_cfg()
    model = br.quad_raccoon(cfg)
    mats = br.raccoon_materials()
    br.finish(model, mats, 'kit_jimothy', render, floor_y=0.0, closeup=((0, 0.1, 0.09), 0.09))
    return model


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    build(render='--no-render' not in argv)
