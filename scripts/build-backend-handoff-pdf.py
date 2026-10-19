"""Compile the complete HALO planning handoff without summarizing its sources.

Requires reportlab, pypdf and pdfplumber. This only writes output/pdf and tmp/pdfs.
Original source files and approved archives are never modified.
"""
from pathlib import Path
import hashlib
import html
import json
import re
import subprocess
import textwrap
import unicodedata

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, PageBreak,
    HRFlowable,
)
from reportlab.platypus.tableofcontents import TableOfContents
from pypdf import PdfReader, PdfWriter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/pdf'
TMP = ROOT / 'tmp/pdfs/halo-backend-handoff'
OUT.mkdir(parents=True, exist_ok=True)
TMP.mkdir(parents=True, exist_ok=True)
FINAL = OUT / 'HALO_Complete_Backend_and_Frontend_Handoff.pdf'
REF = ROOT / 'docs/foundation/reference/HALO_Frontend_Specification_2026-09-29.pdf'
SOURCES = [
    ('Implementation entry point', 'docs/product/HALO_BACKEND_BUILD_HANDOFF.md'),
    ('Backend and data requirements', 'docs/product/HALO_BACKEND_AND_DATA_PLAN.md'),
    ('Source acquisition guide', 'docs/product/HALO_SOURCE_ACQUISITION_GUIDE.md'),
    ('Complete app master plan', 'docs/product/HALO_MASTER_PLAN.md'),
    ('Frontend build requirements', 'docs/product/HALO_FRONTEND_BUILD_PLAN.md'),
    ('Feature acceptance requirements', 'docs/product/HALO_FEATURE_ACCEPTANCE.md'),
    ('Source verification record', 'docs/product/verification/SOURCE_CHECKS_2026-10-03.md'),
    ('Existing approved frontend handoff', 'docs/foundation/STAGE_FRONTEND_HANDOFF.md'),
    ('Frontend workflow and preservation rules', 'docs/WIREFRAME_WORKFLOW.md'),
    ('Repository instructions', 'AGENTS.md'),
    ('Onboarding implementation reference', 'docs/onboarding/README.md'),
    ('Onboarding mobile review reference', 'docs/onboarding/mobile-review/README.md'),
    ('Foundation approval archive reference', 'docs/foundation/approved/2026-10-01/README.md'),
    ('Map prototype reference, not final approval', 'docs/map/README.md'),
    ('Public source probe: complete executable source', 'docs/product/verification/probe-public-sources.mjs'),
    ('Handoff validator: complete executable source', 'docs/product/verification/validate-handoff.mjs'),
]

for name, font in [('Halo', 'calibri.ttf'), ('Halo-Bold', 'calibrib.ttf'),
                   ('Halo-Italic', 'calibrii.ttf'), ('Halo-BoldItalic', 'calibriz.ttf'),
                   ('Code', 'consola.ttf')]:
    pdfmetrics.registerFont(TTFont(name, str(Path('C:/Windows/Fonts') / font)))
pdfmetrics.registerFontFamily('Halo', normal='Halo', bold='Halo-Bold',
                             italic='Halo-Italic', boldItalic='Halo-BoldItalic')
INK = colors.HexColor('#183446')
TEAL = colors.HexColor('#147F86')
MUTED = colors.HexColor('#526675')
LINE = colors.HexColor('#D8E5E8')
BASE = dict(fontName='Halo', fontSize=10.3, leading=14.1,
            textColor=INK, spaceAfter=7, splitLongWords=True,
            uriWasteReduce=0, spaceShrinkage=0, allowWidows=0, allowOrphans=0)
STYLES = {
    'body': ParagraphStyle('body', **BASE),
    'bullet': ParagraphStyle('bullet', **{**BASE, 'leftIndent':12, 'firstLineIndent':-9}),
    'small': ParagraphStyle('small', **{**BASE, 'fontSize':8.5, 'leading':11.5, 'textColor':MUTED}),
    'h1': ParagraphStyle('h1', **{**BASE, 'fontName':'Halo-Bold', 'fontSize':23, 'leading':28, 'spaceAfter':13, 'keepWithNext':True}),
    'h2': ParagraphStyle('h2', **{**BASE, 'fontName':'Halo-Bold', 'fontSize':15, 'leading':19, 'spaceBefore':15, 'spaceAfter':8, 'keepWithNext':True, 'textColor':TEAL}),
    'h3': ParagraphStyle('h3', **{**BASE, 'fontName':'Halo-Bold', 'fontSize':12, 'leading':16, 'spaceBefore':10, 'spaceAfter':6, 'keepWithNext':True}),
    'row': ParagraphStyle('row', **{**BASE, 'fontName':'Halo-Bold', 'fontSize':10.5, 'leading':14, 'spaceBefore':8, 'spaceAfter':5, 'keepWithNext':True, 'textColor':TEAL}),
    'code': ParagraphStyle('code', fontName='Code', fontSize=7.6, leading=10,
                           spaceAfter=0, textColor=INK, splitLongWords=True,
                           leftIndent=7, rightIndent=7),
}
LINK_RX = re.compile(r'\[([^\]]+)\]\((?:<([^>]+)>|([^\s)]+(?:\([^)]*\)[^\s)]*)?))\)')
SOURCE_KEYS = {str((ROOT / p).resolve()).lower(): f'chapter-{i}' for i, (_, p) in enumerate(SOURCES, 1)}
SOURCE_KEYS[str(REF.resolve()).lower()] = 'original-specification'

def printable(value):
    # Typography normalization only. Original bytes are embedded as attachments.
    return value.translate(str.maketrans({'\u2014':' - ', '\u2013':'-', '\u2011':'-', '\u2010':'-', '\u00a0':' '}))

def inline(value, source=None):
    protected = []
    def protect(markup):
        protected.append(markup)
        return f'ZZHALOTOKEN{len(protected)-1}ZZ'
    def link(m):
        label, target = m.group(1), m.group(2) or m.group(3)
        escaped_label = html.escape(printable(label))
        escaped_target = html.escape(printable(target), quote=True)
        if target.startswith(('https://', 'http://', 'mailto:')):
            return protect(f'<link href="{escaped_target}" color="#147F86">{escaped_label}</link> '
                           f'<font size="8.3" color="#526675">({escaped_target})</font>')
        dest = None
        if source and not target.startswith('#'):
            resolved = str((source.parent / target.split('#')[0]).resolve()).lower()
            dest = SOURCE_KEYS.get(resolved)
        label_markup = f'<link href="#{dest}" color="#147F86">{escaped_label}</link>' if dest else escaped_label
        return protect(f'{label_markup} <font size="8.3" color="#526675">({escaped_target})</font>')
    value = LINK_RX.sub(link, value)
    value = re.sub(r'`([^`]+)`', lambda m: protect('<font name="Code" size="8.8">'+html.escape(printable(m.group(1)))+'</font>'), value)
    value = html.escape(printable(value))
    value = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', value)
    value = re.sub(r'(?<!\*)\*([^*]+)\*(?!\*)', r'<i>\1</i>', value)
    for i, block in enumerate(protected):
        value = value.replace(f'ZZHALOTOKEN{i}ZZ', block)
    return value

LEDGER = []
CURRENT_SOURCE = 'compiler front matter'
def para(markup, kind='body', ledger=True):
    p = Paragraph(markup, STYLES[kind])
    if ledger:
        LEDGER.append({'source':CURRENT_SOURCE, 'text':p.getPlainText()})
    return p

def code_lines(value):
    result = [Spacer(1, 5)]
    for line in value.splitlines():
        # Wrap long lines without deleting characters; original indentation is retained.
        parts = textwrap.wrap(line.expandtabs(4), width=105, replace_whitespace=False,
                              drop_whitespace=False, break_long_words=True, break_on_hyphens=False) or [' ']
        for part in parts:
            escaped = html.escape(printable(part)).replace(' ', '&#160;')
            result.append(para(escaped, 'code'))
    result.append(Spacer(1, 8))
    return result

def table_cells(line):
    return [x.strip().replace('\\|', '|') for x in re.split(r'(?<!\\)\|', line.strip().strip('|'))]

def markdown(value, source):
    lines = value.splitlines()
    result = []
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        if line.startswith('```'):
            code = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith('```'):
                code.append(lines[i]); i += 1
            result.extend(code_lines('\n'.join(code)))
            i += 1
            continue
        if line.startswith('|') and i+1 < len(lines) and re.match(r'^\|[\s:|\-]+\|?$', lines[i+1].strip()):
            headers = table_cells(lines[i])
            i += 2
            # Wide markdown tables become labelled records, keeping every cell.
            result.append(para('Table fields: ' + ' / '.join(inline(h, source) for h in headers), 'small'))
            while i < len(lines) and lines[i].strip().startswith('|'):
                cells = table_cells(lines[i])
                if len(cells) != len(headers):
                    raise ValueError(f'Table column mismatch {source}:{i+1}: {len(cells)} != {len(headers)}')
                result.append(para(inline(cells[0] or '(empty)', source), 'row'))
                for header, cell in zip(headers[1:], cells[1:]):
                    result.append(para('<b>'+inline(header, source)+':</b> '+inline(cell or '(empty)', source)))
                result.append(HRFlowable(width='100%', thickness=0.35, color=LINE, spaceBefore=2, spaceAfter=5))
                i += 1
            continue
        heading = re.match(r'^(#{1,6})\s+(.*)', line)
        if heading:
            kind = 'h2' if len(heading[1]) <= 2 else 'h3'
            p = para(inline(heading[2], source), kind)
            p.section_heading = True
            result.append(p)
            i += 1
            continue
        if re.fullmatch(r'[-*_]{3,}', line):
            result.append(HRFlowable(width='100%', thickness=0.5, color=LINE, spaceBefore=7, spaceAfter=9))
            i += 1
            continue
        if re.match(r'^[-*+]\s+', line):
            result.append(para('- '+inline(re.sub(r'^[-*+]\s+', '', line), source), 'bullet'))
        elif re.match(r'^\d+[.)]\s+', line):
            result.append(para(inline(line, source), 'bullet'))
        else:
            # Preserve each nonempty source line; no summarizing or dropped HTML comments.
            result.append(para(inline(line, source)))
        i += 1
    return result

class HandoffDoc(BaseDocTemplate):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.addPageTemplates(PageTemplate(id='normal', frames=[Frame(54, 50, 504, 686, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)], onPage=self.chrome))
    def beforeDocument(self):
        self.current_chapter = 'HALO / Complete implementation handoff'
        self.chapter_pages = {}
        self.headings = []
        self.heading_counter = 0
    def chrome(self, canvas, doc):
        canvas.saveState()
        if doc.page > 1:
            canvas.setFont('Halo-Bold', 8)
            canvas.setFillColor(TEAL)
            canvas.drawString(54, 758, 'HALO  /  IMPLEMENTATION HANDOFF')
            canvas.setStrokeColor(LINE)
            canvas.line(54, 749, 558, 749)
            canvas.setFont('Halo', 8)
            canvas.setFillColor(MUTED)
            canvas.drawString(54, 31, 'October 3, 2026  |  Complete source compilation')
            canvas.drawRightString(558, 31, str(doc.page))
        canvas.restoreState()
    def afterFlowable(self, flowable):
        if hasattr(flowable, 'chapter_key'):
            title, key = flowable.getPlainText(), flowable.chapter_key
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(title, key, level=0)
            self.notify('TOCEntry', (0, title, self.page, key))
            self.chapter_pages[key] = self.page
        elif hasattr(flowable, 'section_heading'):
            self.heading_counter += 1
            key = f'section-{self.heading_counter}'
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(flowable.getPlainText(), key, level=1)
            self.headings.append({'text':flowable.getPlainText(), 'page':self.page})

manifest = []
for title, relative in SOURCES:
    content = (ROOT / relative).read_bytes()
    manifest.append({'title':title, 'path':relative, 'bytes':len(content), 'sha256':hashlib.sha256(content).hexdigest()})
ref_bytes = REF.read_bytes()
manifest.append({'title':'Original frontend specification (historical reference)', 'path':str(REF.relative_to(ROOT)).replace('\\','/'), 'bytes':len(ref_bytes), 'sha256':hashlib.sha256(ref_bytes).hexdigest()})
git_commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()

story = [Spacer(1, 65), para('HALO', 'h1'),
         para('Complete backend<br/>and frontend handoff', 'h1'),
         Spacer(1, 13), HRFlowable(width=90, thickness=4, color=TEAL, hAlign='LEFT'), Spacer(1, 22),
         para('Prepared for Vibhav and Yogi'),
         para('October 3, 2026'), Spacer(1, 25),
         para('One searchable volume. Complete source documents. No feature summaries substituted for the implementation requirements.'),
         para('45 planned feature groups / 24 source families / existing frontend integration reference'),
         Spacer(1, 22),
         para('Build blueprint, not a claim of deployed functionality. Source, permission, product-decision and release gates remain explicit throughout.'),
         Spacer(1, 15),
         para('Includes the original 83-page frontend specification as a historical appendix. Newer decisions and approval rules take precedence.', 'small'),
         PageBreak(), para('How to use this volume', 'h1')]
for text in [
    '<b>Vibhav:</b> start with Chapter 1, then use Chapters 2 and 3 for backend and data work. Chapters 4 through 6 define the full feature scope, frontend needs and acceptance requirements. Chapter 8 explains the already approved frontend integration surface.',
    '<b>Yogi:</b> use the same shared plan, especially Chapters 4 through 6 and the preservation references. Do not create a separate edited copy that drifts from the backend requirements.',
    '<b>Preservation:</b> every source document listed in the manifest is reproduced in full. Wide Markdown tables are reflowed into labelled records for legibility; no cells are summarized. Code is wrapped for reading. External URLs are printed as well as clickable. Original source bytes, including scripts and the source PDF, are also embedded as PDF attachments.',
    '<b>Precedence:</b> the current product plans and explicit user decisions supersede conflicting historical specifications. Today retains its approved depth. PFAS belongs to Homeguard. Map and other new designs still require review. The proposed fourth-tab label remains a decision, not an approved visual.',
    '<b>Historical material:</b> the onboarding/mobile/map references and original specification describe their own dated scope. Preserve historical status wording as evidence; do not treat old assignment, command, appearance or architecture suggestions as new instructions.',
    '<b>Repository dependency:</b> this PDF contains the handoff documentation, not the entire application source, image library, test suite or immutable design archives. Vibhav still needs the halo-app repository to inspect and extend the existing implementation. Paths printed in the documents refer to that repository.',
    '<b>Validation boundary:</b> public request success is not complete data validation. Keyed-provider checks, account rights, full imports, semantic review, migrations and integration tests remain the gates stated in the documents.',
    '<b>Reading:</b> use the clickable contents and PDF bookmarks. The original specification retains its original page layout and numbering; use its appendix bookmark to open it. PDF attachments preserve exact source files, although some mobile viewers do not expose attachments.',
]:
    story.append(para(text))
story.append(para('Repository HEAD at compilation: '+git_commit+'. Planning files are a local working-tree snapshot and are not implied to exist in this commit.', 'small'))
story.extend([PageBreak(), para('Contents', 'h1')])
toc = TableOfContents()
toc.levelStyles = [ParagraphStyle('toc', fontName='Halo', fontSize=10.5, leading=15.5,
                                 textColor=INK, spaceBefore=8, leftIndent=0, firstLineIndent=0,
                                 rightIndent=30)]
story.append(toc)

for idx, (title, relative) in enumerate(SOURCES, 1):
    CURRENT_SOURCE = relative
    story.append(PageBreak())
    titlep = para(f'{idx:02d} / {html.escape(title)}', 'h1')
    titlep.chapter_key = f'chapter-{idx}'
    story.extend([titlep, para(html.escape(relative), 'small')])
    if idx in (11,12,13,14):
        story.append(para('Dated implementation/review reference. Current product decisions and approval rules take precedence over older scope or status statements.', 'small'))
    source = ROOT / relative
    value = source.read_text(encoding='utf-8-sig')
    story.extend(code_lines(value) if source.suffix == '.mjs' else markdown(value, source))

CURRENT_SOURCE = 'compiler manifest'
story.append(PageBreak())
titlep = para('17 / Source manifest and integrity', 'h1')
titlep.chapter_key = 'manifest'
story.append(titlep)
story.append(para('The following original files are embedded byte-for-byte in this PDF. SHA-256 checksums identify the exact compiled snapshot. The readable chapters preserve the information while adapting Markdown formatting for print.'))
for entry in manifest:
    story.extend([para(html.escape(entry['path']), 'row'),
                  para(f"{entry['bytes']:,} bytes", 'small'),
                  para(entry['sha256'], 'small')])
story.append(PageBreak())
titlep = para('18 / Original frontend specification', 'h1')
titlep.chapter_key = 'original-specification'
story.extend([titlep, para('Historical reference / September 29, 2026'),
              para('All 83 original pages follow this divider, with their original layout, page numbering and source wording retained. The original PDF is also embedded as an attachment.'),
              para('Read the current plans and workflow first. Historical assignments, old navigation or appearance choices, proposed commands and superseded architectural assumptions are not the current implementation instructions.'),
              para('This appendix is not a replacement for repository code, immutable approval archives, or newly specified backend requirements.')])

compiled = TMP / 'compiled-body.pdf'
doc = HandoffDoc(str(compiled), pagesize=letter, title='HALO Complete Backend and Frontend Handoff', author='HALO', allowSplitting=True)
doc.multiBuild(story)
body = PdfReader(compiled)
original = PdfReader(REF)
writer = PdfWriter()
writer.append(body, import_outline=True)
writer.add_outline_item('Original specification: first source page', len(body.pages))
writer.append(original, import_outline=False)
for entry in manifest:
    writer.add_attachment(entry['path'], (ROOT / entry['path']).read_bytes())
writer.add_metadata({'/Title':'HALO Complete Backend and Frontend Handoff',
                     '/Author':'HALO', '/Subject':'Complete implementation plans, source acquisition, frontend contracts and original specification',
                     '/Keywords':'HALO, backend, frontend, Vibhav, implementation handoff, October 3 2026'})
with FINAL.open('wb') as handle:
    writer.write(handle)
result = {'output':str(FINAL), 'body_pages':len(body.pages), 'original_pages':len(original.pages),
          'total_pages':len(writer.pages), 'chapter_pages':doc.chapter_pages, 'headings':doc.headings,
          'sources':manifest, 'git_head':git_commit}
(TMP / 'manifest.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
(TMP / 'text-ledger.json').write_text(json.dumps(LEDGER, ensure_ascii=False), encoding='utf-8')
print(json.dumps({k:v for k,v in result.items() if k not in ('sources','headings')}, indent=2))
