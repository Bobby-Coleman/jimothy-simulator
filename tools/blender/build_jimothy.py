"""
Blender 5.2 (headless): build public/assets/models/jimothy.glb, the walking Jimothy.

  "$BLENDER" -b --factory-startup -P tools/blender/build_jimothy.py -- [--no-render] [--tris 12500] [--tex 2048] [--h 0.0045]

One skinned, textured mesh (material "Fur") made from the approved anatomy (jimothy_anatomy.py) in its standing bind
pose, plus rigid eyes, catchlights and nose parented to the Head bone.

* Texture: smart-UV islands (the head's islands get extra texel density so the mask stays crisp), painted by
  evaluating jimothy_anatomy.paint() at every texel's 3D point, then dilated so mip levels don't bleed at seams.
* `_FURLEN` vertex attribute: shell-fur length as a multiple of the game's FUR_LENGTH (three.js: `_furlen`).
* Rig: every bone points straight up in Blender, so in glTF / three.js every joint's rest rotation is IDENTITY and its
  local axes are the model's (+X his left, +Y up, +Z forward). Poses are plain Euler angles in the model frame:
  rotation.x > 0 swings a leg's lower end backward, like the round model's limbs.
* Skin weights are computed here (not bone heat): each vertex belongs softly to the body parts it is closest to
  (torso, head, ears, tail, each leg), and within a part to the nearest bones; then smoothed over the mesh.
"""
import math
import os
import sys
import time

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import rlib  # noqa: E402
import jimothy_anatomy as A  # noqa: E402
from rlib import smoothstep  # noqa: E402

PROJECT = os.path.dirname(os.path.dirname(HERE))
MODELS_DIR = os.path.join(PROJECT, 'public', 'assets', 'models')
RENDER_DIR = os.path.join(HERE, 'renders')
POSE = 'stand'
HEAD_UV_SCALE = 2.6          # extra texel density on the head's UV islands


def args():
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    o = dict(render=True, tris=13000, tex=2048, h=0.0045, out='jimothy', protect=1.0)
    i = 0
    while i < len(a):
        if a[i] == '--no-render':
            o['render'] = False
        elif a[i] in ('--tris', '--tex'):
            o[a[i][2:]] = int(a[i + 1])
            i += 1
        elif a[i] == '--protect':
            o['protect'] = float(a[i + 1])
            i += 1
        elif a[i] == '--h':
            o['h'] = float(a[i + 1])
            i += 1
        elif a[i] == '--out':
            o['out'] = a[i + 1]
            i += 1
        i += 1
    return o


OPT = args()
T0 = time.time()


def log(*m):
    print('[%6.1fs]' % (time.time() - T0), *m, flush=True)


def g2b(p):
    return Vector((float(p[0]), float(-p[2]), float(p[1])))


# ============================================================================================ skeleton
LJ = A.limb_joints(POSE)


def spine_at(t):
    """Point on the vertebral column (3.6 cm under the drawn dorsal line), t = 0 sacrum .. 1 occiput."""
    n = len(A.SPINE)
    f = t * (n - 1)
    k = int(min(f, n - 2))
    u = f - k
    return A.SPINE[k] * (1 - u) + A.SPINE[k + 1] * u - np.array([0.0, 0.036, 0.0])


HIP_MID = np.array([0.0, A.HIP[1], A.HIP[2]])
HEAD_PIV = np.array([0.0, 0.53, 0.262])       # atlanto-occipital joint (back of the skull)
JAW_PIV = np.array([0.0, 0.44, 0.318])        # jaw hinge
CHIN = np.array([0.0, 0.372, 0.392])
LIP = np.array([0.0, 0.372, 0.405])           # where the lips meet under the nose
BONES = {}                                     # name -> (joint position, parent)


def bone(name, head, parent):
    BONES[name] = (np.asarray(head, dtype=float), parent)


bone('Hips', (A.SACRUM + HIP_MID) / 2, None)
bone('Spine1', spine_at(0.3), 'Hips')
bone('Spine2', spine_at(0.55), 'Spine1')
bone('Chest', spine_at(0.78), 'Spine2')
bone('Neck', spine_at(0.94), 'Chest')
bone('Head', HEAD_PIV, 'Neck')
bone('Jaw', JAW_PIV, 'Head')
for i, (nm, s) in enumerate((('L', 1), ('R', -1))):
    bone('Ear' + nm, A.EAR_BASES[i], 'Head')
    f = LJ[('F', s)]
    bone('Scapula' + nm, f[0], 'Chest')
    bone('Arm' + nm, f[1], 'Scapula' + nm)
    bone('Forearm' + nm, f[2], 'Arm' + nm)
    bone('Hand' + nm, f[3], 'Forearm' + nm)
    h = LJ[('H', s)]
    bone('Thigh' + nm, h[0], 'Hips')
    bone('Shin' + nm, h[1], 'Thigh' + nm)
    bone('Foot' + nm, h[2], 'Shin' + nm)
    bone('Toes' + nm, h[3], 'Foot' + nm)
bone('Tail', A.SACRUM, 'Hips')

CHEST_C = A.P3(0, A.ph(640, 262))
SEGS = {
    'Hips': [(A.SACRUM - np.array([0, 0.02, 0]), HIP_MID)],
    'Spine1': [(spine_at(0.12), spine_at(0.42))],
    'Spine2': [(spine_at(0.42), spine_at(0.66))],
    'Chest': [(spine_at(0.66), spine_at(0.86)), (CHEST_C + np.array([0, 0.04, -0.02]), CHEST_C + np.array([0, -0.08, 0.03]))],
    'Neck': [(spine_at(0.86), HEAD_PIV)],
    'Head': [(HEAD_PIV, A.NOSE)],
    'Jaw': [(JAW_PIV, CHIN)],
    'Tail': [(A.SACRUM, A.PUFF_C)],
}
for i, (nm, s) in enumerate((('L', 1), ('R', -1))):
    SEGS['Ear' + nm] = [(A.EAR_BASES[i], A.EAR_BASES[i] + A.EAR_DIRS[i] * 0.09)]
    f = LJ[('F', s)]
    SEGS['Scapula' + nm] = [(f[0], f[1])]
    SEGS['Arm' + nm] = [(f[1], f[2])]
    SEGS['Forearm' + nm] = [(f[2], f[3])]
    SEGS['Hand' + nm] = [(f[3], f[4])]
    h = LJ[('H', s)]
    hams = [c for k, cs in A.limb_cones(POSE) if k == ('H', s) for c in cs][-1]
    SEGS['Thigh' + nm] = [(h[0], h[1]), (hams[0], hams[1])]
    SEGS['Shin' + nm] = [(h[1], h[2])]
    SEGS['Foot' + nm] = [(h[2], h[3])]
    SEGS['Toes' + nm] = [(h[3], h[4])]

REGION_BONES = {
    'torso': {'Hips': 1, 'Spine1': 1, 'Spine2': 1, 'Chest': 1, 'Neck': 1, 'ScapulaL': 0.8, 'ScapulaR': 0.8,
              'ThighL': 0.35, 'ThighR': 0.35},
    'head': {'Head': 1, 'Neck': 0.35},
    'tail': {'Tail': 1, 'Hips': 0.25},
}
for nm, s in (('L', 1), ('R', -1)):
    REGION_BONES[('H', s)] = {'Thigh' + nm: 1, 'Shin' + nm: 1, 'Foot' + nm: 1, 'Toes' + nm: 1, 'Hips': 0.3}
    REGION_BONES[('F', s)] = {'Scapula' + nm: 1, 'Arm' + nm: 1, 'Forearm' + nm: 1, 'Hand' + nm: 1, 'Chest': 0.3}


def seg_dist(P, a, b):
    ab = b - a
    t = np.clip(((P - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
    return np.linalg.norm(P - (a + t[:, None] * ab), axis=1)


# ============================================================================================ mesh
def build_mesh(eyes):
    sdf = A.body_sdf(POSE, eyes)
    h = OPT['h']
    nx = int(math.ceil(0.235 / h))
    bmin = np.array([-nx * h, -0.03, -0.4])
    bmax = np.array([nx * h, 0.735, 0.47])
    log('surface nets h=%.4f' % h)
    m = rlib.surface_nets(sdf, bmin, bmax, h, relax_iters=1)
    log('raw mesh: %d verts, %d tris' % (len(m.V), m.tri_count()))
    # Decimate in two passes. Blender's vertex-group weighting acts like an on/off switch, so: an unweighted pass
    # (error-driven: the face, ears and paws keep their natural share), then the head + ears fully protected while
    # the body is reduced to the budget. (Symmetric collapse flips hundreds of faces on this mesh: not used.)
    tris = rlib.Mesh(m.V, [(f[0], f[1], f[2]) for f in m.F] + [(f[0], f[2], f[3]) for f in m.F])
    mid = rlib.bl_decimate(tris, target_tris=OPT['tris'] * 3, symmetric=False)
    V = mid.V
    imp = np.maximum(smoothstep(0.03, 0.0, A.head_skin_sdf(V) - 0.015), smoothstep(0.02, 0.0, A.ears_sdf(V) - 0.008))
    dm = rlib.bl_decimate(mid, target_tris=OPT['tris'], symmetric=False, weights=(imp > 0.5).astype(float), protect=1.0)
    dm.V = rlib.sdf_project(sdf, dm.V, 2, 1e-3)
    cen = np.array([dm.V[list(f)].mean(axis=0) for f in dm.F])
    nh = int((A.head_skin_sdf(cen) < 0.02).sum())
    log('decimated: %d verts, %d tris (head %d), lowest point y=%.4f' % (len(dm.V), dm.tri_count(), nh, dm.V[:, 1].min()))
    N = rlib.sdf_grad(sdf, dm.V, 1e-3)
    N = N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
    return dm, N, sdf


# ============================================================================================ skin weights
def skin_weights(V, F, eyes):
    names = list(BONES)
    bi = {n: i for i, n in enumerate(names)}
    regs = A.region_sdfs(POSE)
    keys = ['torso', 'head', 'tail', 'ears'] + [k for k in regs if isinstance(k, tuple)]
    D = np.stack([regs[k](V) for k in keys], axis=1)
    member = np.exp(-(D - D.min(axis=1, keepdims=True)) / 0.009)
    member /= member.sum(axis=1, keepdims=True)
    W = np.zeros((len(V), len(names)))
    dist = {b: np.min(np.stack([seg_dist(V, a, c) for a, c in SEGS[b]], axis=1), axis=1) for b in SEGS}
    for ri, k in enumerate(keys):
        m = member[:, ri]
        sel = m > 1e-4
        if not sel.any():
            continue
        if k == 'ears':
            left = (V[sel, 0] > 0).astype(float)
            W[sel, bi['EarL']] += m[sel] * left
            W[sel, bi['EarR']] += m[sel] * (1 - left)
            continue
        bones = REGION_BONES[k]
        w = np.stack([bones[b] / (dist[b][sel] + 0.012) ** 3 for b in bones], axis=1)
        w /= w.sum(axis=1, keepdims=True)
        for j, b in enumerate(bones):
            W[sel, bi[b]] += m[sel] * w[:, j]
    # jaw: head vertices below the line from the lips to the hinge, in front of the throat
    n = np.cross(np.array([1.0, 0, 0]), JAW_PIV - LIP)
    n /= np.linalg.norm(n)
    jaw = smoothstep(0.003, -0.004, (V - LIP) @ n) * smoothstep(0.3, 0.325, V[:, 2]) * smoothstep(0.43, 0.41, V[:, 1])
    moved = W[:, bi['Head']] * jaw
    W[:, bi['Head']] -= moved
    W[:, bi['Jaw']] += moved
    # smooth over the mesh (keeps joints soft), then top-4 + normalise
    nb = [set() for _ in range(len(V))]
    for f in F:
        for a in range(3):
            nb[f[a]].add(f[(a + 1) % 3])
            nb[f[(a + 1) % 3]].add(f[a])
    rows = np.concatenate([[i] * len(s) for i, s in enumerate(nb)]).astype(np.int64)
    cols = np.concatenate([list(s) for s in nb]).astype(np.int64)
    deg = np.array([len(s) for s in nb], dtype=float)
    for _ in range(4):
        acc = np.zeros_like(W)
        np.add.at(acc, rows, W[cols])
        W = 0.5 * W + 0.5 * acc / deg[:, None]
    order = np.argsort(-W, axis=1)
    top = order[:, :4]
    Wt = np.take_along_axis(W, top, axis=1)
    Wt = np.where(Wt < 0.01, 0, Wt)
    Wt /= Wt.sum(axis=1, keepdims=True)
    return names, top, Wt


# ============================================================================================ UVs + texture
def uv_unwrap(ob):
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(78), island_margin=0.0, area_weight=1.0, correct_aspect=True,
                             scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    # give the head's islands more texels
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    uvl = bm.loops.layers.uv.active
    bm.faces.ensure_lookup_table()
    parent = list(range(len(bm.faces)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for e in bm.edges:
        lf = e.link_faces
        if len(lf) != 2:
            continue
        f0, f1 = lf

        def uv_of(f, v):
            for l in f.loops:
                if l.vert == v:
                    return l[uvl].uv
        same = all((uv_of(f0, v) - uv_of(f1, v)).length < 1e-6 for v in e.verts)
        if same:
            a, b = find(f0.index), find(f1.index)
            if a != b:
                parent[a] = b
    groups = {}
    for f in bm.faces:
        groups.setdefault(find(f.index), []).append(f)
    scaled = 0
    for faces in groups.values():
        cen = np.mean([[*f.calc_center_median()] for f in faces], axis=0)
        cg = np.array([[cen[0], cen[2], -cen[1]]])                          # Blender -> game
        if A.head_skin_sdf(cg)[0] < 0.02 or A.ears_sdf(cg)[0] < 0.01:
            uvs = [l[uvl].uv for f in faces for l in f.loops]
            c = sum((Vector(u) for u in uvs), Vector((0, 0))) / len(uvs)
            for f in faces:
                for l in f.loops:
                    l[uvl].uv = c + (l[uvl].uv - c) * HEAD_UV_SCALE
            scaled += 1
    bm.to_mesh(me)
    bm.free()
    log('uv islands: %d (%d head islands scaled x%.1f)' % (len(groups), scaled, HEAD_UV_SCALE))
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
    bpy.ops.object.mode_set(mode='OBJECT')


def bake_texture(ob, V, N, sdf, eyes, size):
    """Rasterise every triangle in UV space, paint each texel's 3D point, dilate the islands."""
    me = ob.data
    nloops = len(me.loops)
    uv = np.zeros(nloops * 2)
    me.uv_layers.active.data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2)
    lv = np.zeros(nloops, dtype=np.int64)
    me.loops.foreach_get('vertex_index', lv)
    T = size
    pix_i, pix_P, pix_N = [], [], []
    for p in me.polygons:
        ls = list(p.loop_indices)
        for k in range(1, len(ls) - 1):
            L3 = [ls[0], ls[k], ls[k + 1]]
            t = uv[L3] * T - 0.5
            x0, y0 = np.floor(t.min(axis=0)).astype(int)
            x1, y1 = np.ceil(t.max(axis=0)).astype(int)
            x0, y0 = max(x0, 0), max(y0, 0)
            x1, y1 = min(x1, T - 1), min(y1, T - 1)
            if x1 < x0 or y1 < y0:
                continue
            xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
            px = np.stack([xs.ravel(), ys.ravel()], axis=1).astype(float)
            a, b, c = t
            den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(den) < 1e-12:
                continue
            l0 = ((b[1] - c[1]) * (px[:, 0] - c[0]) + (c[0] - b[0]) * (px[:, 1] - c[1])) / den
            l1 = ((c[1] - a[1]) * (px[:, 0] - c[0]) + (a[0] - c[0]) * (px[:, 1] - c[1])) / den
            l2 = 1 - l0 - l1
            # conservative: also texels up to ~1 px outside each edge (every triangle paints its own border texels;
            # the extrapolated 3D point is continuous across shared edges)
            e0, e1, e2 = np.linalg.norm(b - c), np.linalg.norm(c - a), np.linalg.norm(a - b)
            area2 = abs(den)
            inside = (l0 >= -1.0 * e0 / area2) & (l1 >= -1.0 * e1 / area2) & (l2 >= -1.0 * e2 / area2)
            if not inside.any():
                continue
            bc = np.stack([l0[inside], l1[inside], l2[inside]], axis=1)
            vi = lv[L3]
            pix_i.append((px[inside, 1] * T + px[inside, 0]).astype(np.int64))
            pix_P.append(bc @ V[vi])
            pix_N.append(bc @ N[vi])
    idx = np.concatenate(pix_i)
    P = np.concatenate(pix_P)
    Nn = np.concatenate(pix_N)
    Nn /= np.maximum(np.linalg.norm(Nn, axis=1, keepdims=True), 1e-9)
    idx, first = np.unique(idx, return_index=True)
    P, Nn = P[first], Nn[first]
    log('texels to paint: %d' % len(idx))
    col = np.zeros((len(idx), 3))
    for i in range(0, len(idx), 250000):
        col[i:i + 250000] = A.paint(P[i:i + 250000], eyes, Nn[i:i + 250000])
    img = np.zeros((T * T, 3))
    filled = np.zeros(T * T, dtype=bool)
    img[idx] = col
    filled[idx] = True
    img = img.reshape(T, T, 3)
    filled = filled.reshape(T, T)
    for _ in range(40):                                     # dilate the islands outward
        acc = np.zeros_like(img)
        cnt = np.zeros((T, T))
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            f = np.roll(filled, (dy, dx), axis=(0, 1))
            acc += np.roll(img, (dy, dx), axis=(0, 1)) * f[..., None]
            cnt += f
        new = (~filled) & (cnt > 0)
        if not new.any():
            break
        img[new] = acc[new] / cnt[new][:, None]
        filled |= new
    img[~filled] = img[filled].mean(axis=0)
    rgba = np.concatenate([img, np.ones((T, T, 1))], axis=2).astype(np.float32)
    im = bpy.data.images.new('JimothyFur', T, T, alpha=False)
    im.colorspace_settings.name = 'sRGB'
    im.pixels.foreach_set(rgba.ravel())
    os.makedirs(RENDER_DIR, exist_ok=True)
    im.filepath_raw = os.path.join(RENDER_DIR, 'jimothy_albedo.png')
    im.file_format = 'PNG'
    im.save()
    log('texture baked %dx%d' % (T, T))
    return im


# ============================================================================================ objects
def fur_material(image):
    mat = bpy.data.materials.new('Fur')
    try:
        mat.use_nodes = True
    except Exception:
        pass
    nt = mat.node_tree
    b = [n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'][0]
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = image
    tex.interpolation = 'Linear'
    nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.92
    for nm in ('Specular IOR Level', 'Specular'):
        if nm in b.inputs:
            b.inputs[nm].default_value = 0.3
            break
    return mat


def make_armature():
    arm = bpy.data.armatures.new('JimothyRig')
    ob = bpy.data.objects.new('Jimothy', arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for name, (head, parent) in BONES.items():
        eb = arm.edit_bones.new(name)
        eb.head = g2b(head)
        eb.tail = g2b(head) + Vector((0, 0, 0.03))
        eb.roll = 0.0
        if parent:
            eb.parent = arm.edit_bones[parent]
            eb.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


def mesh_object(name, V, F, mat, N=None, parent=None):
    me = bpy.data.meshes.new(name)
    Vb = np.stack([V[:, 0], -V[:, 2], V[:, 1]], axis=1)
    me.from_pydata(Vb.tolist(), [], [list(f) for f in F])
    if me.validate(verbose=True):
        log('mesh %s needed fixing (%d -> %d faces)' % (name, len(F), len(me.polygons)))
    me.update()
    me.materials.append(mat)
    me.polygons.foreach_set('use_smooth', np.ones(len(me.polygons), dtype=bool))
    if N is not None:
        Nb = np.stack([N[:, 0], -N[:, 2], N[:, 1]], axis=1)
        me.normals_split_custom_set_from_vertices(Nb.tolist())
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def rigid_part(name, mesh, mat, pivot, arm_ob, bone_name='Head', parent_ob=None):
    """A non-deforming part: mesh given in game space around `pivot`, object origin at the pivot."""
    V = mesh.V - pivot
    ob = mesh_object(name, V, mesh.F, mat)
    if parent_ob is not None:
        ob.parent = parent_ob
    else:
        ob.parent = arm_ob
        ob.parent_type = 'BONE'
        ob.parent_bone = bone_name
    bpy.context.view_layer.update()
    ob.matrix_world = Matrix.Translation(g2b(pivot))
    bpy.context.view_layer.update()
    return ob


def export(path, objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
              export_normals=True, export_texcoords=True, export_tangents=False, export_materials='EXPORT',
              export_image_format='JPEG', export_jpeg_quality=92, export_image_quality=92, export_skins=True,
              export_all_influences=False, export_def_bones=False, export_rest_position_armature=True,
              export_animations=False, export_attributes=True, export_extras=False, export_cameras=False,
              export_lights=False, export_vertex_color='NONE', export_morph=False)
    kw = {k: v for k, v in kw.items() if k in props}
    bpy.ops.export_scene.gltf(**kw)
    log('EXPORTED', path, os.path.getsize(path), 'bytes')


# ============================================================================================ fur calibration
def calibrate(out_dir):
    """Side-photo pose with the shell fur's visible extent added (per-vertex length, strands reach ~85 % of it, and
    sag like the game's shells), rendered with the photo-aligned orthographic camera as a transparent silhouette, so
    the outline can be laid over the reference photo. Also the bare skin."""
    eyes = A.find_eyes()
    sdf = A.body_sdf('photo2', eyes)
    m = rlib.surface_nets(sdf, np.array([-0.3, -0.05, -0.5]), np.array([0.3, 0.8, 0.52]), 0.006, relax_iters=1)
    V = m.V
    N = rlib.sdf_grad(sdf, V, 1e-3)
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
    L = A.fur_length(V, N, eyes, 'photo2') * 0.035
    h = 0.85
    Vf = V + N * (L * h)[:, None] - np.array([0, 1.0, 0]) * (L * 0.5 * h * h)[:, None]
    F = [(f[0], f[1], f[2]) for f in m.F] + [(f[0], f[2], f[3]) for f in m.F]
    clay = rlib.make_material('clay', '#8a8580', rough=0.8)
    skin = mesh_object('Skin', V, F, clay)
    fur = mesh_object('FurExtent', Vf, F, clay)
    scn = bpy.context.scene
    scn.render.engine = 'BLENDER_EEVEE'
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    scn.collection.objects.link(cam)
    scn.camera = cam
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 1200 * A.S
    zc, yc = A.ph(600, 337.5)
    cam.location = (-5, -zc, yc)
    cam.rotation_euler = (math.radians(90), 0, math.radians(-90))
    scn.render.resolution_x, scn.render.resolution_y = 1200, 675
    scn.render.film_transparent = True
    os.makedirs(out_dir, exist_ok=True)
    for ob, nm in ((fur, 'calib_fur'), (skin, 'calib_skin')):
        fur.hide_render = ob is not fur
        skin.hide_render = ob is not skin
        scn.render.filepath = os.path.join(out_dir, nm + '.png')
        bpy.ops.render.render(write_still=True)
    log('calibration renders in', out_dir)


# ============================================================================================ main
def main():
    if '--calibrate' in sys.argv:
        rlib.reset_scene()
        calibrate(os.path.join(PROJECT, 'reference', 'frames', 'calib'))
        return
    rlib.reset_scene()
    eyes = A.find_eyes()
    log('eyes', [np.round(e, 4).tolist() for e in eyes])
    for n, (p, par) in BONES.items():
        print('   bone %-9s parent %-9s at (%.3f, %.3f, %.3f)' % (n, par, *p))
    dm, N, sdf = build_mesh(eyes)
    V, F = dm.V, [tuple(f) for f in dm.F]
    furlen = A.fur_length(V, N, eyes, POSE)
    log('fur length: min %.2f max %.2f mean %.2f' % (furlen.min(), furlen.max(), furlen.mean()))
    names, top, Wt = skin_weights(V, F, eyes)
    log('skin weights done')

    arm = make_armature()
    body = mesh_object('JimothyBody', V, F, bpy.data.materials.new('_tmp'), N)
    uv_unwrap(body)
    img = bake_texture(body, V, N, sdf, eyes, OPT['tex'])
    body.data.materials.clear()
    body.data.materials.append(fur_material(img))
    at = body.data.attributes.new('_FURLEN', 'FLOAT', 'POINT')
    at.data.foreach_set('value', furlen.astype(np.float32))
    groups = {n: body.vertex_groups.new(name=n) for n in names}
    for vi in range(len(V)):
        for j in range(4):
            w = float(Wt[vi, j])
            if w > 0:
                groups[names[top[vi, j]]].add([vi], w, 'REPLACE')
    body.parent = arm
    mod = body.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm

    eye_mat = rlib.make_material('Eye', '#060505', rough=0.05)
    hl_mat = rlib.make_material('EyeHighlight', '#ffffff', rough=0.4, emission='#ffffff', emission_strength=1.0)
    nose_mat = rlib.make_material('Nose', '#161212', rough=0.3)
    parts = []
    for e, nm in zip(eyes, ('EyeL', 'EyeR')):
        eo = rigid_part(nm, rlib.ellipsoid_mesh(e, np.array([A.EYE_R] * 3), 18, 12), eye_mat, e, arm)
        g = A.nrm(np.array([np.sign(e[0]) * 0.35, 0.0, 1.0]))
        hl = e + A.nrm(g + np.array([np.sign(e[0]) * 0.25, 0.45, 0.0])) * (A.EYE_R * 0.97)
        parts += [eo, rigid_part(nm + 'Glint', rlib.ellipsoid_mesh(hl, np.array([0.0021] * 3), 8, 6), hl_mat, hl, arm,
                                 parent_ob=eo)]
    tip = A.NOSE + np.array([0.0, 0.0, 0.004])
    dirn = A.nrm(np.array([0, -0.25, 1.0]))
    p, n = rlib.sdf_raycast(sdf, tip + dirn * 0.2, -dirn, 0, 0.4, 900)
    nc = p - n * 0.009
    parts.append(rigid_part('Nose', rlib.ellipsoid_mesh(nc, np.array([0.02, 0.0155, 0.016]), 16, 10), nose_mat, nc, arm))
    tri = len(F) + sum(len(o.data.polygons) for o in parts)
    log('triangles: body %d + parts %d = %d' % (len(F), tri - len(F), tri))
    path = os.path.join(MODELS_DIR, OPT['out'] + '.glb')
    export(path, [arm, body] + parts)
    if OPT['render']:
        render_previews(arm, [body] + parts)
    log('DONE')


def render_previews(arm, objs):
    rlib.setup_preview_scene(floor_z=0.0)
    rlib.render_views(objs, os.path.join(RENDER_DIR, 'jimothy_views.png'))
    rlib.render_views(objs, os.path.join(RENDER_DIR, 'jimothy_face.png'), views=('front', 'three_quarter'),
                      focus=np.array([0, -0.36, 0.45]), radius=0.16, size=640, elevation=4)
    # a test pose: walking step, head turned, ear back, tail up, jaw open
    pb = arm.pose.bones
    pose = {'ArmL': (-0.6, 0, 0), 'ForearmL': (0.9, 0, 0), 'HandL': (-0.8, 0, 0), 'ArmR': (0.35, 0, 0),
            'ThighL': (0.45, 0, 0), 'ShinL': (-0.5, 0, 0), 'ThighR': (-0.4, 0, 0), 'ShinR': (0.7, 0, 0), 'FootR': (-0.6, 0, 0),
            'Head': (0.0, 0.5, 0.15), 'EarL': (-0.8, 0, 0), 'Tail': (0.6, 0.3, 0), 'Jaw': (0.25, 0, 0),
            'Spine2': (0.1, 0.1, 0), 'Chest': (0.05, 0.15, 0)}
    for n, (x, y, z) in pose.items():
        b = pb[n]
        b.rotation_mode = 'XYZ'
        # bones point up with roll 0, so each bone's local frame IS the game/model frame
        b.rotation_euler = (x, y, z)
    bpy.context.view_layer.update()
    rlib.render_views(objs, os.path.join(RENDER_DIR, 'jimothy_posed.png'))


main()
