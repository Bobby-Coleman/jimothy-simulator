"""
rlib.py - shared procedural-modelling library for the Jimothy Simulator raccoons.

Everything here is authored in GAME SPACE (glTF / three.js convention):
    +X = character's left, +Y = up, +Z = forward (the way the character faces), 1 unit = 1 m.
Blender is Z-up, so geometry is converted to Blender space only at the very end (realize()).
The glTF exporter (export_yup=True) converts back, so node transforms / vertices in the
exported .glb are exactly the game-space values used here.

Pure numpy for geometry (SDF + surface nets mesher, lofts, spheres), bpy only for
creating objects, decimation, materials, export and preview renders.
"""
import math
import os

import numpy as np

try:
    import bpy
    from mathutils import Matrix
except ImportError:  # allows importing for syntax checks outside Blender
    bpy = None
    Matrix = None


# ----------------------------------------------------------------------------------------------
# colour helpers
# ----------------------------------------------------------------------------------------------

def hexc(h):
    """'#857c72' -> np.array([r, g, b]) in sRGB 0..1"""
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])


def srgb_to_lin(c):
    c = np.asarray(c, dtype=float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def smoothstep(e0, e1, x):
    t = np.clip((np.asarray(x, dtype=float) - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def mix(a, b, t):
    """a, b: (N,3) or (3,), t: (N,) or scalar"""
    t = np.asarray(t, dtype=float)
    if t.ndim == 1:
        t = t[:, None]
    return a * (1.0 - t) + b * t


# ----------------------------------------------------------------------------------------------
# small linear-algebra helpers (4x4 numpy matrices, game space)
# ----------------------------------------------------------------------------------------------

def T(x, y=None, z=None):
    if y is None:
        x, y, z = x
    M = np.eye(4)
    M[:3, 3] = (x, y, z)
    return M


def Rx(a):
    c, s = math.cos(a), math.sin(a)
    M = np.eye(4)
    M[1, 1], M[1, 2], M[2, 1], M[2, 2] = c, -s, s, c
    return M


def Ry(a):
    c, s = math.cos(a), math.sin(a)
    M = np.eye(4)
    M[0, 0], M[0, 2], M[2, 0], M[2, 2] = c, s, -s, c
    return M


def Rz(a):
    c, s = math.cos(a), math.sin(a)
    M = np.eye(4)
    M[0, 0], M[0, 1], M[1, 0], M[1, 1] = c, -s, s, c
    return M


def S(sx, sy=None, sz=None):
    if sy is None:
        sy = sz = sx
    M = np.eye(4)
    M[0, 0], M[1, 1], M[2, 2] = sx, sy, sz
    return M


def rot3(M):
    return np.asarray(M)[:3, :3]


def normalize(v):
    v = np.asarray(v, dtype=float)
    if v.ndim == 1:
        n = np.linalg.norm(v)
        return v / (n if n > 1e-12 else 1.0)
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-12)


def frame(origin, y_axis, z_hint):
    """4x4 matrix with origin, local +Y = y_axis, local +Z as close as possible to z_hint."""
    y = normalize(y_axis)
    z = np.asarray(z_hint, dtype=float)
    z = normalize(z - y * np.dot(z, y))
    x = np.cross(y, z)
    M = np.eye(4)
    M[:3, 0], M[:3, 1], M[:3, 2], M[:3, 3] = x, y, z, origin
    return M


def frame_z(origin, z_axis, y_hint):
    """4x4 matrix with origin, local +Z = z_axis, local +Y as close as possible to y_hint."""
    z = normalize(z_axis)
    y = np.asarray(y_hint, dtype=float)
    y = normalize(y - z * np.dot(y, z))
    x = np.cross(y, z)
    M = np.eye(4)
    M[:3, 0], M[:3, 1], M[:3, 2], M[:3, 3] = x, y, z, origin
    return M


def xform(M, V):
    V = np.asarray(V, dtype=float)
    return V @ M[:3, :3].T + M[:3, 3]


def mirror_x(M):
    """Mirror a 4x4 frame across the YZ plane (keeps it right-handed: flips local X axis)."""
    Mx = np.diag([-1.0, 1.0, 1.0, 1.0])
    R = Mx @ M @ Mx
    return R


# ----------------------------------------------------------------------------------------------
# procedural noise (vectorised value noise)
# ----------------------------------------------------------------------------------------------

def _hash3(ix, iy, iz, seed):
    n = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
    n = n & 0xFFFFFFFF
    n = ((n >> 16) ^ n) * 0x45D9F3B
    n = n & 0xFFFFFFFF
    n = ((n >> 16) ^ n) * 0x45D9F3B
    n = n & 0xFFFFFFFF
    n = (n >> 16) ^ n
    return (n & 0xFFFF) / 32767.5 - 1.0


def vnoise(P, seed=0):
    """Smooth 3D value noise in [-1, 1]; P (N,3)."""
    P = np.asarray(P, dtype=float)
    Pi = np.floor(P).astype(np.int64)
    f = P - Pi
    u = f * f * (3.0 - 2.0 * f)
    ix, iy, iz = Pi[:, 0], Pi[:, 1], Pi[:, 2]
    out = 0.0
    for dx in (0, 1):
        wx = u[:, 0] if dx else 1.0 - u[:, 0]
        for dy in (0, 1):
            wy = u[:, 1] if dy else 1.0 - u[:, 1]
            for dz in (0, 1):
                wz = u[:, 2] if dz else 1.0 - u[:, 2]
                out = out + wx * wy * wz * _hash3(ix + dx, iy + dy, iz + dz, seed)
    return out


def fbm(P, octaves=3, seed=0, lac=2.03, gain=0.5):
    P = np.asarray(P, dtype=float)
    amp, tot, norm = 1.0, 0.0, 0.0
    for o in range(octaves):
        tot = tot + amp * vnoise(P * (lac ** o), seed + o * 17)
        norm += amp
        amp *= gain
    return tot / norm


# ----------------------------------------------------------------------------------------------
# signed distance functions (vectorised; P is (N,3))
# ----------------------------------------------------------------------------------------------

def sd_sphere(P, c, r):
    return np.linalg.norm(P - np.asarray(c, dtype=float), axis=1) - r


def sd_ellipsoid(P, c, r, R=None):
    """Approximate SDF of an ellipsoid (IQ). R: optional 3x3 or 4x4 rotation (columns = local axes)."""
    q = P - np.asarray(c, dtype=float)
    if R is not None:
        q = q @ np.asarray(R)[:3, :3]
    r = np.asarray(r, dtype=float)
    k0 = np.linalg.norm(q / r, axis=1)
    k1 = np.linalg.norm(q / (r * r), axis=1)
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


def sd_capsule(P, a, b, r):
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    pa = P - a
    ba = b - a
    h = np.clip((pa @ ba) / np.dot(ba, ba), 0.0, 1.0)
    return np.linalg.norm(pa - h[:, None] * ba, axis=1) - r


def sd_round_cone(P, a, b, r1, r2):
    """IQ round cone between points a (radius r1) and b (radius r2)."""
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    ba = b - a
    l2 = np.dot(ba, ba)
    rr = r1 - r2
    a2 = l2 - rr * rr
    il2 = 1.0 / l2
    pa = P - a
    y = pa @ ba
    z = y - l2
    xv = pa * l2 - y[:, None] * ba
    x2 = np.sum(xv * xv, axis=1)
    y2 = y * y * l2
    z2 = z * z * l2
    k = np.sign(rr) * rr * rr * x2
    out = np.empty(len(P))
    m1 = np.sign(z) * a2 * z2 > k
    m2 = (~m1) & (np.sign(y) * a2 * y2 < k)
    m3 = ~(m1 | m2)
    out[m1] = np.sqrt(x2[m1] + z2[m1]) * il2 - r2
    out[m2] = np.sqrt(x2[m2] + y2[m2]) * il2 - r1
    out[m3] = (np.sqrt(x2[m3] * a2 * il2) + y[m3] * rr) * il2 - r1
    return out


def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1.0 - h) + a * h - k * h * (1.0 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def sdf_grad(sdf, P, eps=1e-3):
    g = np.zeros_like(P)
    for i in range(3):
        d = np.zeros(3)
        d[i] = eps
        g[:, i] = sdf(P + d) - sdf(P - d)
    return g / (2 * eps)


def sdf_project(sdf, P, iters=4, eps=1e-3):
    P = P.copy()
    for _ in range(iters):
        f = sdf(P)
        g = sdf_grad(sdf, P, eps)
        gg = np.maximum(np.sum(g * g, axis=1), 1e-12)
        P -= (f / gg)[:, None] * g
    return P


def sdf_raycast(sdf, origin, direction, t0=0.0, t1=2.0, steps=400):
    """March from origin along direction, return first point where sdf crosses from + to -."""
    o = np.asarray(origin, dtype=float)
    d = normalize(direction)
    ts = np.linspace(t0, t1, steps)
    P = o[None, :] + ts[:, None] * d[None, :]
    f = sdf(P)
    idx = np.where((f[:-1] > 0) & (f[1:] <= 0))[0]
    if len(idx) == 0:
        raise ValueError('ray missed surface')
    i = idx[0]
    lo, hi = ts[i], ts[i + 1]
    for _ in range(40):
        mid = 0.5 * (lo + hi)
        if sdf((o + mid * d)[None, :])[0] > 0:
            lo = mid
        else:
            hi = mid
    p = o + 0.5 * (lo + hi) * d
    n = normalize(sdf_grad(sdf, p[None, :])[0])
    return p, n


# ----------------------------------------------------------------------------------------------
# Mesh container (numpy, game space, world coordinates while authoring)
# ----------------------------------------------------------------------------------------------

class Mesh:
    """Polygon mesh: V (N,3) float, F list of index tuples, FM per-face material name,
    C (N,3) sRGB vertex colours (optional), attrs dict of per-vertex scalar arrays."""

    def __init__(self, V=None, F=None, mat='Fur', attrs=None):
        self.V = np.zeros((0, 3)) if V is None else np.asarray(V, dtype=float).reshape(-1, 3)
        self.F = [] if F is None else [tuple(int(i) for i in f) for f in F]
        self.FM = [mat] * len(self.F)
        self.C = None
        self.attrs = {} if attrs is None else {k: np.asarray(v, dtype=float) for k, v in attrs.items()}

    def copy(self):
        m = Mesh()
        m.V = self.V.copy()
        m.F = list(self.F)
        m.FM = list(self.FM)
        m.C = None if self.C is None else self.C.copy()
        m.attrs = {k: v.copy() for k, v in self.attrs.items()}
        return m

    def add(self, other):
        off = len(self.V)
        n_self, n_other = len(self.V), len(other.V)
        keys = set(self.attrs) | set(other.attrs)
        for k in keys:
            a = self.attrs.get(k, np.zeros(n_self))
            b = other.attrs.get(k, np.zeros(n_other))
            self.attrs[k] = np.concatenate([a, b])
        if self.C is not None or other.C is not None:
            a = self.C if self.C is not None else np.ones((n_self, 3))
            b = other.C if other.C is not None else np.ones((n_other, 3))
            self.C = np.concatenate([a, b])
        self.V = np.concatenate([self.V, other.V])
        self.F += [tuple(i + off for i in f) for f in other.F]
        self.FM += other.FM
        return self

    def set_mat(self, mat):
        self.FM = [mat] * len(self.F)
        return self

    def transform(self, M):
        self.V = xform(M, self.V)
        if np.linalg.det(np.asarray(M)[:3, :3]) < 0:
            self.F = [tuple(reversed(f)) for f in self.F]
        return self

    def flip(self):
        self.F = [tuple(reversed(f)) for f in self.F]
        return self

    def tri_count(self):
        return sum(len(f) - 2 for f in self.F)

    def normals(self):
        V = self.V
        N = np.zeros_like(V)
        for f in self.F:
            p0 = V[f[0]]
            for i in range(1, len(f) - 1):
                n = np.cross(V[f[i]] - p0, V[f[i + 1]] - p0)
                N[f[0]] += n
                N[f[i]] += n
                N[f[i + 1]] += n
        return normalize(N)

    def paint(self, fn):
        """fn(V, N, mesh) -> (N,3) sRGB colours"""
        self.C = np.clip(np.asarray(fn(self.V, self.normals(), self), dtype=float), 0.0, 1.0)
        return self

    def compact(self):
        used = sorted(set(i for f in self.F for i in f))
        remap = -np.ones(len(self.V), dtype=np.int64)
        remap[used] = np.arange(len(used))
        self.V = self.V[used]
        if self.C is not None:
            self.C = self.C[used]
        self.attrs = {k: v[used] for k, v in self.attrs.items()}
        self.F = [tuple(int(remap[i]) for i in f) for f in self.F]
        return self

    def bbox(self):
        return self.V.min(axis=0), self.V.max(axis=0)


def mirrored(mesh):
    """Mirror a mesh across X (fixes winding)."""
    m = mesh.copy()
    m.V[:, 0] *= -1.0
    m.F = [tuple(reversed(f)) for f in m.F]
    return m


# ----------------------------------------------------------------------------------------------
# primitive generators
# ----------------------------------------------------------------------------------------------

def uv_sphere(nu=16, nv=10, mat='Fur'):
    """Unit UV sphere, poles on +-Y."""
    V = [(0.0, 1.0, 0.0)]
    for j in range(1, nv):
        th = math.pi * j / nv
        for i in range(nu):
            ph = 2 * math.pi * i / nu
            V.append((math.sin(th) * math.sin(ph), math.cos(th), math.sin(th) * math.cos(ph)))
    V.append((0.0, -1.0, 0.0))
    F = []
    for i in range(nu):
        F.append((0, 1 + i, 1 + (i + 1) % nu))
    for j in range(nv - 2):
        a = 1 + j * nu
        b = a + nu
        for i in range(nu):
            i2 = (i + 1) % nu
            F.append((a + i, b + i, b + i2, a + i2))
    last = len(V) - 1
    a = 1 + (nv - 2) * nu
    for i in range(nu):
        F.append((a + i, last, a + (i + 1) % nu))
    return Mesh(V, F, mat)


def cube_sphere(n=12, mat='Fur'):
    """Unit quad-sphere (equal-angle cube mapping) - even vertex distribution, no poles."""
    verts = {}
    V = []
    F = []

    def vid(p):
        key = tuple(np.round(p, 6))
        if key not in verts:
            verts[key] = len(V)
            V.append(p)
        return verts[key]

    axes = [
        (np.array([1, 0, 0]), np.array([0, 0, -1]), np.array([0, 1, 0])),
        (np.array([-1, 0, 0]), np.array([0, 0, 1]), np.array([0, 1, 0])),
        (np.array([0, 1, 0]), np.array([1, 0, 0]), np.array([0, 0, -1])),
        (np.array([0, -1, 0]), np.array([1, 0, 0]), np.array([0, 0, 1])),
        (np.array([0, 0, 1]), np.array([1, 0, 0]), np.array([0, 1, 0])),
        (np.array([0, 0, -1]), np.array([-1, 0, 0]), np.array([0, 1, 0])),
    ]
    for nrm, ua, va in axes:
        grid = np.empty((n + 1, n + 1), dtype=np.int64)
        for i in range(n + 1):
            for j in range(n + 1):
                a = math.tan((i / n * 2 - 1) * math.pi / 4)
                b = math.tan((j / n * 2 - 1) * math.pi / 4)
                p = nrm + ua * a + va * b
                grid[i, j] = vid(normalize(p))
        for i in range(n):
            for j in range(n):
                F.append((grid[i, j], grid[i + 1, j], grid[i + 1, j + 1], grid[i, j + 1]))
    m = Mesh(np.array(V), F, mat)
    # ensure outward winding
    if _signed_volume(m) < 0:
        m.flip()
    return m


def _signed_volume(m):
    vol = 0.0
    V = m.V
    for f in m.F:
        for i in range(1, len(f) - 1):
            vol += np.dot(V[f[0]], np.cross(V[f[i]], V[f[i + 1]]))
    return vol / 6.0


def fix_winding(m):
    if _signed_volume(m) < 0:
        m.flip()
    return m


def loft(rings, cap_start=None, cap_end=None, mat='Fur', attrs=None):
    """rings: list of (n,3) arrays with consistent winding. cap_*: None (open) or a 3-vector pole point.
    Faces wind so that if rings go along +axis and points go counter-clockwise when looking
    down -axis (i.e. right-handed around the axis), normals point outward."""
    n = len(rings[0])
    V = []
    F = []
    A = {k: [] for k in (attrs or {})}
    for ri, r in enumerate(rings):
        V.extend(r)
        for k in A:
            A[k].extend([attrs[k][ri]] * n)
    for j in range(len(rings) - 1):
        a = j * n
        b = a + n
        for i in range(n):
            i2 = (i + 1) % n
            F.append((a + i, a + i2, b + i2, b + i))
    if cap_start is not None:
        p = len(V)
        V.append(cap_start)
        for k in A:
            A[k].append(attrs[k][0])
        for i in range(n):
            F.append((p, (i + 1) % n, i))
    if cap_end is not None:
        p = len(V)
        V.append(cap_end)
        for k in A:
            A[k].append(attrs[k][-1])
        a = (len(rings) - 1) * n
        for i in range(n):
            F.append((a + i, a + (i + 1) % n, p))
    return Mesh(np.array(V), F, mat, {k: np.array(v) for k, v in A.items()})


def parallel_frames(points, up_hint=(0, 1, 0)):
    """Tangents + normal/binormal frames along a polyline via parallel transport."""
    P = np.asarray(points, dtype=float)
    n = len(P)
    Tn = np.zeros_like(P)
    Tn[1:-1] = P[2:] - P[:-2]
    Tn[0] = P[1] - P[0]
    Tn[-1] = P[-1] - P[-2]
    Tn = normalize(Tn)
    up = np.asarray(up_hint, dtype=float)
    Nn = np.zeros_like(P)
    Bn = np.zeros_like(P)
    nv = normalize(up - Tn[0] * np.dot(up, Tn[0]))
    if np.linalg.norm(up - Tn[0] * np.dot(up, Tn[0])) < 1e-6:
        nv = normalize(np.cross(Tn[0], [1, 0, 0]))
    for i in range(n):
        if i > 0:
            # rotate previous normal onto new tangent plane
            nv = nv - Tn[i] * np.dot(nv, Tn[i])
            nv = normalize(nv)
        Nn[i] = nv
        Bn[i] = np.cross(Tn[i], nv)
    return Tn, Nn, Bn


def tube(points, radii, n_around=12, cap_start=True, cap_end=True, cap_rings=4, mat='Fur',
         up_hint=(0, 1, 0), s_values=None, twist=0.0):
    """Generalised cylinder along a polyline.
    radii: list of scalars or (rx, ry) pairs (rx along binormal, ry along normal/up).
    Rounded (hemispherical-ish) caps are generated when cap_start / cap_end are True.
    Returns Mesh with attr 's' (arc-length-ish parameter, supplied or computed)."""
    P = np.asarray(points, dtype=float)
    R = [np.array(r if np.ndim(r) else (r, r), dtype=float) for r in radii]
    Tn, Nn, Bn = parallel_frames(P, up_hint)
    if s_values is None:
        seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
        s_values = np.concatenate([[0], np.cumsum(seg)])
    s_values = np.asarray(s_values, dtype=float)
    rings, svals = [], []

    def ring(c, t, nn, bb, rxy, scale=1.0):
        out = []
        for i in range(n_around):
            a = 2 * math.pi * i / n_around + twist
            # counter-clockwise around +t: b-axis then n-axis (b = t x n)
            out.append(c + scale * (rxy[0] * math.cos(a) * bb + rxy[1] * math.sin(a) * nn))
        return np.array(out)

    # winding: points go from b towards n; t = n x b?  b = t x n  => (b, n, t) is left-handed
    # we fix globally below with a winding check instead of reasoning about it.
    if cap_start:
        r0 = R[0]
        cap_len = float(np.mean(r0))
        for k in range(cap_rings, 0, -1):
            a = (k / (cap_rings + 1)) * (math.pi / 2)  # angle from equator
            d = cap_len * math.sin(a)
            sc = math.cos(a)
            rings.append(ring(P[0] - Tn[0] * d, Tn[0], Nn[0], Bn[0], r0, sc))
            svals.append(s_values[0] - d)
    for i in range(len(P)):
        rings.append(ring(P[i], Tn[i], Nn[i], Bn[i], R[i]))
        svals.append(s_values[i])
    if cap_end:
        r1 = R[-1]
        cap_len = float(np.mean(r1))
        for k in range(1, cap_rings + 1):
            a = (k / (cap_rings + 1)) * (math.pi / 2)
            d = cap_len * math.sin(a)
            sc = math.cos(a)
            rings.append(ring(P[-1] + Tn[-1] * d, Tn[-1], Nn[-1], Bn[-1], r1, sc))
            svals.append(s_values[-1] + d)
    cs = (P[0] - Tn[0] * float(np.mean(R[0]))) if cap_start else None
    ce = (P[-1] + Tn[-1] * float(np.mean(R[-1]))) if cap_end else None
    if cap_start:
        svals_full = svals
    m = loft(rings, cs, ce, mat, attrs={'s': svals})
    # the loft helper duplicates attr for caps from first/last ring; correct the pole values
    if cap_start:
        m.attrs['s'][len(rings) * n_around] = s_values[0] - float(np.mean(R[0]))
    if cap_end:
        m.attrs['s'][-1] = s_values[-1] + float(np.mean(R[-1]))
    _orient_tube(m, P)
    return m


def _orient_tube(m, P):
    """Make tube faces point away from the centre line (majority vote)."""
    V = m.V
    votes = 0
    centre_pts = np.asarray(P)
    for f in m.F[: min(len(m.F), 400)]:
        if len(f) < 3:
            continue
        c = V[list(f)].mean(axis=0)
        n = np.cross(V[f[1]] - V[f[0]], V[f[2]] - V[f[0]])
        d = np.linalg.norm(centre_pts - c, axis=1)
        axis_pt = centre_pts[np.argmin(d)]
        votes += 1 if np.dot(n, c - axis_pt) > 0 else -1
    if votes < 0:
        m.flip()
    return m


def ellipsoid_mesh(c, r, nu=16, nv=10, R=None, mat='Fur'):
    m = uv_sphere(nu, nv, mat)
    m.V = m.V * np.asarray(r, dtype=float)
    if R is not None:
        m.V = m.V @ np.asarray(R)[:3, :3].T
    m.V = m.V + np.asarray(c, dtype=float)
    return m


# ----------------------------------------------------------------------------------------------
# SDF -> mesh (naive surface nets, numpy)
# ----------------------------------------------------------------------------------------------

def surface_nets(sdf, bmin, bmax, h, project_iters=4, relax_iters=3, keep=None):
    """Mesh the zero level set of `sdf` inside the box [bmin, bmax] with voxel size h.
    keep: optional fn(centroids (M,3)) -> bool mask of faces to keep.
    Returns Mesh (quads) with outward-facing normals (sdf gradient direction)."""
    bmin = np.asarray(bmin, dtype=float)
    bmax = np.asarray(bmax, dtype=float)
    n = np.ceil((bmax - bmin) / h).astype(int) + 1
    xs = [bmin[i] + h * np.arange(n[i]) for i in range(3)]
    G = np.stack(np.meshgrid(*xs, indexing='ij'), axis=-1).reshape(-1, 3)
    Fv = np.empty(len(G))
    chunk = 200000
    for i in range(0, len(G), chunk):
        Fv[i:i + chunk] = sdf(G[i:i + chunk])
    Fv = Fv.reshape(n)
    nc = n - 1
    csum = np.zeros((nc[0], nc[1], nc[2], 3))
    ccnt = np.zeros((nc[0], nc[1], nc[2]))
    quads = []
    unit = np.eye(3)
    for ax in range(3):
        s0 = [slice(None)] * 3
        s1 = [slice(None)] * 3
        s0[ax] = slice(0, n[ax] - 1)
        s1[ax] = slice(1, n[ax])
        f0 = Fv[tuple(s0)]
        f1 = Fv[tuple(s1)]
        cross = (f0 < 0) != (f1 < 0)
        idx = np.argwhere(cross)
        if len(idx) == 0:
            continue
        a0 = f0[cross]
        a1 = f1[cross]
        t = a0 / (a0 - a1)
        pos = bmin + h * idx + (h * t)[:, None] * unit[ax]
        o1, o2 = [a for a in range(3) if a != ax]
        cells = []
        for d1, d2 in ((-1, -1), (0, -1), (0, 0), (-1, 0)):
            c = idx.copy()
            c[:, o1] += d1
            c[:, o2] += d2
            cells.append(c)
            valid = (c[:, o1] >= 0) & (c[:, o1] < nc[o1]) & (c[:, o2] >= 0) & (c[:, o2] < nc[o2])
            cv = c[valid]
            np.add.at(csum, (cv[:, 0], cv[:, 1], cv[:, 2]), pos[valid])
            np.add.at(ccnt, (cv[:, 0], cv[:, 1], cv[:, 2]), 1)
        allv = np.ones(len(idx), dtype=bool)
        for c in cells:
            allv &= (c[:, o1] >= 0) & (c[:, o1] < nc[o1]) & (c[:, o2] >= 0) & (c[:, o2] < nc[o2])
        q = np.stack([c[allv] for c in cells], axis=1)  # (K,4,3)
        flip = (a0 < 0)[allv]  # inside at lower end -> orientation depends
        quads.append((q, flip, ax))
    vid = -np.ones(nc, dtype=np.int64)
    has = ccnt > 0
    vid[has] = np.arange(int(has.sum()))
    V = csum[has] / ccnt[has][:, None]
    F = []
    for q, flip, ax in quads:
        ids = vid[q[:, :, 0], q[:, :, 1], q[:, :, 2]]
        ids[flip] = ids[flip][:, ::-1]
        F.append(ids)
    F = np.concatenate(F) if F else np.zeros((0, 4), dtype=np.int64)
    # orientation fix via gradient at centroid
    cen = V[F].mean(axis=1)
    nrm = np.cross(V[F[:, 2]] - V[F[:, 0]], V[F[:, 3]] - V[F[:, 1]])
    g = sdf_grad(sdf, cen, h * 0.25)
    bad = np.sum(nrm * g, axis=1) < 0
    F[bad] = F[bad][:, ::-1]
    if keep is not None:
        F = F[keep(V[F].mean(axis=1))]
    m = Mesh(V, F.tolist())
    m.compact()
    # tangential relaxation + projection
    m.V = sdf_project(sdf, m.V, project_iters, h * 0.25)
    if relax_iters:
        nb = _neighbours(m)
        boundary = _boundary_verts(m)
        for _ in range(relax_iters):
            avg = np.array([m.V[list(nbs)].mean(axis=0) if nbs else m.V[i] for i, nbs in enumerate(nb)])
            newV = m.V * 0.4 + avg * 0.6
            newV[boundary] = m.V[boundary]
            m.V = sdf_project(sdf, newV, 3, h * 0.25)
    return m


def _neighbours(m):
    nb = [set() for _ in range(len(m.V))]
    for f in m.F:
        k = len(f)
        for i in range(k):
            a, b = f[i], f[(i + 1) % k]
            nb[a].add(b)
            nb[b].add(a)
    return nb


def _boundary_verts(m):
    cnt = {}
    for f in m.F:
        k = len(f)
        for i in range(k):
            e = tuple(sorted((f[i], f[(i + 1) % k])))
            cnt[e] = cnt.get(e, 0) + 1
    b = set()
    for e, c in cnt.items():
        if c == 1:
            b.update(e)
    return np.array(sorted(b), dtype=np.int64)


# ----------------------------------------------------------------------------------------------
# Blender helpers: decimation of numpy meshes
# ----------------------------------------------------------------------------------------------

def bl_decimate(mesh, ratio=None, target_tris=None, symmetric=False, weights=None):
    """Collapse-decimate a Mesh through Blender. Returns a new Mesh (triangles), material = first."""
    if target_tris is not None:
        ratio = min(1.0, target_tris / max(1, mesh.tri_count()))
    if ratio is None or ratio >= 0.999:
        return mesh
    me = bpy.data.meshes.new('_tmp_dec')
    me.from_pydata(mesh.V.tolist(), [], [list(f) for f in mesh.F])
    me.update()
    ob = bpy.data.objects.new('_tmp_dec', me)
    bpy.context.scene.collection.objects.link(ob)
    mod = ob.modifiers.new('dec', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = ratio
    mod.use_symmetry = symmetric
    mod.symmetry_axis = 'X'
    mod.use_collapse_triangulate = True
    if weights is not None:
        vg = ob.vertex_groups.new(name='w')
        for i, w in enumerate(weights):
            vg.add([i], float(w), 'REPLACE')
        mod.vertex_group = 'w'
        mod.vertex_group_factor = 10.0
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me2 = bpy.data.meshes.new_from_object(ev)
    V = np.zeros(len(me2.vertices) * 3)
    me2.vertices.foreach_get('co', V)
    F = [tuple(p.vertices) for p in me2.polygons]
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    bpy.data.meshes.remove(me2)
    out = Mesh(V.reshape(-1, 3), F, mesh.FM[0] if mesh.FM else 'Fur')
    return out


# ----------------------------------------------------------------------------------------------
# Scene graph of parts
# ----------------------------------------------------------------------------------------------

class Part:
    def __init__(self, name, M=None, parent=None):
        self.name = name
        self.M = np.eye(4) if M is None else np.asarray(M, dtype=float)
        self.parent = parent
        self.children = []
        self.mesh = None  # Mesh in WORLD game space (rest pose)
        if parent is not None:
            parent.children.append(self)

    @property
    def pivot(self):
        return self.M[:3, 3].copy()

    def add_mesh(self, m):
        if self.mesh is None:
            self.mesh = m.copy()
        else:
            self.mesh.add(m)
        return self


class Model:
    def __init__(self, root_name):
        self.root = Part(root_name)
        self.parts = {root_name: self.root}

    def add(self, name, parent, M):
        p = Part(name, M, self.parts[parent] if isinstance(parent, str) else parent)
        self.parts[name] = p
        return p

    def __getitem__(self, k):
        return self.parts[k]

    def walk(self, part=None):
        part = part or self.root
        yield part
        for c in part.children:
            yield from self.walk(c)

    def tri_count(self):
        return sum(p.mesh.tri_count() for p in self.walk() if p.mesh is not None)

    def scale_all(self, s):
        for p in self.walk():
            p.M = p.M.copy()
            p.M[:3, 3] *= s
            if p.mesh is not None:
                p.mesh.V = p.mesh.V * s
        return self

    def report(self):
        lines = []

        def rec(p, depth):
            tris = p.mesh.tri_count() if p.mesh is not None else 0
            loc = p.M[:3, 3]
            lines.append('%s%-10s pivot=(%.3f, %.3f, %.3f) tris=%d' % ('  ' * depth, p.name, loc[0], loc[1], loc[2], tris))
            for c in p.children:
                rec(c, depth + 1)
        rec(self.root, 0)
        lines.append('TOTAL TRIS: %d' % self.tri_count())
        return '\n'.join(lines)


# ----------------------------------------------------------------------------------------------
# Blender realisation
# ----------------------------------------------------------------------------------------------

_C4 = np.array([[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1]], dtype=float)
_C4i = np.linalg.inv(_C4)


def g2b_matrix(M):
    return _C4 @ M @ _C4i


def g2b_points(V):
    V = np.asarray(V, dtype=float)
    return np.stack([V[:, 0], -V[:, 2], V[:, 1]], axis=1)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def realize(model, materials, collection=None):
    """Create Blender objects for a Model. materials: dict name -> bpy material.
    Returns dict name -> object."""
    coll = collection or bpy.context.scene.collection
    objs = {}
    for p in model.walk():
        if p.mesh is None:
            ob = bpy.data.objects.new(p.name, None)
            ob.empty_display_type = 'PLAIN_AXES'
            ob.empty_display_size = 0.1
        else:
            m = p.mesh
            Minv = np.linalg.inv(p.M)
            Vl = xform(Minv, m.V)
            Vb = g2b_points(Vl)
            me = bpy.data.meshes.new(p.name)
            me.from_pydata(Vb.tolist(), [], [list(f) for f in m.F])
            # materials
            names = []
            for mn in m.FM:
                if mn not in names:
                    names.append(mn)
            for mn in names:
                me.materials.append(materials[mn])
            idx = np.array([names.index(mn) for mn in m.FM], dtype=np.int32)
            me.polygons.foreach_set('material_index', idx)
            me.polygons.foreach_set('use_smooth', np.ones(len(me.polygons), dtype=bool))
            if m.C is not None:
                ca = me.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='POINT')
                lin = srgb_to_lin(m.C)
                rgba = np.concatenate([lin, np.ones((len(lin), 1))], axis=1).astype(np.float32)
                ca.data.foreach_set('color', rgba.ravel())
                me.color_attributes.active_color = ca
                try:
                    me.color_attributes.render_color_index = me.color_attributes.find('Color')
                    me.color_attributes.active_color_index = me.color_attributes.find('Color')
                except Exception:
                    pass
            me.validate(clean_customdata=False)
            me.update()
            ob = bpy.data.objects.new(p.name, me)
        coll.objects.link(ob)
        if p.parent is not None:
            ob.parent = objs[p.parent.name]
            ob.matrix_parent_inverse.identity()
            L = np.linalg.inv(p.parent.M) @ p.M
        else:
            L = p.M
        ob.matrix_basis = Matrix(g2b_matrix(L).tolist())
        objs[p.name] = ob
    bpy.context.view_layer.update()
    return objs


# ----------------------------------------------------------------------------------------------
# materials
# ----------------------------------------------------------------------------------------------

def _bsdf(mat):
    for n in mat.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            return n
    raise RuntimeError('no principled bsdf')


def _set_input(node, names, value):
    for nm in names if isinstance(names, (list, tuple)) else [names]:
        if nm in node.inputs:
            node.inputs[nm].default_value = value
            return True
    return False


def make_material(name, color='#ffffff', rough=0.8, spec=0.5, metallic=0.0, vcol=False,
                  emission=None, emission_strength=1.0, alpha=1.0, coat=0.0):
    mat = bpy.data.materials.new(name)
    try:
        mat.use_nodes = True
    except Exception:
        pass
    b = _bsdf(mat)
    c = srgb_to_lin(hexc(color)) if isinstance(color, str) else np.asarray(color, dtype=float)
    _set_input(b, 'Base Color', (float(c[0]), float(c[1]), float(c[2]), 1.0))
    _set_input(b, 'Roughness', float(rough))
    _set_input(b, ['Specular IOR Level', 'Specular'], float(spec))
    _set_input(b, 'Metallic', float(metallic))
    if coat:
        _set_input(b, ['Coat Weight', 'Clearcoat'], float(coat))
        _set_input(b, ['Coat Roughness', 'Clearcoat Roughness'], 0.03)
    if emission is not None:
        e = srgb_to_lin(hexc(emission)) if isinstance(emission, str) else np.asarray(emission, dtype=float)
        _set_input(b, ['Emission Color', 'Emission'], (float(e[0]), float(e[1]), float(e[2]), 1.0))
        _set_input(b, 'Emission Strength', float(emission_strength))
    if vcol:
        nt = mat.node_tree
        vc = nt.nodes.new('ShaderNodeVertexColor')
        vc.layer_name = 'Color'
        vc.location = (-400, 200)
        nt.links.new(vc.outputs['Color'], b.inputs['Base Color'])
    if alpha < 1.0:
        _set_input(b, 'Alpha', float(alpha))
        for attr, val in (('surface_render_method', 'BLENDED'), ('blend_method', 'BLEND')):
            try:
                setattr(mat, attr, val)
            except Exception:
                pass
        try:
            mat.use_backface_culling = False
        except Exception:
            pass
    c3 = srgb_to_lin(hexc(color)) if isinstance(color, str) else c
    mat.diffuse_color = (float(c3[0]), float(c3[1]), float(c3[2]), float(alpha))
    return mat


# ----------------------------------------------------------------------------------------------
# export
# ----------------------------------------------------------------------------------------------

def select_hierarchy(root_obj):
    bpy.ops.object.select_all(action='DESELECT')

    def rec(o):
        o.select_set(True)
        for c in o.children:
            rec(c)
    rec(root_obj)
    bpy.context.view_layer.objects.active = root_obj


def export_glb(path, root_obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    select_hierarchy(root_obj)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=True,
        export_tangents=False,
        export_materials='EXPORT',
        export_vertex_color='MATERIAL',
        export_all_vertex_colors=False,
        export_animations=False,
        export_extras=False,
        export_cameras=False,
        export_lights=False,
    )
    print('EXPORTED', path, os.path.getsize(path), 'bytes')


# ----------------------------------------------------------------------------------------------
# preview rendering
# ----------------------------------------------------------------------------------------------

def world_bounds(objs):
    import mathutils
    lo = np.array([1e9] * 3)
    hi = -lo
    for o in objs:
        if o.type != 'MESH':
            continue
        mw = o.matrix_world
        for v in o.data.vertices:
            w = mw @ v.co
            lo = np.minimum(lo, w)
            hi = np.maximum(hi, w)
    return lo, hi


def add_sun(name, from_dir_game, energy=3.0, angle_deg=8, shadow=True):
    """Sun light shining FROM from_dir_game (game space) toward the origin."""
    import mathutils
    d = normalize(from_dir_game)
    d_b = np.array([d[0], -d[2], d[1]])
    lt = bpy.data.lights.new(name, 'SUN')
    lt.energy = energy
    lt.angle = math.radians(angle_deg)
    try:
        lt.use_shadow = shadow
    except Exception:
        pass
    ob = bpy.data.objects.new(name, lt)
    bpy.context.scene.collection.objects.link(ob)
    # light shines along its local -Z; we want -Z = -d_b (travelling from d toward origin)
    ob.rotation_euler = mathutils.Vector((-d_b).tolist()).to_track_quat('-Z', 'Y').to_euler()
    return ob


def setup_preview_scene(bg='#dcdcdc', floor=True, floor_z=None, sun_strength=3.2):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    try:
        scene.eevee.taa_render_samples = 48
    except Exception:
        pass
    for attr, val in (('use_shadows', True), ('use_raytracing', True), ('use_gtao', True)):
        try:
            setattr(scene.eevee, attr, val)
        except Exception:
            pass
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.render.film_transparent = False
    world = bpy.data.worlds.new('PreviewWorld')
    scene.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    bgc = srgb_to_lin(hexc(bg))
    for n in world.node_tree.nodes:
        if n.type == 'BACKGROUND':
            n.inputs['Color'].default_value = (float(bgc[0]), float(bgc[1]), float(bgc[2]), 1.0)
            n.inputs['Strength'].default_value = 0.85
    # key light (sun) from front / viewer-left / above; rim light from behind; weak fill.
    add_sun('Key', from_dir_game=(-0.55, 0.75, 0.75), energy=sun_strength, angle_deg=8)
    add_sun('Rim', from_dir_game=(0.4, 0.6, -0.9), energy=1.6, angle_deg=15)
    add_sun('Fill', from_dir_game=(0.9, 0.2, 0.4), energy=0.6, angle_deg=30, shadow=False)
    if floor:
        me = bpy.data.meshes.new('Floor')
        s = 20
        z = floor_z if floor_z is not None else 0.0
        me.from_pydata([(-s, -s, z), (s, -s, z), (s, s, z), (-s, s, z)], [], [(0, 1, 2, 3)])
        fl = bpy.data.objects.new('Floor', me)
        scene.collection.objects.link(fl)
        fm = make_material('_floor', bg, rough=0.9, spec=0.2)
        me.materials.append(fm)
    return scene


def render_views(objs, out_path, views=('front', 'three_quarter', 'side', 'back'), size=560,
                 lens=85, margin=1.12, focus=None, radius=None, cols=2, elevation=12.0):
    """Render views of the given objects and stitch them into one PNG grid.
    Views are named in GAME space: 'front' looks from +Z toward the character."""
    scene = bpy.context.scene
    lo, hi = world_bounds(objs)
    centre = (lo + hi) / 2 if focus is None else np.asarray(focus, dtype=float)
    rad = np.linalg.norm(hi - lo) / 2 if radius is None else radius
    cam_data = bpy.data.cameras.new('PreviewCam')
    cam_data.lens = lens
    cam = bpy.data.objects.new('PreviewCam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.image_settings.file_format = 'PNG'
    fov = 2 * math.atan(36 / 2 / lens)
    dist = rad * margin / math.sin(fov / 2)
    # azimuths in game space: 0 = front (+Z), 90 = character's left (+X)
    az = {'front': 0.0, 'three_quarter': 35.0, 'side': 90.0, 'back': 180.0, 'three_quarter_r': -35.0,
          'top': 0.0, 'left_back': 135.0}
    tiles = []
    tmpdir = os.path.join(os.path.dirname(out_path), '_tiles')
    os.makedirs(tmpdir, exist_ok=True)
    for v in views:
        a = math.radians(az.get(v, 0.0))
        el = math.radians(70.0 if v == 'top' else elevation)
        dg = np.array([math.sin(a) * math.cos(el), math.sin(el), math.cos(a) * math.cos(el)])  # game dir
        pos_g = centre_g = None
        # centre is in Blender space already (from world_bounds)
        d_b = np.array([dg[0], -dg[2], dg[1]])
        pos = centre + d_b * dist
        cam.location = pos.tolist()
        look = centre - pos
        import mathutils
        cam.rotation_euler = mathutils.Vector(look.tolist()).to_track_quat('-Z', 'Y').to_euler()
        fp = os.path.join(tmpdir, 'tile_%s.png' % v)
        scene.render.filepath = fp
        bpy.ops.render.render(write_still=True)
        tiles.append(fp)
    # stitch
    rows = int(math.ceil(len(tiles) / cols))
    W = size * min(cols, len(tiles))
    H = size * rows
    canvas = np.ones((H, W, 4), dtype=np.float32)
    for i, fp in enumerate(tiles):
        img = bpy.data.images.load(fp)
        px = np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)
        r, c = divmod(i, cols)
        # blender image rows go bottom->top
        y0 = H - (r + 1) * size
        canvas[y0:y0 + size, c * size:(c + 1) * size] = px
        bpy.data.images.remove(img)
    out = bpy.data.images.new('stitch', W, H, alpha=True)
    out.pixels.foreach_set(canvas.ravel())
    out.filepath_raw = out_path
    out.file_format = 'PNG'
    out.save()
    bpy.data.images.remove(out)
    bpy.data.objects.remove(cam)
    print('RENDERED', out_path)
    return out_path
