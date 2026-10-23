"""Editable, deterministic demo artwork. Requires Pillow and numpy; no reference-photo crop."""
from pathlib import Path
import argparse
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

parser = argparse.ArgumentParser()
parser.add_argument("output", type=Path)
parser.add_argument("--font", type=Path, required=True, help="Noto Serif CJK Regular TTC")
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(231023)
W, H = 2048, 1280


def font(size):
    return ImageFont.truetype(str(args.font), size, index=2)


def paper(base, aged=False):
    y, x = np.mgrid[0:H, 0:W]
    edge = np.minimum.reduce([x / W, (W - x) / W, y / H, (H - y) / H])
    grain = rng.normal(0, 2.1, (H, W))
    cloud = Image.fromarray(rng.integers(0, 255, (32, 52), dtype=np.uint8)).resize((W, H), Image.Resampling.BICUBIC).filter(ImageFilter.GaussianBlur(24))
    values = grain + (np.asarray(cloud).astype(float) - 127) * (0.13 if aged else 0.04)
    values -= np.exp(-edge * 28) * (23 if aged else 8)
    data = np.clip(np.array(base)[None, None, :] + values[:, :, None], 0, 255).astype(np.uint8)
    image = Image.fromarray(data)
    draw = ImageDraw.Draw(image)
    for _ in range(2800 if aged else 1100):
        px, py = int(rng.integers(W)), int(rng.integers(H))
        length = int(rng.integers(2, 12))
        shade = tuple(int(v) for v in np.clip(np.array(base) - rng.integers(12, 36), 0, 255))
        draw.line([(px, py), (px + length, py + int(rng.integers(-2, 3)))], fill=shade, width=1)
    return image


def save(image, name):
    if name.endswith("normal"):
        image.save(args.output / f"{name}.png", optimize=True)
    else:
        image.save(args.output / f"{name}.jpg", quality=95, subsampling=0, optimize=True)


for side in ["a", "b"]:
    image = paper((222, 207, 174))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((16, 16, W - 16, H - 16), 34, outline=(128, 109, 78), width=5)
    for y in [100, 340]:
        draw.line((110, y, 1938, y), fill=(159, 139, 105), width=2)
    draw.text((1024, 208), "手录磁带", font=font(200), fill=(32, 27, 21), anchor="mm")
    draw.text((130, 680), side.upper(), font=font(190), fill=(32, 31, 27), anchor="mm")
    draw.rectangle((24, 1005, 2024, 1040), fill=(71, 83, 66))
    draw.rectangle((24, 1065, 2024, 1170), fill=(152, 47, 36))
    draw.text((1888, 1116), "60", font=font(136), fill=(237, 222, 191), anchor="mm")
    # The central opening is geometry, not a printed image of reels.
    save(image, f"cassette-label-{side}")

ticket = paper((223, 191, 145), aged=True)
draw = ImageDraw.Draw(ticket)
ink = (51, 42, 31)
draw.text((112, 150), "北京站", font=font(113), fill=ink, anchor="lm")
draw.text((500, 151), "A6890", font=font(102), fill=(172, 101, 62), anchor="lm")
draw.text((1910, 150), "K27次", font=font(117), fill=ink, anchor="rm")
draw.text((230, 460), "北京", font=font(171), fill=ink, anchor="lm")
draw.text((1130, 460), "上海", font=font(171), fill=ink, anchor="lm")
draw.line((720, 467, 1070, 467), fill=ink, width=6)
draw.line((1045, 448, 1070, 467, 1045, 486), fill=ink, width=6)
draw.text((775, 738), "硬 座", font=font(135), fill=ink, anchor="mm")
draw.text((120, 1080), "￥23.00", font=font(136), fill=ink, anchor="lm")
draw.text((1150, 1080), "2003年12月", font=font(118), fill=ink, anchor="lm")
# A deliberately stylized train mark, based only on the supplied demo reference.
green = (90, 116, 100)
draw.line([(1585, 715), (1600, 562), (1720, 511), (1880, 582), (1910, 721)], fill=green, width=12)
draw.polygon([(1620, 585), (1702, 557), (1702, 639), (1620, 653)], outline=green, width=9)
draw.polygon([(1730, 557), (1849, 600), (1858, 653), (1730, 639)], outline=green, width=9)
for y in [678, 710, 750]:
    draw.line([(1570, y), (1907, y + 8)], fill=green, width=8)
draw.line([(1560, 784), (1918, 784)], fill=green, width=8)
# Light age spots and ink wear leave the lettering legible at inspection distance.
for _ in range(650):
    px, py = int(rng.integers(W)), int(rng.integers(H))
    radius = int(rng.integers(1, 3))
    draw.ellipse((px, py, px + radius, py + radius), fill=(206, 170, 120))
save(ticket, "ticket-front")
reverse = paper((209, 181, 138), aged=True)
# No invented passenger, conditions, or journey details on the unprovided reverse.
save(reverse, "ticket-back")

# Shared tangent-space normal map: paper fibres and gentle creases, no baked lighting.
y, x = np.mgrid[0:512, 0:1024]
height = rng.normal(0, 0.65, (512, 1024))
height += np.exp(-((x - 500 - y * .035) / 4) ** 2) * 3.5
gy, gx = np.gradient(height)
normal = np.stack([-gx * .13, gy * .13, np.ones_like(height)], axis=-1)
normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
save(Image.fromarray(np.uint8(np.clip(normal * .5 + .5, 0, 1) * 255)), "paper-normal")

plastic = Image.new("L", (1024, 1024), 128)
draw = ImageDraw.Draw(plastic)
for _ in range(420):
    px, py = int(rng.integers(1024)), int(rng.integers(1024))
    draw.line([(px, py), (px + int(rng.integers(-24, 24)), py + int(rng.integers(4, 65)))], fill=int(rng.integers(111, 145)), width=1)
height = np.asarray(plastic).astype(float) + rng.normal(0, .3, (1024, 1024))
gy, gx = np.gradient(height)
normal = np.stack([-gx * .035, gy * .035, np.ones_like(height)], axis=-1)
normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
save(Image.fromarray(np.uint8(np.clip(normal * .5 + .5, 0, 1) * 255)), "plastic-normal")
print("Generated cassette labels, ticket faces, and paper/plastic normal maps.")
