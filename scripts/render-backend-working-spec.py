"""Render the working Markdown as a compact, searchable PDF without a history appendix."""
from pathlib import Path
import hashlib
import html
import json
import re
import textwrap

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, PageBreak, LongTable, TableStyle
from reportlab.platypus.tableofcontents import TableOfContents
from pypdf import PdfReader, PdfWriter

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'docs/product/ai/HALO_BACKEND_WORKING_SPEC.md'
COVERAGE=SOURCE.with_name('HALO_BACKEND_SOURCE_COVERAGE.json')
TMP=ROOT/'tmp/pdfs/halo-working-spec'
TMP.mkdir(parents=True,exist_ok=True)
FINAL=ROOT/'output/pdf/HALO_Backend_Working_Specification.pdf'
FINAL.parent.mkdir(parents=True,exist_ok=True)

for name,file in [('Halo','calibri.ttf'),('Halo-Bold','calibrib.ttf'),('Halo-Italic','calibrii.ttf'),('Halo-BoldItalic','calibriz.ttf'),('Code','consola.ttf')]:
    pdfmetrics.registerFont(TTFont(name,str(Path('C:/Windows/Fonts')/file)))
pdfmetrics.registerFontFamily('Halo',normal='Halo',bold='Halo-Bold',italic='Halo-Italic',boldItalic='Halo-BoldItalic')
INK=colors.HexColor('#193344'); TEAL=colors.HexColor('#117D84'); GRAY=colors.HexColor('#58717E'); LINE=colors.HexColor('#D5E3E8')
base=dict(fontName='Halo',fontSize=9.5,leading=12.1,textColor=INK,spaceAfter=5,
          splitLongWords=True,uriWasteReduce=0,spaceShrinkage=0,allowWidows=0,allowOrphans=0)
styles={
    'body':ParagraphStyle('body',**base),
    'cell':ParagraphStyle('cell',**{**base,'fontSize':8.6,'leading':10.8,'spaceAfter':0,'allowWidows':1,'allowOrphans':1}),
    'thead':ParagraphStyle('thead',**{**base,'fontName':'Halo-Bold','fontSize':8.6,'leading':10.8,'spaceAfter':0,'textColor':colors.white}),
    'small':ParagraphStyle('small',**{**base,'fontSize':8,'leading':10,'textColor':GRAY}),
    'h1':ParagraphStyle('h1',**{**base,'fontName':'Halo-Bold','fontSize':25,'leading':29,'spaceAfter':15,'keepWithNext':True}),
    'h2':ParagraphStyle('h2',**{**base,'fontName':'Halo-Bold','fontSize':17,'leading':21,'spaceBefore':13,'spaceAfter':8,'keepWithNext':True,'textColor':TEAL}),
    'h3':ParagraphStyle('h3',**{**base,'fontName':'Halo-Bold','fontSize':12,'leading':15,'spaceBefore':11,'spaceAfter':6,'keepWithNext':True,'textColor':TEAL}),
    'h4':ParagraphStyle('h4',**{**base,'fontName':'Halo-Bold','fontSize':10,'leading':12.5,'spaceBefore':6,'spaceAfter':5,'keepWithNext':True}),
    'code':ParagraphStyle('code',fontName='Code',fontSize=7.3,leading=9.3,textColor=INK,spaceAfter=0,splitLongWords=True),
}
LINK_RX=re.compile(r'\[([^\]]+)\]\((?:<([^>]+)>|([^\s)]+(?:\([^)]*\)[^\s)]*)?))\)')
def inline(text):
    saved=[]
    def protect(markup):
        saved.append(markup); return f'ZZHALOINLINE{len(saved)-1}ZZ'
    def link(match):
        label,target=match[1],match[2] or match[3]
        escaped=html.escape(target,quote=True)
        mark=f'<link href="{escaped}" color="#117D84">{html.escape(label)}</link>'
        if target.startswith(('https://','http://')):
            mark+=f' <font size="7.7" color="#58717E">({escaped})</font>'
        return protect(mark)
    text=LINK_RX.sub(link,text)
    text=re.sub(r'`([^`]+)`',lambda m:protect('<font name="Code" size="8">'+html.escape(m[1])+'</font>'),text)
    text=html.escape(text)
    text=re.sub(r'\*\*(.*?)\*\*',r'<b>\1</b>',text)
    text=re.sub(r'(?<!\*)\*([^*]+)\*(?!\*)',r'<i>\1</i>',text)
    for i,value in enumerate(saved): text=text.replace(f'ZZHALOINLINE{i}ZZ',value)
    return text

ledger=[]
def p(text,style='body',converted=False):
    item=Paragraph(text if converted else inline(text),styles[style])
    ledger.append(item.getPlainText())
    return item

class Doc(BaseDocTemplate):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,**kwargs)
        self.addPageTemplates(PageTemplate(id='body',frames=[Frame(42,43,528,700,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)],onPage=self.chrome))
    def beforeDocument(self): self.pages_by_key={}; self.headings=[]
    def chrome(self,c,doc):
        c.saveState(); c.setFont('Halo-Bold',7.8); c.setFillColor(TEAL)
        c.drawString(42,765,'HALO / BACKEND WORKING SPECIFICATION')
        c.setStrokeColor(LINE); c.line(42,755,570,755)
        c.setFont('Halo',7.5); c.setFillColor(GRAY)
        c.drawString(42,25,'October 3, 2026  |  Current requirements, not deployed functionality')
        c.drawRightString(570,25,str(doc.page)); c.restoreState()
    def afterFlowable(self,item):
        if hasattr(item,'key'):
            self.canv.bookmarkPage(item.key)
            self.canv.addOutlineEntry(item.getPlainText(),item.key,level=item.outline_level)
            self.pages_by_key[item.key]=self.page
            if item.toc:
                self.notify('TOCEntry',(item.outline_level,item.getPlainText(),self.page,item.key))
            self.headings.append({'title':item.getPlainText(),'page':self.page})

source=SOURCE.read_text(encoding='utf-8')
lines=source.splitlines()
story=[Spacer(1,30),p('HALO Backend Working Specification','h1'),
       p('The AI working edition for Vibhav and Yogi','h3'),
       p('Complete current requirements, grouped by implementation dependency and feature. The original historical compilation remains unchanged.'),
       p('45 feature groups / 24 source families / 1,630 traceable source blocks'),
       p('Prefer the matching Markdown file when giving this specification to Claude. Work in bounded packages with a persistent tracker and tests, not one giant implementation pass.'),
       p('All source constraints and unresolved gates remain explicit. This edition does not promise zero omissions by an AI or certify that integrations are production-ready.'),
       PageBreak(),p('Contents','h1')]
toc=TableOfContents()
toc.levelStyles=[ParagraphStyle('toc0',fontName='Halo-Bold',fontSize=9.4,leading=12.5,spaceBefore=5,textColor=INK,rightIndent=28),
                 ParagraphStyle('toc1',fontName='Halo',fontSize=8.5,leading=10.5,spaceBefore=2,textColor=GRAY,leftIndent=10,rightIndent=28)]
story += [toc,PageBreak()]
i=0; pending_anchor=None; hseq=0; have_top=False
while i<len(lines):
    line=lines[i].strip()
    if not line: i+=1; continue
    anchor=re.fullmatch(r'<a id="([^"]+)"></a>',line)
    if anchor: pending_anchor=anchor[1]; i+=1; continue
    heading=re.match(r'^(#{1,6})\s+(.*)',line)
    if heading:
        level,title=len(heading[1]),heading[2]
        if level==1:
            i+=1; continue
        if pending_anchor and (pending_anchor.startswith('shared-') or pending_anchor=='feature-packets'):
            story.append(PageBreak())
        item=p(title,'h'+str(min(level,4)))
        hseq+=1
        item.key=pending_anchor or f'heading-{hseq}'
        item.outline_level=0 if level==2 else 1
        item.toc=(level==2 or bool(re.match(r'^[A-Z]\d{2} ',title)))
        if item.outline_level==1 and not have_top: item.outline_level=0
        if item.outline_level==0: have_top=True
        story.append(item); pending_anchor=None; i+=1; continue
    if line.startswith('```'):
        i+=1
        while i<len(lines) and not lines[i].strip().startswith('```'):
            for fragment in textwrap.wrap(lines[i].expandtabs(4),width=117,replace_whitespace=False,drop_whitespace=False,break_on_hyphens=False) or [' ']:
                story.append(p(html.escape(fragment).replace(' ','&#160;'),'code',True))
            i+=1
        story.append(Spacer(1,5)); i+=1; continue
    if line.startswith('|') and i+1<len(lines) and re.fullmatch(r'\|[\s:|\-]+\|?',lines[i+1].strip()):
        def cells(value): return [x.strip().replace('\\|','|') for x in re.split(r'(?<!\\)\|',value.strip().strip('|'))]
        headers=cells(line); rows=[[p(cell,'thead') for cell in headers]]; i+=2
        while i<len(lines) and lines[i].strip().startswith('|'):
            values=cells(lines[i]); assert len(values)==len(headers)
            rows.append([p(cell,'cell') for cell in values]); i+=1
        if len(headers)==2: widths=[174,354]
        elif len(headers)==3: widths=[106,194,228]
        elif len(headers)==4: widths=[70,152,152,154]
        else: widths=[528/len(headers)]*len(headers)
        table=LongTable(rows,colWidths=widths,repeatRows=1,splitByRow=1,splitInRow=0,
                        hAlign='LEFT',spaceBefore=3,spaceAfter=8)
        table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),TEAL),('VALIGN',(0,0),(-1,-1),'TOP'),
                                   ('LEFTPADDING',(0,0),(-1,-1),5),('RIGHTPADDING',(0,0),(-1,-1),5),
                                   ('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),
                                   ('LINEBELOW',(0,1),(-1,-1),0.3,LINE),
                                   ('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#F3F7F8')])]))
        story.append(table); continue
    # Markdown paragraphs can span lines. Only the generated block boundaries are blank-delimited.
    current=[line]; i+=1
    while i<len(lines) and lines[i].strip() and not re.match(r'^(?:#{1,6} |<a |```|\|)',lines[i].strip()):
        current.append(lines[i].strip()); i+=1
    text='\n'.join(current)
    if text.startswith('> '): text=text[2:]
    story.append(p(text))

body=TMP/'body.pdf'
doc=Doc(str(body),pagesize=letter,title='HALO Backend Working Specification',author='HALO')
doc.multiBuild(story)
reader=PdfReader(body)
writer=PdfWriter(clone_from=reader)
writer.add_attachment(SOURCE.name,SOURCE.read_bytes())
writer.add_attachment(COVERAGE.name,COVERAGE.read_bytes())
writer.add_metadata({'/Title':'HALO Backend Working Specification','/Author':'HALO','/Subject':'Current requirements and staged AI implementation workflow'})
with FINAL.open('wb') as stream: writer.write(stream)
result={'pdf':str(FINAL),'pages':len(reader.pages),'markdown':str(SOURCE),
        'markdown_sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        'pages_by_key':doc.pages_by_key,'headings':doc.headings,'fragments':len(ledger)}
(TMP/'render-manifest.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
(TMP/'render-ledger.json').write_text(json.dumps(ledger,ensure_ascii=False),encoding='utf-8')
print(json.dumps({k:v for k,v in result.items() if k not in ('pages_by_key','headings')},indent=2))
