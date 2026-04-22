#!/usr/bin/env python3
"""Generate icons/icon{16,48,128}.png — no external dependencies required."""
import struct, zlib, os

def make_chunk(chunk_type, data):
    chunk_len = struct.pack('>I', len(data))
    chunk_data = chunk_type + data
    chunk_crc = struct.pack('>I', zlib.crc32(chunk_data) & 0xffffffff)
    return chunk_len + chunk_data + chunk_crc

def write_png(filename, width, height, pixels_rgba):
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr_data = struct.pack('>II', width, height) + bytes([8, 6, 0, 0, 0])
    raw = b''
    for y in range(height):
        raw += b'\x00'
        for x in range(width):
            idx = (y * width + x) * 4
            raw += bytes(pixels_rgba[idx:idx+4])
    compressed = zlib.compress(raw, 9)
    with open(filename, 'wb') as f:
        f.write(sig)
        f.write(make_chunk(b'IHDR', ihdr_data))
        f.write(make_chunk(b'IDAT', compressed))
        f.write(make_chunk(b'IEND', b''))

def in_heart(px, py, cx, cy, r):
    x = (px - cx) / r
    y = -(py - cy) / r
    return (x*x + y*y - 1)**3 - x*x*y*y*y <= 0

def make_heart_pixels(size):
    pixels = []
    cx, cy = size / 2.0, size / 2.0 + size * 0.04
    r = size * 0.44
    hr, hg, hb = 176, 32, 32  # #b02020
    for y in range(size):
        for x in range(size):
            if in_heart(x, y, cx, cy, r):
                pixels.extend([hr, hg, hb, 255])
            else:
                pixels.extend([0, 0, 0, 0])
    return bytes(pixels)

os.makedirs(os.path.join(os.path.dirname(__file__), '..', 'icons'), exist_ok=True)
out_dir = os.path.join(os.path.dirname(__file__), '..', 'icons')
for size in [16, 48, 128]:
    path = os.path.join(out_dir, f'icon{size}.png')
    write_png(path, size, size, make_heart_pixels(size))
    print(f'  {path}')