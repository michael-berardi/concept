#!/usr/bin/env python3
"""Inspects a screenshot PNG: dimensions, mean brightness, distinct colors.
Prints a JSON verdict; used to catch blank/failed window captures.
Usage: inspect-screenshot.py <image> [<image> ...]"""
import json
import struct
import sys
import zlib


def read_png(path):
    with open(path, "rb") as f:
        data = f.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    pos = 8
    width = height = None
    bit_depth = color_type = None
    idat = b""
    while pos < len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        chunk = data[pos + 4:pos + 8]
        payload = data[pos + 8:pos + 8 + length]
        if chunk == b"IHDR":
            width, height, bit_depth, color_type = struct.unpack(">IIBB", payload[:10])
        elif chunk == b"IDAT":
            idat += payload
        elif chunk == b"IEND":
            break
        pos += 12 + length
    if width is None:
        return None
    raw = zlib.decompress(idat)
    channels = {0: 1, 2: 3, 4: 2, 6: 4}[color_type]
    stride = width * channels
    # Un-filter (support filter types 0-4)
    out = bytearray(stride * height)
    prev = bytearray(stride)
    pos = 0
    for y in range(height):
        ftype = raw[pos]
        pos += 1
        line = bytearray(raw[pos:pos + stride])
        pos += stride
        if ftype == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif ftype == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ftype == 3:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return width, height, channels, bytes(out)


def stats(path):
    image = read_png(path)
    if image is None:
        return {"path": path, "ok": False, "reason": "not a PNG"}
    width, height, channels, pixels = image
    total = 0
    count = 0
    colors = set()
    # Sample every 4th pixel for speed.
    step = channels * 4
    for i in range(0, len(pixels) - channels, step):
        r = pixels[i]
        g = pixels[i + 1] if channels >= 3 else r
        b = pixels[i + 2] if channels >= 3 else r
        total += (r + g + b) / 3
        count += 1
        colors.add((r >> 3, g >> 3, b >> 3))  # 5 bits per channel buckets
    mean = total / max(count, 1)
    return {
        "path": path,
        "ok": True,
        "width": width,
        "height": height,
        "meanBrightness": round(mean, 1),
        "distinctColors5bit": len(colors),
        "verdict": (
            "good" if len(colors) > 40 else
            "suspicious-low-variation" if len(colors) > 8 else
            "likely-blank-or-capture-failed"
        ),
    }


if __name__ == "__main__":
    print(json.dumps([stats(p) for p in sys.argv[1:]], indent=2))
