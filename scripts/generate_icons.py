"""Iconos propios de ENFOCA; solo biblioteca estándar. Ejecutar desde el proyecto."""
from pathlib import Path
import math
import struct
import zlib

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "assets" / "img"
BACKGROUND = (16, 27, 43)
MINT = (120, 223, 177)


def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)


def draw(size):
    rows = []
    # Sobremuestreo 4x para contornos suaves, sin fuentes ni imágenes externas.
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            coverage = 0
            for sy in range(4):
                for sx in range(4):
                    dx = (x + (sx + .5) / 4) * 512 / size - 256
                    dy = (y + (sy + .5) / 4) * 512 / size - 256
                    radius = math.hypot(dx, dy)
                    coverage += abs(radius - 138) <= 11 or abs(radius - 62) <= 9 or radius <= 10
            row.extend(round(a + (b - a) * coverage / 16) for a, b in zip(BACKGROUND, MINT))
        rows.append(row)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b"")


if __name__ == "__main__":
    if ROOT.name != "ENFOCA":
        raise RuntimeError("Este generador debe estar dentro de ENFOCA")
    DEST.mkdir(parents=True, exist_ok=True)
    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><title>ENFOCA</title><path fill="#101B2B" d="M0 0h512v512H0z"/><g fill="none" stroke="#78DFB1"><circle cx="256" cy="256" r="138" stroke-width="22"/><circle cx="256" cy="256" r="62" stroke-width="18"/></g><circle cx="256" cy="256" r="10" fill="#78DFB1"/></svg>\n'
    (DEST / "enfoca-icon.svg").write_text(svg, encoding="utf-8")
    for size, name in [(192, "icon-192.png"), (512, "icon-512.png"), (180, "apple-touch-icon.png")]:
        (DEST / name).write_bytes(draw(size))
        print(f"Creado {name}: {size} x {size}")
