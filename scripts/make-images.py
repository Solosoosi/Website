# Makes the site's photos from the originals in photos/ (needs Pillow: pip install pillow).
#
#   python3 scripts/make-images.py
#
# Every photo is exported in a few widths so phones, tablets and computers each get
# a sharp copy without downloading more than they need (the pages use srcset).
# Crops follow the originals' framing; nothing is ever enlarged beyond the original.
import glob
import os

from PIL import Image, ImageOps

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'public', 'images')
FILES = sorted(glob.glob(os.path.join(ROOT, 'photos', 'WhatsApp Image *.jpeg')))


def load(n):
    """Photo number n (1-based, in file-name order), upright, without metadata."""
    return ImageOps.exif_transpose(Image.open(FILES[n - 1])).convert('RGB')


def crop(im, ratio, fx=0.5, fy=0.5):
    """Largest crop with this width/height ratio, placed at focus (fx, fy)."""
    w, h = im.size
    if w / h > ratio:
        cw, ch = h * ratio, h
    else:
        cw, ch = w, w / ratio
    x, y = int((w - cw) * fx), int((h - ch) * fy)
    return im.crop((x, y, x + int(cw), y + int(ch)))


def box(im, x0, y0, side_w, ratio):
    """Crop by fractions of the photo: left/top corner and width, at a ratio."""
    w, h = im.size
    cw = int(w * side_w)
    ch = int(cw / ratio)
    x, y = int(w * x0), int(h * y0)
    return im.crop((x, y, x + cw, y + ch))


def save(im, name, widths, quality=80):
    """Save one file per width: name.jpg for the first, name-<width>.jpg for the rest."""
    for i, width in enumerate(widths):
        if width > im.width:
            raise SystemExit(f'{name}: {width}px would enlarge a {im.width}px crop')
        size = (width, round(im.height * width / im.width))
        path = os.path.join(OUT, f'{name}.jpg' if i == 0 else f'{name}-{width}.jpg')
        im.resize(size, Image.LANCZOS).save(path, 'JPEG', quality=quality, optimize=True, progressive=True)
        print(f'{os.path.relpath(path, ROOT):40} {size[0]}×{size[1]}  {os.path.getsize(path) // 1024} KB')


os.makedirs(os.path.join(OUT, 'large'), exist_ok=True)

# The empty treatment room (photo 14, right side)
room = load(14)
save(box(room, 0.48, 0.15, 0.52, 4 / 5), 'room', [960, 640, 1440], 78)

# The treatments (square), plus small copies for the list on the opening screen
save(crop(load(6), 1, 0.5, 0.42), 'svc-dry', [700, 300, 1200, 1600])
save(crop(load(3), 1, 0.5, 0.62), 'svc-cosmetic', [700, 300, 1200, 1600])
save(box(load(18), 0.18, 0.30, 0.64, 1), 'svc-stress', [700, 300, 1200, 1600])

# About: David in the clinic
save(crop(load(11), 4 / 5), 'about', [900, 1350, 1800])

# Gallery: 4:5 tiles, and the whole photo for the full-screen viewer
GALLERY = [(1, 0.55), (5, 0.35), (4, 0.5), (25, 0.5), (8, 0.5), (17, 0.5), (7, 0.45), (2, 0.7), (24, 0.5)]
for i, (n, fy) in enumerate(GALLERY, 1):
    photo = load(n)
    save(crop(photo, 4 / 5, 0.5, fy), f'gal-{i}', [720, 1080], 78)
    big = photo.copy()
    big.thumbnail((2048, 2048), Image.LANCZOS)
    path = os.path.join(OUT, 'large', f'gal-{i}.jpg')
    big.save(path, 'JPEG', quality=76, optimize=True, progressive=True)
    print(f'{os.path.relpath(path, ROOT):40} {big.width}×{big.height}  {os.path.getsize(path) // 1024} KB')
