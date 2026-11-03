import os, sys
from PIL import Image
d = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "preview")
name, tag = sys.argv[1], sys.argv[2]
names = ['rest_front', 'rest_three_quarter', 'rest_side', 'rest_rear', 'walk_0', 'walk_1', 'walk_2', 'walk_3']
sheet = Image.new('RGB', (1200, 800))
for i, n in enumerate(names):
    sheet.paste(Image.open(os.path.join(d, f'{name}_{n}.png')).resize((300, 400)), ((i % 4) * 300, (i // 4) * 400))
sheet.save(os.path.join(d, f'{name}_sheet_{tag}.png'))
