# Converts the section's texture images to WebP (quality 82, normals 90). Frond/impostors keep alpha (lossless alpha).
import sys, os, glob
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]; os.makedirs(dst, exist_ok=True)
for f in [p for p in glob.glob(os.path.join(src, '*.*')) if p.lower().endswith(('.jpg', '.png')) and os.path.basename(p).startswith(('opt_', 'chk_'))]:
    n = os.path.splitext(os.path.basename(f))[0]
    im = Image.open(f)
    q = 90 if n.endswith('_nor') else 82
    im.save(os.path.join(dst, n + '.webp'), 'WEBP', quality=q, method=6)
    print(n, os.path.getsize(f), '->', os.path.getsize(os.path.join(dst, n + '.webp')))
