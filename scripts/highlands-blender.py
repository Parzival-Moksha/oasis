# scripts/highlands-blender.py
# Run via: blender --background --python scripts/highlands-blender.py -- <input_root> <output_dir>
# Imports each SM_*.fbx, manually wires textures from sibling TextureMaps/ folder
# (FBX import alone loses material->texture bindings), exports as GLB with WebP.

import bpy
import sys
import os
import glob
import re

argv = sys.argv
if '--' not in argv:
    print('usage: blender --background --python this.py -- <input_root> <output_dir>')
    sys.exit(1)
args = argv[argv.index('--') + 1:]
if len(args) < 2:
    print('need input_root and output_dir')
    sys.exit(1)

input_root = args[0]
output_dir = args[1]

os.makedirs(output_dir, exist_ok=True)

fbx_files = sorted(glob.glob(os.path.join(input_root, '**', 'SM_*.fbx'), recursive=True))
print(f'[highlands] found {len(fbx_files)} FBX files')


def find_texture_maps(fbx_path):
    """Return dict mapping subject name -> {channel: filepath}.
    e.g. for Barracks/TextureMaps/T_Barracks_diffuse.png returns
    { 'barracks': { 'diffuse': '...', 'normal': '...', ... } }
    """
    fbx_dir = os.path.dirname(fbx_path)
    tex_dir = os.path.join(fbx_dir, 'TextureMaps')
    out = {}
    if not os.path.isdir(tex_dir):
        return out
    for name in os.listdir(tex_dir):
        if not name.lower().endswith('.png'):
            continue
        m = re.match(r'T_(.+?)_(diffuse|normal|roughness|metalness|alpha)\.png$', name, re.IGNORECASE)
        if not m:
            continue
        subject = m.group(1).lower()
        channel = m.group(2).lower()
        out.setdefault(subject, {})[channel] = os.path.join(tex_dir, name)
    return out


def material_subject(mat_name):
    """M_TowerW -> towerw; M_Barracks -> barracks; falls back to lowercased name."""
    n = mat_name
    if n.startswith('M_'):
        n = n[2:]
    return n.lower()


def best_subject_match(mat_subject, texture_map):
    """Pick the best texture-subject for a given material. Exact match wins,
    otherwise prefix/contains match. Returns (subject_key, channel_dict) or None."""
    if not texture_map:
        return None
    if mat_subject in texture_map:
        return (mat_subject, texture_map[mat_subject])
    # Prefix match (e.g. M_Tower vs subject 'tower')
    for key in texture_map:
        if mat_subject.startswith(key) or key.startswith(mat_subject):
            return (key, texture_map[key])
    # Single subject? assume the material maps to it.
    if len(texture_map) == 1:
        only = next(iter(texture_map))
        return (only, texture_map[only])
    return None


def wire_pbr_nodes(mat, channels):
    """Replace material's nodes with a PBR setup using the given channel images."""
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    output = nodes.new('ShaderNodeOutputMaterial')
    output.location = (400, 0)
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.location = (100, 0)
    links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])

    def load_image(path):
        try:
            img = bpy.data.images.load(path, check_existing=True)
            return img
        except Exception as e:
            print(f'[highlands] failed to load {path}: {e}')
            return None

    if 'diffuse' in channels:
        img = load_image(channels['diffuse'])
        if img:
            tex = nodes.new('ShaderNodeTexImage')
            tex.image = img
            tex.location = (-400, 200)
            links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
            # Force OPAQUE blend. The pack ships alpha masks but compressed WebP
            # alpha is noisy under CLIP thresholding -> see-through speckles on
            # solid buildings. These models are all solid; ignore alpha.
            mat.blend_method = 'OPAQUE'

    if 'roughness' in channels:
        img = load_image(channels['roughness'])
        if img:
            img.colorspace_settings.name = 'Non-Color'
            tex = nodes.new('ShaderNodeTexImage')
            tex.image = img
            tex.location = (-400, -100)
            links.new(tex.outputs['Color'], bsdf.inputs['Roughness'])

    if 'metalness' in channels:
        img = load_image(channels['metalness'])
        if img:
            img.colorspace_settings.name = 'Non-Color'
            tex = nodes.new('ShaderNodeTexImage')
            tex.image = img
            tex.location = (-400, -250)
            links.new(tex.outputs['Color'], bsdf.inputs['Metallic'])

    if 'normal' in channels:
        img = load_image(channels['normal'])
        if img:
            img.colorspace_settings.name = 'Non-Color'
            tex = nodes.new('ShaderNodeTexImage')
            tex.image = img
            tex.location = (-600, -550)
            normal_map = nodes.new('ShaderNodeNormalMap')
            normal_map.location = (-200, -550)
            links.new(tex.outputs['Color'], normal_map.inputs['Color'])
            links.new(normal_map.outputs['Normal'], bsdf.inputs['Normal'])


for fbx_path in fbx_files:
    rel = os.path.relpath(fbx_path, input_root)
    name = os.path.basename(fbx_path).replace('SM_', '').replace('.fbx', '').lower()
    out_path = os.path.join(output_dir, f'{name}.glb')
    print(f'[highlands] {rel} -> {out_path}')

    bpy.ops.wm.read_factory_settings(use_empty=True)

    try:
        bpy.ops.import_scene.fbx(filepath=fbx_path, use_image_search=True)
    except Exception as e:
        print(f'[highlands] import failed for {fbx_path}: {e}')
        continue

    texture_map = find_texture_maps(fbx_path)

    # Skip helper/collision meshes (UCX_*) from export — they have no materials
    # and inflate file size with duplicate geometry.
    for obj in list(bpy.data.objects):
        if obj.type == 'MESH' and obj.name.upper().startswith('UCX_'):
            try:
                bpy.data.objects.remove(obj, do_unlink=True)
            except Exception:
                pass

    for mat in bpy.data.materials:
        if mat.users == 0:
            continue
        subject = material_subject(mat.name)
        match = best_subject_match(subject, texture_map)
        if not match:
            print(f'[highlands]   no textures for material {mat.name} (subject "{subject}")')
            continue
        key, channels = match
        print(f'[highlands]   wiring material {mat.name} -> {key}: {sorted(channels.keys())}')
        wire_pbr_nodes(mat, channels)

    try:
        bpy.ops.export_scene.gltf(
            filepath=out_path,
            export_format='GLB',
            export_image_format='WEBP',
            export_image_quality=72,
            export_apply=True,
            export_yup=True,
        )
    except Exception as e:
        print(f'[highlands] export failed for {out_path}: {e}')
        continue

print('[highlands] done')
