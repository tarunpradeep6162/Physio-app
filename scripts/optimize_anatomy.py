#!/usr/bin/env python3
"""Pack visual-only normals in the pinned Body Explorer GLBs to signed bytes.

This does not alter positions, triangle indices, mesh names, or anatomy selection.
KHR_mesh_quantization permits normalized BYTE normals. Keep source attribution.
"""
import argparse
import json
import struct
from pathlib import Path


def unpack_glb(path: Path):
    raw = path.read_bytes()
    magic, version, length = struct.unpack_from('<4sII', raw)
    if magic != b'glTF' or version != 2 or length != len(raw):
        raise ValueError(f'Invalid GLB: {path}')
    json_len, json_type = struct.unpack_from('<I4s', raw, 12)
    if json_type != b'JSON':
        raise ValueError('Missing JSON chunk')
    pos = 20 + json_len
    bin_len, bin_type = struct.unpack_from('<I4s', raw, pos)
    if bin_type != b'BIN\0':
        raise ValueError('Missing binary chunk')
    return json.loads(raw[20:pos]), raw[pos + 8:pos + 8 + bin_len]


def optimize(source: Path, output: Path):
    doc, binary = unpack_glb(source)
    normals = {primitive['attributes']['NORMAL']
               for mesh in doc['meshes'] for primitive in mesh['primitives']
               if 'NORMAL' in primitive['attributes']}
    by_view = {doc['accessors'][index]['bufferView']: index for index in normals}
    packed = bytearray()
    saved = 0
    for index, view in enumerate(doc['bufferViews']):
        accessor_index = by_view.get(index)
        old_start = view.get('byteOffset', 0)
        old_length = view['byteLength']
        if accessor_index is None:
            chunk = binary[old_start:old_start + old_length]
        else:
            accessor = doc['accessors'][accessor_index]
            if accessor['componentType'] != 5126 or accessor['type'] != 'VEC3' or accessor.get('byteOffset', 0) != 0:
                raise ValueError(f'Unsupported normal accessor {accessor_index}')
            stride = view.get('byteStride', 12)
            chunk = bytearray()
            for i in range(accessor['count']):
                values = struct.unpack_from('<3f', binary, old_start + i * stride)
                chunk.extend(struct.pack('<3bB', *(round(max(-1., min(1., v)) * 127) for v in values), 0))
            accessor['componentType'] = 5120
            accessor['normalized'] = True
            accessor.pop('min', None)
            accessor.pop('max', None)
            view['byteStride'] = 4
            saved += old_length - len(chunk)
        view['byteOffset'] = len(packed)
        view['byteLength'] = len(chunk)
        packed.extend(chunk)
        packed.extend(b'\0' * (-len(packed) % 4))
    doc['buffers'][0]['byteLength'] = len(packed)
    doc.setdefault('extensionsUsed', []).append('KHR_mesh_quantization')
    json_bytes = json.dumps(doc, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    json_bytes += b' ' * (-len(json_bytes) % 4)
    length = 12 + 8 + len(json_bytes) + 8 + len(packed)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(struct.pack('<4sII', b'glTF', 2, length)
                       + struct.pack('<I4s', len(json_bytes), b'JSON') + json_bytes
                       + struct.pack('<I4s', len(packed), b'BIN\0') + packed)
    check, _ = unpack_glb(output)
    assert len(check['meshes']) == len(doc['meshes'])
    assert len(check['accessors']) == len(doc['accessors'])
    print(f'{source.name}: {source.stat().st_size:,} -> {output.stat().st_size:,} bytes; normals saved {saved:,}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    optimize(args.source, args.output)
