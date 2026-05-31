"""Create a rounded-corner copy of the app icon for use as the splash image.

Reads assets/images/app-icon.png and writes assets/images/splash-icon.png with
more rounded corners. The corners are made transparent so they blend into the
splash backgroundColor. Uses 4x supersampling for smooth anti-aliased edges.
"""
from PIL import Image, ImageDraw

SRC = "assets/images/app-icon.png"
DST = "assets/images/splash-icon.png"
RADIUS_PCT = 0.22  # corner radius as a fraction of the image width
SS = 4             # supersample factor for anti-aliasing

img = Image.open(SRC).convert("RGBA")
w, h = img.size

# Build a high-res rounded-rectangle mask, then downsample for smooth edges.
mask = Image.new("L", (w * SS, h * SS), 0)
draw = ImageDraw.Draw(mask)
radius = int(min(w, h) * RADIUS_PCT * SS)
draw.rounded_rectangle((0, 0, w * SS - 1, h * SS - 1), radius=radius, fill=255)
mask = mask.resize((w, h), Image.LANCZOS)

# Combine with any existing alpha so we never reveal previously-transparent pixels.
existing_alpha = img.getchannel("A")
combined = Image.new("L", (w, h), 0)
combined.paste(existing_alpha, (0, 0))
from PIL import ImageChops
combined = ImageChops.darker(existing_alpha, mask)

out = img.copy()
out.putalpha(combined)
out.save(DST, "PNG")
print(f"Wrote {DST} ({out.size[0]}x{out.size[1]}, radius={int(min(w,h)*RADIUS_PCT)}px)")
