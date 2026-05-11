# scripts/megakit-blender.py
# Run via: blender --background --python scripts/megakit-blender.py -- <input_root> <output_dir>
# Walks input_root recursively for *.fbx, exports each as a sibling-named .glb in
# output_dir. Image search is recursive so shared Textures/ folders attach.

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


def slug(name):
    name = re.sub(r'[^A-Za-z0-9]+', '_', name)
    return name.strip('_').lower() or 'asset'


fbx_files = sorted(glob.glob(os.path.join(input_root, '**', '*.fbx'), recursive=True))
print(f'[megakit] found {len(fbx_files)} FBX files under {input_root}')

ok = 0
fail = 0

for fbx_path in fbx_files:
    base = os.path.splitext(os.path.basename(fbx_path))[0]
    out_path = os.path.join(output_dir, f'{slug(base)}.glb')

    if os.path.exists(out_path):
        ok += 1
        continue

    bpy.ops.wm.read_factory_settings(use_empty=True)
    try:
        bpy.ops.import_scene.fbx(filepath=fbx_path, use_image_search=True)
    except Exception as e:
        print(f'[megakit] import failed for {fbx_path}: {e}')
        fail += 1
        continue

    # Drop UCX / collision helpers and lights/cameras carried by the FBX.
    for obj in list(bpy.data.objects):
        if obj.name.upper().startswith('UCX_'):
            try: bpy.data.objects.remove(obj, do_unlink=True)
            except Exception: pass
        elif obj.type in ('LIGHT', 'CAMERA'):
            try: bpy.data.objects.remove(obj, do_unlink=True)
            except Exception: pass

    try:
        bpy.ops.export_scene.gltf(
            filepath=out_path,
            export_format='GLB',
            export_image_format='WEBP',
            export_image_quality=72,
            export_apply=True,
            export_yup=True,
        )
        ok += 1
    except Exception as e:
        print(f'[megakit] export failed for {out_path}: {e}')
        fail += 1

print(f'[megakit] done. ok={ok} fail={fail}')
