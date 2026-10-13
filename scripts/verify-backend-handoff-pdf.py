"""Read-only checks and temporary render artifacts for the compiled handoff."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import re
import subprocess
import unicodedata

import pdfplumber
from pypdf import PdfReader
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
TMP = ROOT / 'tmp/pdfs/halo-backend-handoff'
META = json.loads((TMP / 'manifest.json').read_text(encoding='utf-8'))
PDF = Path(META['output'])
reader = PdfReader(PDF)
issues = []

def normalize(value):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', value))

assert len(reader.pages) == META['total_pages']
for source in META['sources']:
    embedded = reader.attachments[source['path']]
    assert len(embedded) == 1
    assert hashlib.sha256(embedded[0]).hexdigest() == source['sha256'], source['path']
    assert embedded[0] == (ROOT / source['path']).read_bytes(), source['path']

# Appended source pages must retain the same text and content streams.
original = PdfReader(ROOT / META['sources'][-1]['path'])
for i, page in enumerate(original.pages):
    final = reader.pages[META['body_pages'] + i]
    assert final.extract_text() == page.extract_text(), f'Original appendix text page {i+1}'
    assert final.get_contents().get_data() == page.get_contents().get_data(), f'Original appendix stream page {i+1}'

body_text = []
page_stats = []
with pdfplumber.open(PDF) as pdf:
    for i, page in enumerate(pdf.pages[:META['body_pages']]):
        body = page.crop((0, 50, page.width, 744))
        text = body.extract_text() or ''
        body_text.append(text)
        if not text.strip():
            issues.append({'type':'empty_body', 'page':i+1})
        chars = body.chars
        outside = [c for c in chars if c['text'].strip() and (c['x0'] < 52 or c['x1'] > 560)]
        if outside:
            issues.append({'type':'horizontal_overflow', 'page':i+1, 'chars':''.join(c['text'] for c in outside)[:150]})
        page_stats.append({'page':i+1, 'chars':len(chars),
                           'min_x':min((c['x0'] for c in chars), default=0),
                           'max_x':max((c['x1'] for c in chars), default=0)})
        page.close()

joined = normalize('\n'.join(body_text))
ledger = json.loads((TMP / 'text-ledger.json').read_text(encoding='utf-8'))
for index, item in enumerate(ledger):
    expected = normalize(item['text'])
    if expected and expected not in joined:
        issues.append({'type':'missing_rendered_text', 'item':index, 'source':item['source'], 'text':item['text'][:350]})

# Verify all internal annotation destinations still reference a page in this PDF.
page_ids = {p.indirect_reference.idnum for p in reader.pages}
links = {'external':0, 'internal':0}
for i, page in enumerate(reader.pages[:META['body_pages']]):
    for ann_ref in page.get('/Annots', []):
        ann = ann_ref.get_object()
        if ann.get('/Subtype') != '/Link':
            continue
        if '/Dest' in ann:
            dest = ann['/Dest']
            target = dest[0] if isinstance(dest, list) else None
            if target is None or getattr(target, 'idnum', None) not in page_ids:
                issues.append({'type':'bad_internal_link', 'page':i+1, 'dest':str(dest)})
            links['internal'] += 1
        elif ann.get('/A', {}).get('/S') == '/URI':
            links['external'] += 1

result = {'pages':len(reader.pages), 'embedded_sources_verified':len(META['sources']),
          'original_pages_unchanged':len(original.pages), 'text_fragments_checked':len(ledger),
          'links':links, 'issues':issues, 'page_stats':page_stats}
(TMP / 'qa.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps({k:v for k,v in result.items() if k != 'page_stats'}, indent=2))

# Rasterize every final page for contact-sheet review, then selected dense pages at full size.
thumbs = TMP / 'rendered'
thumbs.mkdir(exist_ok=True)
subprocess.run(['pdftoppm', '-scale-to', '440', '-png', str(PDF), str(thumbs / 'page')], check=True)
images = sorted(thumbs.glob('page-*.png'))
for start in range(0, len(images), 24):
    sheet = Image.new('RGB', (1760, 2832), '#dde7eb')
    draw = ImageDraw.Draw(sheet)
    for slot, path in enumerate(images[start:start+24]):
        im = Image.open(path).convert('RGB')
        im.thumbnail((424, 440))
        x = (slot % 4) * 440 + (440-im.width)//2
        y = (slot // 4) * 472 + 22
        sheet.paste(im, (x,y))
        draw.text(((slot % 4)*440+12, (slot//4)*472+5), f'Page {start+slot+1}', fill='#183446')
    sheet.save(TMP / f'contact-{start//24+1:02d}.png')

selected = sorted(set([1,2,3,5,20,35,60,65,66,70,72,107,128,220,
                       META['body_pages']+1, META['total_pages']]
                      + list(META['chapter_pages'].values())))
def render(page):
    subprocess.run(['pdftoppm', '-f',str(page),'-l',str(page),'-scale-to','1500','-png','-singlefile',str(PDF),str(TMP/f'detail-{page:03d}')], check=True)
with ThreadPoolExecutor(max_workers=4) as pool:
    list(pool.map(render, selected))
if issues:
    raise SystemExit(f'PDF validation found {len(issues)} issues; see qa.json.')
print('PASS: attachment hashes, full appendix, rendered text, bounds and internal destinations.')
