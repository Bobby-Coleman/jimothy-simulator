"""
validate_glb.py - sanity-check exported GLBs.

For each file:
  1. parses the GLB JSON chunk directly (what three.js will see): node hierarchy + local
     transforms, per-mesh primitives / attributes (COLOR_0!) / materials / triangle counts,
     material names + alpha modes;
  2. re-imports it into an empty Blender scene and prints node names, parents, world pivots,
     triangle counts and world bounding boxes (converted back to game space: +Y up, +Z forward);
  3. optionally renders a preview of the RE-IMPORTED model (renders/<name>_glb.png).

Usage:
  blender.exe -b --factory-startup -P tools/blender/validate_glb.py -- [--render] file1.glb [file2.glb ...]
  (with no files: validates every .glb in public/assets/models)
"""
import json
import math
import os
import struct
import sys

sys.dont_write_bytecode = True   # keep tools/blender free of __pycache__
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402
import bpy  # noqa: E402

import rlib  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(os.path.dirname(HERE))
MODELS_DIR = os.path.join(PROJECT, 'public', 'assets', 'models')
RENDER_DIR = os.path.join(HERE, 'renders')


def read_glb_json(path):
    with open(path, 'rb') as f:
        data = f.read()
    magic, version, length = struct.unpack_from('<4sII', data, 0)
    assert magic == b'glTF', 'not a GLB'
    clen, ctype = struct.unpack_from('<I4s', data, 12)
    assert ctype == b'JSON'
    js = json.loads(data[20:20 + clen].decode('utf-8'))
    return js, length


def quat_to_mat(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def node_local(n):
    M = np.eye(4)
    if 'matrix' in n:
        M = np.array(n['matrix']).reshape(4, 4).T
        return M
    R = quat_to_mat(n.get('rotation', [0, 0, 0, 1]))
    S = np.diag(n.get('scale', [1, 1, 1]))
    M[:3, :3] = R @ S
    M[:3, 3] = n.get('translation', [0, 0, 0])
    return M


def report_json(path):
    js, length = read_glb_json(path)
    print('=' * 100)
    print('FILE', os.path.basename(path), '%d bytes' % length)
    nodes = js.get('nodes', [])
    meshes = js.get('meshes', [])
    accessors = js.get('accessors', [])
    mats = js.get('materials', [])
    print('materials:')
    for i, m in enumerate(mats):
        pbr = m.get('pbrMetallicRoughness', {})
        print('   [%d] %-14s base=%s rough=%s metal=%s alpha=%s ext=%s emissive=%s' % (
            i, m.get('name'), [round(v, 3) for v in pbr.get('baseColorFactor', [1, 1, 1, 1])],
            pbr.get('roughnessFactor', 1), pbr.get('metallicFactor', 1), m.get('alphaMode', 'OPAQUE'),
            list(m.get('extensions', {}).keys()), m.get('emissiveFactor')))
    children = set(c for n in nodes for c in n.get('children', []))
    roots = [i for i in range(len(nodes)) if i not in children]
    total = 0
    uses_color = []
    world_lo = np.array([1e9] * 3)
    world_hi = -world_lo

    def rec(i, parentM, depth):
        nonlocal total, world_lo, world_hi
        n = nodes[i]
        L = node_local(n)
        W = parentM @ L
        tris = 0
        info = ''
        if 'mesh' in n:
            me = meshes[n['mesh']]
            prims = []
            for p in me['primitives']:
                acc = accessors[p['indices']] if 'indices' in p else accessors[p['attributes']['POSITION']]
                t = acc['count'] // 3
                tris += t
                attrs = sorted(p['attributes'].keys())
                if 'COLOR_0' in attrs:
                    uses_color.append(n.get('name'))
                pos = accessors[p['attributes']['POSITION']]
                lo, hi = np.array(pos['min']), np.array(pos['max'])
                for cx in (lo[0], hi[0]):
                    for cy in (lo[1], hi[1]):
                        for cz in (lo[2], hi[2]):
                            w = W @ np.array([cx, cy, cz, 1.0])
                            world_lo = np.minimum(world_lo, w[:3])
                            world_hi = np.maximum(world_hi, w[:3])
                prims.append('%s[%s]' % (mats[p['material']]['name'] if 'material' in p else '-', ','.join(attrs)))
            info = ' tris=%d prims=%s' % (tris, ' '.join(prims))
        total += tris
        t = W[:3, 3]
        r = n.get('rotation')
        rtxt = '' if r is None else ' rot(xyzw)=(%.3f,%.3f,%.3f,%.3f)' % tuple(r)
        print('   %s%-10s local=(%.3f, %.3f, %.3f)%s world=(%.3f, %.3f, %.3f)%s' % (
            '  ' * depth, n.get('name'), *L[:3, 3], rtxt, *t, info))
        for c in n.get('children', []):
            rec(c, W, depth + 1)
    print('node hierarchy (glTF space: +Y up, +Z forward):')
    for r in roots:
        rec(r, np.eye(4), 0)
    print('TOTAL TRIANGLES (glTF):', total)
    print('meshes with COLOR_0:', ', '.join(sorted(set(uses_color))) or 'none')
    print('world bbox min=(%.3f, %.3f, %.3f) max=(%.3f, %.3f, %.3f)' % (*world_lo, *world_hi))
    return js


def reimport(path, render=False):
    rlib.reset_scene()
    bpy.ops.import_scene.gltf(filepath=path)
    objs = list(bpy.context.scene.objects)
    print('re-import: %d objects' % len(objs))
    dg = bpy.context.evaluated_depsgraph_get()
    total = 0
    lo = np.array([1e9] * 3)
    hi = -lo
    for o in sorted(objs, key=lambda o: o.name):
        wp = o.matrix_world.translation
        g = (wp.x, wp.z, -wp.y)  # blender -> game
        tris = 0
        cols = ''
        if o.type == 'MESH':
            ev = o.evaluated_get(dg)
            me = ev.to_mesh()
            me.calc_loop_triangles()
            tris = len(me.loop_triangles)
            cols = ','.join(a.name for a in me.color_attributes)
            mw = o.matrix_world
            for v in me.vertices:
                w = mw @ v.co
                gw = np.array([w.x, w.z, -w.y])
                lo = np.minimum(lo, gw)
                hi = np.maximum(hi, gw)
            ev.to_mesh_clear()
        total += tris
        print('   %-12s parent=%-10s type=%-5s pivot=(%.3f, %.3f, %.3f) tris=%-5d mats=%s colors=%s' % (
            o.name, o.parent.name if o.parent else '-', o.type, g[0], g[1], g[2], tris,
            ','.join(s.material.name for s in o.material_slots if s.material) if o.type == 'MESH' else '',
            cols))
    print('RE-IMPORT TOTAL TRIS:', total)
    print('RE-IMPORT game-space bbox min=(%.3f, %.3f, %.3f) max=(%.3f, %.3f, %.3f)' % (*lo, *hi))
    if render:
        # make sure imported materials display vertex colours (importer may leave COLOR_0 unused)
        for mat in bpy.data.materials:
            if not mat.node_tree:
                continue
            bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            if bsdf is None:
                continue
            linked = bsdf.inputs['Base Color'].is_linked
            users = [o for o in objs if o.type == 'MESH' and any(s.material == mat for s in o.material_slots)]
            has_col = any(len(o.data.color_attributes) for o in users)
            if has_col and not linked:
                vc = mat.node_tree.nodes.new('ShaderNodeVertexColor')
                vc.layer_name = users[0].data.color_attributes[0].name
                mat.node_tree.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
                print('   (render) hooked vertex colours into', mat.name)
        name = os.path.splitext(os.path.basename(path))[0]
        floor = float(lo[1])
        rlib.setup_preview_scene(floor_z=floor)
        meshes = [o for o in objs if o.type == 'MESH']
        rlib.render_views(meshes, os.path.join(RENDER_DIR, name + '_glb.png'), size=400, cols=4)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    render = '--render' in argv
    files = [a for a in argv if a.endswith('.glb')]
    if not files:
        files = sorted(os.path.join(MODELS_DIR, f) for f in os.listdir(MODELS_DIR) if f.endswith('.glb'))
    for f in files:
        if not os.path.isabs(f):
            f = os.path.join(PROJECT, f)
        report_json(f)
        reimport(f, render)


if __name__ == '__main__':
    main()
