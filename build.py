"""Empacota o add-on: dist/Herois_baiduu.mcaddon (os dois pacotes) e os .mcpack separados."""
import os, zipfile

def zipdir(z, src, prefix):
    for root, _, files in os.walk(src):
        for f in files:
            full = os.path.join(root, f)
            z.write(full, os.path.join(prefix, os.path.relpath(full, src)))

os.makedirs('dist', exist_ok=True)
with zipfile.ZipFile('dist/Herois_baiduu.mcaddon', 'w', zipfile.ZIP_DEFLATED) as z:
    zipdir(z, 'BP', 'Herois_baiduu_BP')
    zipdir(z, 'RP', 'Herois_baiduu_RP')
for name, src in (('Herois_baiduu_BP.mcpack', 'BP'), ('Herois_baiduu_RP.mcpack', 'RP')):
    with zipfile.ZipFile(os.path.join('dist', name), 'w', zipfile.ZIP_DEFLATED) as z:
        zipdir(z, src, '')
print('ok')
