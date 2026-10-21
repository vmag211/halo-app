"""Verify source preservation, packet coverage, PDF extraction, links and page bounds."""
from pathlib import Path
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import re
import subprocess
import unicodedata

import pdfplumber
from pypdf import PdfReader
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
DIR=ROOT/'docs/product/ai'
TMP=ROOT/'tmp/pdfs/halo-working-spec'
spec=DIR/'HALO_BACKEND_WORKING_SPEC.md'
coverage=json.loads((DIR/'HALO_BACKEND_SOURCE_COVERAGE.json').read_text(encoding='utf-8'))
meta=json.loads((TMP/'render-manifest.json').read_text(encoding='utf-8'))
text=spec.read_text(encoding='utf-8')
issues=[]
def digest(data): return hashlib.sha256(data if isinstance(data,bytes) else data.encode('utf-8')).hexdigest()
def norm(value): return re.sub(r'\s+','',unicodedata.normalize('NFKC',value))
assert digest(spec.read_bytes())==coverage['spec_sha256']==meta['markdown_sha256']
assert digest((ROOT/'output/pdf/HALO_Complete_Backend_and_Frontend_Handoff.pdf').read_bytes())==coverage['original_compilation_sha256']
assert '\u2014' not in text
sources={}
for source in coverage['sources']:
    data=(ROOT/source['path']).read_bytes()
    assert digest(data)==source['sha256'], source['path']
    sources[source['path']]=data.decode('utf-8-sig').splitlines()

substantive=[b for b in coverage['blocks'] if b['kind'] not in ('heading','table_schema')]
assert len(substantive)==1630
marks=list(re.finditer(r'\*\*((?:HO|BE|DS|MP|UI|AC|ST|WF|AG|MA|VR)-\d{3})\*\*',text))
counts=Counter(m[1] for m in marks)
assert set(counts)=={b['id'] for b in substantive}
assert all(c==1 for c in counts.values())
positions={m[1]:m for m in marks}
for block in coverage['blocks']:
    raw='\n'.join(sources[block['source']][block['start_line']-1:block['end_line']])
    assert digest(raw)==block['sha256'],block['id']
    if block['kind'] in ('heading','table_schema'):
        continue
    mark=positions[block['id']]
    line_start=text.rfind('\n',0,mark.start())+1
    if block['kind']=='table_row' and text[line_start:mark.start()].strip()=='|':
        end=text.find('\n',mark.end())
        payload=text[line_start:end].replace(mark[0]+' ','',1)
    else:
        start=mark.end()
        while text[start].isspace(): start+=1
        payload=text[start:start+block['rendered_payload_length']]
    assert digest(payload)==block['rendered_payload_sha256'],block['id']

assert len(coverage['features'])==45 and len(coverage['source_ids'])==24
feature_positions=[]
for feature,title in coverage['features'].items():
    anchor=f'<a id="feature-{feature.lower()}"></a>'
    assert text.count(anchor)==1
    feature_positions.append((feature,text.index(anchor)))
for idx,(feature,start) in enumerate(feature_positions):
    end=feature_positions[idx+1][1] if idx+1<len(feature_positions) else text.index('<a id="shared-mp"></a>')
    packet=text[start:end]
    for label in ['Product behavior','Frontend interface needs','Backend work and sources','Feature acceptance']:
        assert f'#### {label}' in packet,(feature,label)
    for block in substantive:
        if block.get('feature')==feature:
            assert f"**{block['id']}**" in packet,(feature,block['id'])
for sid in coverage['source_ids']:
    assert re.search(r'^### .*\b'+sid+r' ',text,re.M),sid

anchors=set(re.findall(r'<a id="([^"]+)"></a>',text))
for target in re.findall(r'\]\(#([^)]*)\)',text):
    assert target in anchors,target

pdf=PdfReader(meta['pdf'])
assert pdf.attachments[spec.name][0]==spec.read_bytes()
assert pdf.attachments['HALO_BACKEND_SOURCE_COVERAGE.json'][0]==(DIR/'HALO_BACKEND_SOURCE_COVERAGE.json').read_bytes()
alltext=[]
with pdfplumber.open(meta['pdf']) as doc:
    for i,page in enumerate(doc.pages):
        body=page.crop((0,47,612,751))
        alltext.append(body.extract_text(x_tolerance=1) or '')
        chars=body.chars
        bad=[c for c in chars if c['text'].strip() and (c['x0']<40 or c['x1']>572)]
        if bad: issues.append({'type':'horizontal_overflow','page':i+1,'text':''.join(c['text'] for c in bad)[:160]})
        if not alltext[-1].strip(): issues.append({'type':'empty_page','page':i+1})
        page.close()

# Table extraction can interleave neighboring cells. Use the PDF drawing order
# for phrase preservation and a separate coordinate pass for layout bounds.
draw_text=[]
for i,page in enumerate(pdf.pages):
    value=page.extract_text() or ''
    value=re.sub(r'HALO / BACKEND WORKING SPECIFICATION\s*','',value)
    value=re.sub(r'October 3, 2026\s*\|\s*Current requirements, not deployed functionality\s*\d+\s*','',value)
    draw_text.append(value)
joined=norm('\n'.join(draw_text))
ledger=json.loads((TMP/'render-ledger.json').read_text(encoding='utf-8'))
for i,item in enumerate(ledger):
    expected=norm(item)
    if expected and expected not in joined:
        issues.append({'type':'missing_rendered_text','fragment':i,'text':item[:400]})

page_ids={p.indirect_reference.idnum for p in pdf.pages}
links=Counter()
for n,page in enumerate(pdf.pages,1):
    for ref in page.get('/Annots',[]):
        ann=ref.get_object()
        if '/Dest' in ann:
            dest=ann['/Dest']
            if not isinstance(dest,list) or getattr(dest[0],'idnum',None) not in page_ids:
                issues.append({'type':'bad_internal_link','page':n})
            links['internal']+=1
        elif ann.get('/A',{}).get('/S')=='/URI': links['external']+=1

original=PdfReader(ROOT/'output/pdf/HALO_Complete_Backend_and_Frontend_Handoff.pdf')
archive_text='\n'.join(p.extract_text() or '' for p in original.pages)
result={'source_documents':len(coverage['sources']),'source_blocks_preserved':len(substantive),
        'features':len(coverage['features']),'source_families':len(coverage['source_ids']),
        'original_pdf_unchanged':True,'pdf_pages':len(pdf.pages),'original_pdf_pages':len(original.pages),
        'working_markdown_characters':len(text),'original_pdf_extracted_characters':len(archive_text),
        'text_reduction_percent':round(100*(1-len(text)/len(archive_text)),1),
        'rendered_fragments':len(ledger),'links':dict(links),'issues':issues,
        'markdown_sha256':digest(spec.read_bytes()),'pdf_sha256':digest(Path(meta['pdf']).read_bytes())}
(TMP/'qa.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result,indent=2),flush=True)

thumbs=TMP/'rendered'
thumbs.mkdir(exist_ok=True)
subprocess.run(['pdftoppm','-scale-to','440','-png',meta['pdf'],str(thumbs/'page')],check=True)
images=sorted(thumbs.glob('page-*.png'))
for start in range(0,len(images),24):
    sheet=Image.new('RGB',(1760,2832),'#dde7eb'); draw=ImageDraw.Draw(sheet)
    for slot,path in enumerate(images[start:start+24]):
        im=Image.open(path).convert('RGB'); im.thumbnail((424,440))
        x=(slot%4)*440+(440-im.width)//2; y=(slot//4)*472+22
        sheet.paste(im,(x,y)); draw.text(((slot%4)*440+12,(slot//4)*472+5),f'Page {start+slot+1}',fill='#193344')
    sheet.save(TMP/f'contact-{start//24+1:02}.png')
selected=sorted(set([1,2,3,4,8,15,25,35,len(pdf.pages)]
                    +[n for key,n in meta['pages_by_key'].items() if key.startswith('shared-') or key in ('feature-g01','feature-f02','feature-p03')]))
def render(n):
    subprocess.run(['pdftoppm','-f',str(n),'-l',str(n),'-scale-to','1500','-png','-singlefile',meta['pdf'],str(TMP/f'detail-{n:03}')],check=True)
with ThreadPoolExecutor(max_workers=4) as pool: list(pool.map(render,selected))
if issues: raise SystemExit(f'FAIL: {len(issues)} PDF issues; see qa.json')
(DIR/'HALO_BACKEND_WORKING_SPEC_VALIDATION.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print('PASS: source blocks, feature packets, source families, PDF text, link destinations and bounds.',flush=True)
