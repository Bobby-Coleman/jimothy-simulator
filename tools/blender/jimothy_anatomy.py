"""
Jimothy's anatomy: the approved body sculpt (numpy SDFs), skeleton, face markings and colours.

Fitted to the real Jimothy (a raccoon with a short, arched "scrunched" spine, a head that points down, a very short
puff of a tail and long normal raccoon legs): the side profile to a side-on photo (pixel-aligned orthographic camera,
0.72 m per 530 px), the mask to eye-normalised frames of video footage. The reference media stay local and are not
part of the repo; only the measured numbers live here.

Everything is the PHYSICAL body (no fur volume): the game adds shell fur, whose per-vertex length is `fur_length`.
Game space: +Y up, +Z forward, +X = his LEFT, metres, ground at y = 0.
Used by build_jimothy.py (no bpy in here).
"""
import math
import numpy as np

import rlib
from rlib import sd_capsule, sd_ellipsoid, sd_sphere, sd_round_cone, smin, smax, smoothstep, mix, hexc

S = 0.72 / 530.0                        # metres per photo pixel


def ph(px, py):
    """Photo pixel -> (z, y) in game space."""
    return np.array([(px - 495.0) * S, (620.0 - py) * S])


def P3(x, zy):
    return np.array([x, zy[1], zy[0]])


def nrm(v):
    return v / np.linalg.norm(v)


def catmull(points, n):
    P = np.asarray(points, dtype=float)
    P = np.vstack([P[0] * 2 - P[1], P, P[-1] * 2 - P[-2]])
    out = []
    segs = len(P) - 3
    for i in range(n):
        t = i / (n - 1) * segs
        k = min(int(t), segs - 1)
        u = t - k
        p0, p1, p2, p3 = P[k], P[k + 1], P[k + 2], P[k + 3]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    return np.array(out)


def fbm3(P, freq, seed):
    return rlib.fbm(P * freq, 3, seed=seed)


# ============================================================================================ skeleton
# The spine as drawn over the side photo: short, arching up from the sacrum and down into the (almost absent) neck.
SPINE = catmull([P3(0, p) for p in (ph(320, 275), ph(420, 185), ph(521, 141), ph(620, 150), ph(708, 189))], 40)
SACRUM = SPINE[0]
OCC = P3(0, ph(708, 189))
NOSE0 = P3(0, ph(806, 340))

# Cute pass: the whole head (skull, face, ears, eyes, markings) is the traced head above, scaled up by HEAD_S about the
# back of the skull and nudged forward / up by HEAD_T: a bigger, rounder head that sits in front of the dome instead
# of hanging under it. hx maps the traced head's space into the model, hinv back.
HEAD_C0 = np.array([0.0, 0.53, 0.262])
HEAD_S = 1.28
HEAD_T = np.array([0.0, 0.03, 0.02])
HEAD_PITCH = math.radians(12.0)          # ... and tipped up a little, so he looks ahead rather than at his paws
_HC, _HSN = math.cos(HEAD_PITCH), math.sin(HEAD_PITCH)
HEAD_R = np.array([[1.0, 0.0, 0.0], [0.0, _HC, _HSN], [0.0, -_HSN, _HC]])     # rows: model x, y, z of a traced vector


def hx(p):
    q = np.asarray(p, dtype=float) - HEAD_C0
    return HEAD_C0 + HEAD_T + HEAD_S * (q @ HEAD_R.T)


def hinv(P):
    q = (np.asarray(P, dtype=float) - HEAD_C0 - HEAD_T) / HEAD_S
    return HEAD_C0 + q @ HEAD_R


NOSE = hx(NOSE0)
HEAD_D = nrm(NOSE0 - OCC)
HEAD_U = np.array([0.0, HEAD_D[2], -HEAD_D[1]])
HIP = np.array([0.096, *ph(395, 300)[::-1]])
SHO = np.array([0.09, *ph(655, 305)[::-1]])
SCAP_TOP = P3(0.06, ph(612, 165))
FEMUR, TIBIA, TARSUS, TOES = 0.225, 0.187, 0.105, 0.055
HUMERUS, RADIUS, HAND = 0.182, 0.192, 0.08


def ik2(root_zy, target_zy, l1, l2, bend):
    d = target_zy - root_zy
    L = np.clip(np.linalg.norm(d), abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4)
    dh = d / np.linalg.norm(d)
    a = math.acos(np.clip((l1 * l1 + L * L - l2 * l2) / (2 * l1 * L), -1, 1))
    c, s = math.cos(bend * a), math.sin(bend * a)
    v = np.array([dh[0] * c - dh[1] * s, dh[0] * s + dh[1] * c])
    return root_zy + l1 * v, root_zy + dh * L


POSES = {
    # side +1 = his LEFT, -1 = his RIGHT. Hind: (ankle, toe tip); front: (wrist, fingertip), as (z, y)
    'photo2': {('H', -1): (ph(345, 565), ph(300, 625)), ('H', +1): (ph(455, 500), ph(570, 505)),
               ('F', -1): (ph(640, 570), ph(690, 615)), ('F', +1): (ph(705, 440), ph(712, 487))},
    # standing bind pose: toe / finger tips sit on the ground (their cones' radii above y = 0)
    'stand': {('H', -1): (np.array([-0.175, 0.086]), np.array([-0.03, 0.018])), ('H', +1): (np.array([-0.175, 0.086]), np.array([-0.03, 0.018])),
              ('F', +1): (np.array([0.215, 0.068]), np.array([0.29, 0.02])), ('F', -1): (np.array([0.215, 0.068]), np.array([0.29, 0.02]))},
}


def limb_joints(pose):
    """Named joint positions of the four legs: {'H', side} -> [hip, knee, ankle, ball, toe tip],
    {'F', side} -> [scapula top, shoulder, elbow, wrist, fingertip]."""
    out = {}
    for side in (+1, -1):
        at, tt = POSES[pose][('H', side)]
        hip_zy = np.array([HIP[2], HIP[1]])
        knee, ank = ik2(hip_zy, at, FEMUR, TIBIA, +1)
        fdir = nrm(tt - ank)
        ball, tip = ank + fdir * TARSUS, ank + fdir * (TARSUS + TOES)
        x0, x1 = HIP[0] * side, (HIP[0] - 0.012) * side
        out[('H', side)] = [P3(x0, hip_zy), P3((x0 + x1) / 2, knee), P3(x1, ank), P3(x1, ball), P3(x1, tip)]
        at, tt = POSES[pose][('F', side)]
        sho_zy = np.array([SHO[2], SHO[1]])
        elb, wr = ik2(sho_zy, at, HUMERUS, RADIUS, -1)
        tipf = wr + nrm(tt - wr) * HAND
        x0, x1 = SHO[0] * side, (SHO[0] - 0.014) * side
        out[('F', side)] = [np.array([SCAP_TOP[0] * side, SCAP_TOP[1], SCAP_TOP[2]]), P3(x0, sho_zy), P3((x0 + x1) / 2, elb),
                            P3(x1, wr), P3(x1, tipf)]
    return out


def limb_cones(pose):
    """Per limb: (key, cones) with cones = [(a, b, r_a, r_b)], the hind legs including the hamstrings (the back of the
    thigh IS the rump: nothing sits behind the legs but fur)."""
    J = limb_joints(pose)
    out = []
    for side in (+1, -1):
        j = J[('H', side)]
        cones = [(j[0], j[1], 0.095, 0.052), (j[1], j[2], 0.045, 0.029), (j[2], j[3], 0.028, 0.025), (j[3], j[4], 0.025, 0.019)]
        hip_zy, knee = np.array([j[0][2], j[0][1]]), np.array([j[1][2], j[1][1]])
        f = knee - hip_zy
        back = nrm(np.array([f[1], -f[0]]))
        if back[0] > 0:
            back = -back
        a = hip_zy + back * 0.045 + nrm(f) * 0.01
        b = knee + back * 0.028
        cones.append((P3(j[0][0] * 0.95, a), P3(j[0][0], b), 0.078, 0.042))
        out.append((('H', side), cones))
        j = J[('F', side)]
        out.append((('F', side), [(j[1], j[2], 0.072, 0.047), (j[2], j[3], 0.039, 0.027), (j[3], j[4], 0.026, 0.021)]))
    return out


# ============================================================================================ head (rest pose)
EYE_Y = 0.471                 # eye height
E = 0.04                      # half the inter-eye distance (IED = 0.08 m at game scale)
EYE_R0 = 0.0138               # eyeball radius in the traced head (oversized: cute game; the original was 0.011)
EYE_R = EYE_R0 * HEAD_S        # ... in the model
# Ears: fitted to the side photo (tip at z .342, y .647; visible centre z .317, y .615) and the front footage (tilted
# ~25 degrees outward, opening forward-outward). They sit on the top corners of the skull (see head_skin_sdf's
# temporal fills and ear roots), a touch oversized for the cute game.
EAR_BASES0 = [np.array([0.08 * s, 0.568, 0.322]) for s in (1, -1)]
EAR_DIRS = [nrm(np.array([0.46 * s, 1.0, 0.14])) for s in (1, -1)]
EAR_C = 0.043                                 # ear centre, along its axis from the base
EAR_R = (0.036, 0.044, 0.012)                 # half-width, half-height, half-thickness (rounder: cute)
EAR_BASES = [hx(b) for b in EAR_BASES0]       # in the model


def sd_rc_sx(P, a, b, r1, r2, sx):
    """Round cone squashed sideways by sx (midline axis)."""
    Q = P.copy()
    Q[:, 0] = P[:, 0] / sx
    return sd_round_cone(Q, a, b, r1, r2) * sx


def _head_skin_sdf0(P):
    d = sd_ellipsoid(P, np.array([0.0, 0.515, 0.306]), (0.075, 0.06, 0.066))                       # cranium
    for sx in (1, -1):                                                         # temporal muscle under the ears
        d = smin(d, sd_ellipsoid(P, np.array([0.056 * sx, 0.545, 0.313]), (0.036, 0.03, 0.042)), 0.025)
    for i in range(2):                                                         # ear roots: the ears grow out of the head
        base, up, fwd, across = ear_frame(i)
        side = np.array([np.sign(base[0]), 0.0, 0.0])
        R = np.stack([across, up, fwd], axis=1)
        d = smin(d, sd_ellipsoid(P, base - up * 0.004 - side * 0.01, (0.026, 0.022, 0.02), R), 0.018)
    d = smin(d, sd_ellipsoid(P, np.array([0.0, 0.466, 0.352]), (0.044, 0.042, 0.034)), 0.025)      # brow + bridge
    d = smin(d, sd_ellipsoid(P, np.array([0.0, 0.446, 0.336]), (0.056, 0.034, 0.032)), 0.03)       # face under the eyes
    for sx in (1, -1):                                                                             # cheeks
        d = smin(d, sd_ellipsoid(P, np.array([0.05 * sx, 0.44, 0.3]), (0.032, 0.042, 0.042)), 0.035)
    d = smin(d, sd_rc_sx(P, np.array([0.0, 0.442, 0.356]), np.array([0.0, 0.392, 0.398]), 0.03, 0.016, 0.85), 0.02)  # muzzle
    for sx in (1, -1):                                                                             # mandible
        d = smin(d, sd_round_cone(P, np.array([0.036 * sx, 0.405, 0.305]), np.array([0.007 * sx, 0.379, 0.389]), 0.016, 0.01), 0.02)
    d = smin(d, sd_ellipsoid(P, np.array([0.0, 0.392, 0.362]), (0.024, 0.02, 0.03)), 0.02)       # floor of the mouth
    d = smin(d, sd_capsule(P, np.array([0.0, 0.405, 0.33]), np.array([0.0, 0.43, 0.245]), 0.034), 0.045)  # throat
    d = smin(d, sd_ellipsoid(P, np.array([0.0, 0.395, 0.262]), (0.045, 0.034, 0.04)), 0.04)            # throat -> chest
    for sx in (1, -1):
        d = smin(d, sd_ellipsoid(P, np.array([0.015 * sx, 0.399, 0.392]), (0.011, 0.013, 0.011)), 0.016)  # whisker pads
    return d


def head_skin_sdf(P):
    return HEAD_S * _head_skin_sdf0(hinv(P))


def ear_frame(i):
    """(base, up, fwd, across) of ear i (0 = left, 1 = right) in the traced head's space; the opening faces
    forward-outward."""
    base, up = EAR_BASES0[i], EAR_DIRS[i]
    side = np.array([1.0, 0, 0]) if base[0] > 0 else np.array([-1.0, 0, 0])
    fwd0 = nrm(np.cross(side, up)) * (1 if base[0] > 0 else -1)
    fwd = nrm(fwd0 + side * 0.95)
    return base, up, fwd, nrm(np.cross(up, fwd))


def ears_sdf(P):
    return HEAD_S * _ears_sdf0(hinv(P))


def _ears_sdf0(P):
    d = None
    for i in range(2):
        base, up, fwd, across = ear_frame(i)
        R = np.stack([across, up, fwd], axis=1)
        di = sd_ellipsoid(P, base + up * EAR_C, EAR_R, R)
        d = di if d is None else np.minimum(d, di)
    return d


# ============================================================================================ body
# Cute pass: a proper bushy raccoon tail (ringed, see paint) instead of the cottontail puff: out behind the rump,
# drooping a little. TAIL_D is its axis, PUFF_C the middle of the bush.
TAIL_D = nrm(np.array([0.0, -0.5, -1.0]))
TAIL_TIP = SACRUM + TAIL_D * 0.07 + np.array([0.0, 0.01, 0.0])
PUFF_C = SACRUM + TAIL_D * 0.115 + np.array([0.0, 0.012, 0.0])
_TAIL_R = np.stack([np.array([1.0, 0, 0]), nrm(np.cross(TAIL_D, np.array([1.0, 0, 0]))), TAIL_D], axis=1)


# The top of the back (the approved side profile): the drawn spine line, raised 1.6 cm at the sacrum to 3.6 cm over
# the ribs. As a function of z (the spine runs monotonically forward).
_SPT = np.linspace(0.0, 1.0, len(SPINE))
_SPZ = SPINE[:, 2]
_TOP = SPINE[:, 1] + 0.016 + 0.02 * smoothstep(0.1, 0.4, _SPT) - 0.025 * smoothstep(0.62, 0.95, _SPT)   # (cute pass: lower withers)

# The back is one dome swept along the spine, from the sacrum to the withers: at every z an egg-shaped cross-section
# (rounded top on the dorsal line, widest low down where it meets the ribs and belly), so the back is round from
# behind with no ridge along the spine. The half-width and widest level vary along z:
BACK_Z = (-0.232, 0.214)
BACK_W = ([-0.24, -0.2, -0.12, -0.04, 0.04, 0.12, 0.17, 0.214], [0.095, 0.124, 0.145, 0.155, 0.158, 0.15, 0.132, 0.1])
BACK_MID = ([-0.24, -0.12, 0.0, 0.12, 0.214], [0.445, 0.46, 0.47, 0.47, 0.5])


def back_sdf(P):
    z = np.clip(P[:, 2], BACK_Z[0], BACK_Z[1])
    top = np.interp(z, _SPZ, _TOP)
    mid = np.interp(z, *BACK_MID)
    w = np.interp(z, *BACK_W)
    up = P[:, 1] >= mid
    ry = np.where(up, np.maximum(top - mid, 0.03), np.maximum(mid - 0.31, 0.02))   # (cute pass: a deeper, rounder body)
    qx, qy = P[:, 0], P[:, 1] - mid
    k0 = np.hypot(qx / w, qy / ry)
    k1 = np.hypot(qx / (w * w), qy / (ry * ry))
    d = k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)
    ends = np.maximum(BACK_Z[0] - P[:, 2], P[:, 2] - BACK_Z[1])
    return smax(d, ends, 0.03)


# The (almost absent) neck: from the withers down into the back of the skull, so the skull is the top of his head
# (between the ears there is only fur, no body).
NECK_A = np.array([0.0, float(np.interp(0.17, _SPZ, _TOP)) - 0.078, 0.17])
NECK_B = hx(np.array([0.0, 0.522, 0.262]))


def torso_sdf(P):
    d = back_sdf(P)
    # (cute pass: rib cage and belly fuller and lower, so the round body hangs low between the legs like the photos)
    d = smin(d, sd_ellipsoid(P, P3(0, ph(545, 262)) - np.array([0, 0.025, 0]), (0.168, 0.148, 0.18)), 0.05)  # rib cage
    d = smin(d, sd_ellipsoid(P, P3(0, ph(432, 258)) - np.array([0, 0.025, 0]), (0.152, 0.14, 0.14)), 0.05)  # abdomen
    d = smin(d, sd_ellipsoid(P, np.array([0.0, 0.45, -0.185]), (0.1, 0.075, 0.05)), 0.04)  # pelvis: between the thighs only
    d = smin(d, sd_ellipsoid(P, P3(0, ph(640, 262)) - np.array([0, 0.015, 0]), (0.115, 0.128, 0.09)), 0.05)  # chest
    for sx in (1, -1):
        d = smin(d, sd_ellipsoid(P, np.array([0.092 * sx, *P3(0, ph(640, 250))[1:]]), (0.062, 0.1, 0.075)), 0.04)  # shoulders
    # neck: wider than tall (it spans the shoulders), so there's no dip between it and the shoulders
    Q = P.copy()
    Q[:, 0] = P[:, 0] / 1.45
    d = smin(d, sd_round_cone(Q, NECK_A, NECK_B, 0.078, 0.046), 0.04)
    return d


def tail_skin_sdf(P):
    return sd_round_cone(P, SACRUM, TAIL_TIP, 0.036, 0.026)


def puff_sdf(P):
    """The bushy tail: a fat, slightly lumpy sausage of fur, fullest in the middle, rounded at the tip."""
    d = sd_ellipsoid(P, PUFF_C, (0.054, 0.058, 0.105), _TAIL_R)
    d = smin(d, sd_ellipsoid(P, PUFF_C + TAIL_D * 0.065, (0.044, 0.046, 0.055), _TAIL_R), 0.03)
    return d - 0.006 * fbm3(P, 30.0, 17)


def limb_sdf(cones):
    def f(P):
        d = None
        for a, b, r1, r2 in cones:
            di = sd_round_cone(P, a, b, r1, r2)
            d = di if d is None else smin(d, di, 0.02)
        return d
    return f


def region_sdfs(pose):
    """The separate components (for skin weights / fur regions): name -> sdf."""
    out = {'torso': torso_sdf, 'head': head_skin_sdf, 'tail': lambda P: np.minimum(tail_skin_sdf(P), puff_sdf(P)),
           'ears': ears_sdf}
    for key, cones in limb_cones(pose):
        out[key] = limb_sdf(cones)
    return out


def body_sdf(pose, eyes):
    """The exported surface: the whole physical body, with eye sockets."""
    limbs = [limb_sdf(c) for _, c in limb_cones(pose)]

    def f(P):
        d = smin(torso_sdf(P), head_skin_sdf(P), 0.03)
        d = smin(d, tail_skin_sdf(P), 0.03)
        d = smin(d, puff_sdf(P), 0.025)
        d = np.minimum(d, ears_sdf(P))
        lg = None
        for l in limbs:
            dl = l(P)
            lg = dl if lg is None else smin(lg, dl, 0.02)
        d = smin(d, lg, 0.025)
        for e in eyes:
            d = smax(d, -sd_sphere(P, e, EYE_R + 0.0013), 0.003)
        return d
    return f


def find_eyes():
    """Eye centres in the model (found on the traced head, then moved with it)."""
    return [hx(e) for e in _find_eyes0()]


def _find_eyes0():
    eyes = []
    for sx in (1, -1):
        o = np.array([E * sx, EYE_Y, 0.6])
        p, n = rlib.sdf_raycast(_head_skin_sdf0, o, (0, 0, -1), 0, 0.5, 900)
        eyes.append(p - n * EYE_R0 * 0.4)
    return eyes


# ============================================================================================ face markings
# Traced on eye-normalised video frames: u = lateral (eye units, eyes at u = +-1), v = up the face.
# Right halves (u >= 0) mirrored for the left.
MASK_R = [(0.0, 0.3), (0.18, 0.27), (0.5, 0.25), (0.72, 0.34), (0.95, 0.44), (1.25, 0.45), (1.55, 0.37), (1.9, 0.26),
          (2.25, 0.12), (2.6, -0.06), (2.82, -0.3), (2.85, -0.5), (2.7, -0.72), (2.4, -0.86), (2.0, -0.93), (1.6, -0.97),
          (1.25, -1.01), (0.95, -1.03), (0.62, -1.02), (0.4, -1.08), (0.34, -1.3), (0.28, -1.5), (0.0, -1.55)]
BROW_R = [(0.17, 0.3), (0.15, 0.62), (0.2, 0.95), (0.36, 1.08), (0.6, 1.08), (0.78, 0.96), (1.05, 0.84), (1.4, 0.76),
          (1.8, 0.64), (2.15, 0.46), (2.35, 0.28), (2.25, 0.16), (1.95, 0.27), (1.6, 0.38), (1.25, 0.48), (0.95, 0.47),
          (0.72, 0.37), (0.5, 0.28), (0.3, 0.27)]
UPLIP_R = [(0.0, -1.88), (0.28, -1.95), (0.42, -2.12), (0.34, -2.3), (0.0, -2.34)]
STRIPE_R = [(0.0, 0.28), (0.16, 0.28), (0.19, 0.7), (0.24, 1.05), (0.32, 1.45), (0.36, 1.8), (0.0, 1.8)]
PAD_R = [(0.66 + 0.34 * math.cos(a), -1.36 + 0.34 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 20, endpoint=False)]
LIP_R = [(0.0, -2.26), (0.22, -2.24), (0.42, -2.14), (0.46, -2.2), (0.24, -2.31), (0.0, -2.33)]
# side-on tracing, relative to the eye on that side: s forward, t up (eye units)
MASK_SIDE = [(1.1, 0.2), (0.8, 0.72), (0.2, 0.8), (-0.4, 0.75), (-0.9, 0.55), (-1.35, 0.35), (-1.75, 0.02), (-2.1, -0.35),
             (-2.15, -0.5), (-1.9, -0.8), (-1.4, -1.05), (-0.8, -1.4), (-0.1, -1.5), (0.5, -1.3), (0.9, -0.95), (1.1, -0.5)]
BROW_SIDE = [(0.85, 0.76), (0.2, 0.84), (-0.45, 0.8), (-0.95, 0.6), (-1.4, 0.4), (-1.8, 0.04), (-2.05, -0.4), (-1.85, 0.25),
             (-1.4, 0.72), (-0.85, 1.02), (-0.3, 1.2), (0.35, 1.3), (0.85, 1.12)]
PAD_SIDE = [(1.05, -1.0), (0.55, -1.38), (0.1, -1.55), (0.0, -1.85), (0.45, -2.05), (1.0, -2.05), (1.3, -1.7)]
FACE_TILT = math.radians(15.0)          # the face looks 15 deg below horizontal in the rest pose
FACE_N = np.array([0.0, -math.sin(FACE_TILT), math.cos(FACE_TILT)])
FACE_UP = np.array([0.0, math.cos(FACE_TILT), math.sin(FACE_TILT)])


def mirror_poly(right):
    left = [(-u, v) for (u, v) in reversed(right) if u > 1e-9]
    return right + left


def poly_sd(U, Vv, poly):
    """Signed distance (eye units) from points to a closed polygon: negative inside."""
    P = np.asarray(poly, dtype=float)
    B = np.roll(P, -1, axis=0)
    dmin = np.full(len(U), np.inf)
    inside = np.zeros(len(U), dtype=bool)
    for (ax, ay), (bx, by) in zip(P, B):
        ex, ey = bx - ax, by - ay
        wx, wy = U - ax, Vv - ay
        t = np.clip((wx * ex + wy * ey) / (ex * ex + ey * ey + 1e-12), 0, 1)
        dmin = np.minimum(dmin, np.hypot(wx - ex * t, wy - ey * t))
        cond = ((ay > Vv) != (by > Vv)) & (U < (bx - ax) * (Vv - ay) / (by - ay + 1e-12) + ax)
        inside ^= cond
    return np.where(inside, -dmin, dmin)


def poly_w(U, Vv, poly, feather=0.05):
    return 1.0 - smoothstep(-feather, feather, poly_sd(U, Vv, poly))


class FaceCoords:
    """Face-plane and side coordinates of points (see the tracings)."""

    def __init__(self, V, eyes, N):
        x, y, z = V[:, 0], V[:, 1], V[:, 2]
        self.M = (eyes[0] + eyes[1]) * 0.5
        Q = V - self.M
        self.u = x / E
        self.v = (Q @ FACE_UP) / E
        self.w = Q @ FACE_N                                             # depth behind the eye plane (m)
        self.front = smoothstep(-0.075, -0.045, self.w)                 # markings only on the front of the head
        self.au = np.abs(self.u)
        side = np.where(x >= 0, 0, 1)
        Es = np.array(eyes)[side]
        self.s = (z - Es[:, 2]) / E
        self.t = (y - Es[:, 1]) / E
        self.nx = np.abs(N[:, 0])
        phi = np.degrees(np.arctan2(np.abs(x), z - 0.305))              # angle round the head (0 = straight ahead)
        self.ws = smoothstep(50.0, 66.0, phi)                           # 0 = front tracing, 1 = side tracing
        self.near = smoothstep(-2.8, -2.3, self.s) * smoothstep(3.0, 2.0, np.abs(self.t))


# ============================================================================================ colours (sRGB)
def paint(V, eyes, N):
    x, y, z = V[:, 0], V[:, 1], V[:, 2]
    ax = np.abs(x)
    back, side, belly, chest = hexc('#55565b'), hexc('#727377'), hexc('#9b9893'), hexc('#bcb4a4')   # (cute pass: lighter)
    c = mix(side, back, smoothstep(0.5, 0.64, y)[:, None])
    c = mix(c, hexc('#47484d'), (smoothstep(0.58, 0.68, y) * smoothstep(0.08, 0.0, ax))[:, None])       # dark saddle
    c = mix(c, belly, (smoothstep(0.47, 0.37, y) * (0.75 + 0.25 * rlib.fbm(V * 25.0, 2, seed=9)))[:, None])      # belly
    c = mix(c, chest, (smoothstep(0.45, 0.36, y) * smoothstep(0.12, 0.2, z) * smoothstep(0.09, 0.03, ax))[:, None])
    c = c * (0.9 + 0.2 * rlib.fbm(V * 60.0, 3, seed=3))[:, None]                                           # grizzle
    # legs: grey upper, dark lower, near-black hands and feet
    c = mix(c, hexc('#3f3d3b'), smoothstep(0.2, 0.09, y)[:, None])
    c = mix(c, hexc('#1c1b1a'), smoothstep(0.075, 0.035, y)[:, None])
    # tail puff: grey-fawn, soft dark rings across it, dark tip
    tax = TAIL_D
    ts = (V - SACRUM) @ tax
    inp = smoothstep(0.01, -0.02, puff_sdf(V) - 0.02) * smoothstep(0.02, 0.05, ts)
    rings = smoothstep(0.35, 0.65, 0.5 + 0.5 * np.cos((ts - 0.02) / 0.05 * 2 * math.pi))
    tcol = mix(hexc('#8a8580'), hexc('#2a2725'), (0.85 * rings * smoothstep(0.03, 0.06, ts) + smoothstep(0.17, 0.21, ts))
               .clip(0, 1)[:, None])
    c = mix(c, tcol, inp[:, None])
    # dark stripe from behind each ear down the side of the neck toward the shoulder
    for s in (1, -1):
        dn = sd_capsule(V, hx(np.array([0.082 * s, 0.556, 0.272])), np.array([0.118 * s, 0.44, 0.215]), 0.022)
        c = mix(c, hexc('#26262a'), smoothstep(0.008, -0.004, dn)[:, None])
    # ---------------------------------------------------------------- face (traced markings; only near the head)
    Vh, eyes0 = hinv(V), [hinv(e) for e in eyes]                # the traced head's space
    inhead = smoothstep(0.03, 0.0, _head_skin_sdf0(Vh) - 0.035)
    hi = np.where(inhead > 1e-4)[0]
    if len(hi):
        c[hi] = mix(c[hi], face_paint(Vh[hi], eyes0, N[hi], c[hi]), inhead[hi, None])
    # ears: pale rims, grey inside, dark backs; a black patch on the head behind each ear
    near_ears = np.where(_ears_sdf0(Vh) < 0.08)[0]
    if len(near_ears):
        c[near_ears] = ear_paint(Vh[near_ears], c[near_ears])
    return np.clip(c, 0, 1)


def face_paint(V, eyes, N, c):
    fc = FaceCoords(V, eyes, N)
    u, v, front, au, ws, near = fc.u, fc.v, fc.front, fc.au, fc.ws, fc.near
    lower = smoothstep(-0.6, -0.95, v) * smoothstep(0.3, 0.45, au)
    face = mix(c, hexc('#a3a19c'), (lower * front * (1 - smoothstep(0.35, 0.7, fc.nx)))[:, None])
    face = mix(face, hexc('#6f6c69'), (smoothstep(-2.0, -2.35, v) * front)[:, None])  # darker chin
    upper = smoothstep(0.2, 0.6, v) * smoothstep(3.4, 2.6, au)
    face = mix(face, hexc('#747579'), (upper * front * 0.7)[:, None])                # grey forehead / crown

    def both(front_w, side_w):
        return front_w * (1 - ws) + side_w * ws
    brow = both(np.maximum(poly_w(u, v, BROW_R, 0.09), poly_w(-u, v, BROW_R, 0.09)) * front, poly_w(fc.s, fc.t, BROW_SIDE, 0.1) * near)
    browc = mix(np.tile(hexc('#fafaf7'), (len(V), 1)), np.tile(hexc('#c9c6bf'), (len(V), 1)), np.maximum(smoothstep(0.8, 2.0, au), ws)[:, None])
    face = mix(face, browc, brow[:, None])
    stripe = poly_w(u, v, mirror_poly(STRIPE_R), 0.07) * (1.0 - 0.85 * smoothstep(0.9, 1.5, v)) * (1 - ws)
    face = mix(face, hexc('#404045'), (stripe * front)[:, None])
    mask = both(poly_w(u, v, mirror_poly(MASK_R), 0.04) * front, poly_w(fc.s, fc.t, MASK_SIDE, 0.05) * near)
    snout = smoothstep(-1.0, -1.25, v) * smoothstep(0.4, 0.2, au)
    maskc = mix(np.tile(hexc('#0f0f11'), (len(V), 1)), np.tile(hexc('#2c2b2c'), (len(V), 1)), snout[:, None])
    face = mix(face, maskc, mask[:, None])
    pads = both(np.maximum(poly_w(u, v, PAD_R, 0.08), poly_w(-u, v, PAD_R, 0.08)) * front, poly_w(fc.s, fc.t, PAD_SIDE, 0.08) * near)
    face = mix(face, hexc('#fbfbf9'), pads[:, None])
    uplip = poly_w(u, v, mirror_poly(UPLIP_R), 0.04) * (1 - ws)
    face = mix(face, hexc('#3b3735'), (uplip * front)[:, None])
    lip = poly_w(u, v, mirror_poly(LIP_R), 0.03) * (1 - ws)
    face = mix(face, hexc('#55504c'), (lip * front)[:, None])
    return face * (0.94 + 0.12 * rlib.fbm(V * 90.0, 2, seed=21) * (1 - mask))[:, None]


def ear_paint(V, c):
    e = _ears_sdf0(V)
    ear_in = smoothstep(0.004, -0.002, e - 0.004)
    for i in range(2):
        base, up, fwd, across = ear_frame(i)
        q = V - (base + up * EAR_C)
        rr = np.sqrt(((q @ across) / EAR_R[0]) ** 2 + ((q @ up) / EAR_R[1]) ** 2)       # 1 = ear outline
        onear = ear_in * smoothstep(0.03, 0.0, np.abs(q @ fwd) - 0.013) * smoothstep(1.3, 1.1, rr)
        rim = smoothstep(0.62, 0.8, rr) * smoothstep(-0.2, 0.2, (q @ up) / 0.045 + 0.4)
        c = mix(c, hexc('#4a4a4f'), (onear * (1 - rim))[:, None])
        c = mix(c, hexc('#e6e3dc'), (onear * rim)[:, None])
        behind = sd_ellipsoid(V, base + np.array([0.0, -0.01, -0.03]), (0.045, 0.04, 0.03))
        c = mix(c, hexc('#1d1d20'), (smoothstep(0.006, -0.004, behind) * (1 - ear_in))[:, None])
    return c


# ============================================================================================ shell fur length
def limb_param(V, pose):
    """For each point: position along its nearest leg (0 = hip / shoulder .. 1 = toe / finger tip) and the distance to
    that leg's bone chain."""
    J = limb_joints(pose)
    best_d = np.full(len(V), np.inf)
    best_s = np.zeros(len(V))
    for key, j in J.items():
        pts = j[1:] if key[0] == 'F' else j                     # front legs: from the shoulder (not the scapula)
        seg = [np.linalg.norm(pts[k + 1] - pts[k]) for k in range(len(pts) - 1)]
        total, acc = sum(seg), 0.0
        for k in range(len(pts) - 1):
            a, b = pts[k], pts[k + 1]
            ab = b - a
            t = np.clip(((V - a) @ ab) / (ab @ ab), 0, 1)
            d = np.linalg.norm(V - (a + t[:, None] * ab), axis=1)
            better = d < best_d
            best_d = np.where(better, d, best_d)
            best_s = np.where(better, (acc + t * seg[k]) / total, best_s)
            acc += seg[k]
    return best_s, best_d


def _lerp(a, b, t):                                             # (rlib.mix is for colours)
    return a + (b - a) * t


def fur_regions(V, N, eyes, pose='stand'):
    """Soft 0..1 weights of the coat's regions at points V (normals N), shared by fur_length and fur_comb."""
    y = V[:, 1]
    ny = N[:, 1]
    ts = torso_sdf(V)
    torso = smoothstep(0.02, 0.0, ts - 0.01)
    s, _ = limb_param(V, pose)
    limbs = [limb_sdf(c) for _, c in limb_cones(pose)]
    dl = np.min(np.stack([l(V) for l in limbs], axis=1), axis=1)
    fc = FaceCoords(hinv(V), [hinv(e) for e in eyes], N)
    return dict(
        torso=torso,
        # the under-side and the lower flanks: the hanging under-fluff
        belly=smoothstep(0.2, -0.6, ny) * smoothstep(0.5, 0.4, y) * torso,
        leg=smoothstep(0.012, -0.012, dl - ts),
        leg_s=s,
        tail=smoothstep(0.01, -0.01, puff_sdf(V) - 0.012),
        head=smoothstep(0.012, -0.004, head_skin_sdf(V) - 0.01),
        ear=smoothstep(0.004, -0.002, ears_sdf(V) - 0.004),
        fc=fc,
    )


def fur_length(V, N, eyes, pose='stand', R=None):
    """Per-vertex shell-fur length as a multiple of the game's FUR_LENGTH (3.5 cm): long under-fluff hanging from the
    belly and lower flanks, ruffs on the cheeks and chest, a fluffy tail puff, a proper coat on top of the head (the
    crown between the ears is fur, not skull), very short fur on the face (shortest on the snout), short on the ears
    and lower legs, none on the soles; all of it in slightly uneven patches, like his real, rather disorderly coat."""
    R = R or fur_regions(V, N, eyes, pose)
    x, y, z = V[:, 0], V[:, 1], V[:, 2]
    ax = np.abs(x)
    ny = N[:, 1]
    fc, head, ear, legw, s = R['fc'], R['head'], R['ear'], R['leg'], R['leg_s']
    L = np.ones(len(V))
    # belly under-fluff: long and straggly, from the belly down the lower flanks (the comb makes it hang)
    L = L + 1.9 * R['belly']
    # chest / throat ruff
    chest = smoothstep(0.12, 0.22, z) * smoothstep(0.52, 0.4, y) * smoothstep(0.1, 0.0, ax - 0.04)
    L = np.maximum(L, 1.0 + 0.35 * chest)
    # legs: body-length fur at the top, short below the knees / elbows, shortest on the paws, none on the soles
    leg_len = _lerp(1.05, 0.3, smoothstep(0.3, 0.68, s))          # (cute pass: fluffy to below the knees / elbows)
    leg_len = _lerp(leg_len, 0.12, smoothstep(0.8, 0.95, s))
    L = _lerp(L, leg_len, legw)
    L = np.where((s > 0.78) & (ny < -0.5) & (legw > 0.5), 0.0, L)
    # tail puff: fluffy
    L = _lerp(L, 2.0, R['tail'])
    # head: cheek ruffs, very short face fur (shortest on the snout), a full coat on the crown and nape
    face_len = _lerp(0.3, 0.14, smoothstep(0.0, -1.2, fc.v))                     # forehead 0.3 -> snout 0.14
    face_len = _lerp(face_len, 0.1, smoothstep(-1.4, -1.9, fc.v) * smoothstep(0.9, 0.4, fc.au))   # nose / lips
    Vh = hinv(V)
    cheek = smoothstep(0.55, 0.85, fc.nx) * smoothstep(0.47, 0.42, Vh[:, 1]) * smoothstep(0.35, 0.27, Vh[:, 2])
    head_len = _lerp(1.0, face_len, fc.front)
    head_len = np.maximum(head_len, 1.4 * cheek)
    L = _lerp(L, head_len, head)
    # ears: short
    L = _lerp(L, 0.25, ear)
    # a disorderly coat: random patches of slightly different length (not on the face, ears or paws)
    patch = 0.3 * rlib.fbm(V * 12.0, 2, seed=41) + 0.15 * rlib.fbm(V * 31.0, 2, seed=43)
    L = L * (1.0 + patch * (1.0 + 0.6 * R['belly']) * (1.0 - fc.front * head) * (1.0 - ear) * smoothstep(0.03, 0.08, y))
    return np.clip(L, 0.0, 3.3)


def fur_comb(V, N, eyes, pose='stand', R=None):
    """Per-vertex direction the fur lies in (model space, along the skin), scaled: the shell tips lean this far, as a
    multiple of the local fur length. Raccoon fur lies back along the body and hangs down on the belly fringe and the
    legs; random per-patch leans make the coat a bit tousled, like the real Jimothy's."""
    R = R or fur_regions(V, N, eyes, pose)
    n = len(V)
    fc, head, ear = R['fc'], R['head'], R['ear']

    def dirs(v, k):
        return np.tile(np.asarray(v, dtype=float) / np.linalg.norm(v) * k, (n, 1))
    c = dirs([0.0, -0.3, -1.0], 0.35)                                   # body: lies back and a little down
    c = mix(c, dirs([0.0, -1.0, -0.2], 0.6), R['belly'])               # under-fluff: hangs down
    c = mix(c, dirs([0.0, -1.0, 0.0], 0.4), R['leg'])                  # legs: down the leg
    headc = mix(dirs([0.0, -0.2, -1.0], 0.5), dirs([0.0, 0.35, -1.0], 0.35), fc.front)   # crown back; face toward the ears
    c = mix(c, headc, head)
    c = c * (1.0 - 0.8 * R['tail'])[:, None]                           # the puff just sticks out
    # tousled: random per-patch leans (hardly any on the face)
    dis = np.stack([rlib.fbm(V * 9.0, 2, seed=51), rlib.fbm(V * 9.0, 2, seed=53), rlib.fbm(V * 9.0, 2, seed=57)], axis=1)
    c = c + dis * (0.4 * (1.0 - 0.85 * fc.front * head))[:, None]
    c = c - N * np.sum(c * N, axis=1)[:, None]                         # along the skin
    return c * (1.0 - ear)[:, None]
