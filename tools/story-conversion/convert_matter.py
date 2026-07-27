#!/usr/bin/env python3
"""Convert the Opening / Recall / Further-Resources Google-Doc exports into the
Noble Imprint custom markdown. These are front/back-matter pages (not the session
template), already self-structured to the Bond framework, so this is mostly
format conversion. Writes out/<name>.md.
"""
import re, os, sys
HERE=os.path.dirname(os.path.abspath(__file__))
DOCS=os.path.join(HERE,'docs'); OUT=os.path.join(HERE,'out'); os.makedirs(OUT,exist_ok=True)
ID_PREFIX = "TheStory"  # PER-BOOK: question-id prefix

def italic_to_us(s):
    s=s.replace('**','\x00'); s=re.sub(r'\*([^\*\x00]+?)\*', r'_\1_', s); return s.replace('\x00','**')
def clean(s):
    for a,b in [('\\!','!'),('\\[','['),('\\]',']'),('\\.','.'),("\\'","'"),('\\-','-'),
                ('\\#','#'),('\\(','('),('\\)',')'),('\\&','&'),('\\>','>'),('\\<','<'),
                ('\\*','*'),('\\_','_'),('\\:',':'),('\\;',';'),('\\=','='),('\\|','|')]:
        s=s.replace(a,b)
    s=s.replace('’',"'").replace('‘',"'").replace('“','"').replace('”','"')
    s=re.sub(r'\*\*(.{1,2}?)\*\*', r'\1', s)  # short-bold artifacts
    return italic_to_us(s).strip()

BOOK=r"(?:[1-3]\s)?[A-Z][a-z]+(?:\s[A-Z][a-z]+)*"
SCRIP=BOOK+r"\s\d+:\d+(?:[–-]\d+)?(?:[;,]\s*(?:\d+:)?\d+(?:[–-]\d+)?)*"
def split_attr(p):
    m=re.search(r'[.!?]\s+('+SCRIP+r')\s*$',p)
    if m: return p[:m.start()+1].strip(), m.group(1).strip()
    m=re.search(r'[.!?]\s+((?:[A-Z]\.\s*)*[A-Z][A-Za-z.\'’-]*(?:\s+(?:[A-Z]\.?|and|von|van|de|[A-Z][a-z]+))*,\s*(?:\*[^*]+\*|"[^"]+"|“[^”]+”|_[^_]+_))\s*$',p)
    if m: return p[:m.start()+1].strip(), m.group(1).strip()
    return None

def emit_creed(creed, out):
    lines=[c for c in creed if c.lower().strip()!='a christian creed']
    out.append('')
    for idx,c in enumerate(lines):
        if idx>0: out.append('>')
        out.append('> '+clean(c))
    out+=['', "<< A Christian Creed"]
def emit_quote(p,out):
    sp=split_attr(p)
    if sp:
        q,a=sp; a=clean(a); a=re.sub(r'"([^"]+)"\s*$', r'_\1_', a)
        out+= ['', '> '+clean(q), '', '<< '+a]
    else:
        out+= ['', '> '+clean(p)]

def paras(name):
    raw=open(os.path.join(DOCS,name),encoding='utf-8').read().replace('\r\n','\n').lstrip('﻿')
    return [p.strip() for p in re.split(r'\n\s*\n',raw) if p.strip()]
def hd(p):
    m=re.match(r'^(#{1,6})\s+(.*)$',p); return (len(m.group(1)),m.group(2).replace('**','').strip()) if m else None
def is_num(p):
    m=re.match(r'^(\d+)\.\s+(.*)$',p,re.S); return (int(m.group(1)),re.sub(r'\s+',' ',m.group(2)).strip()) if m else None
def is_bullet(p):
    m=re.match(r'^\*\s+(.*)$',p,re.S); return re.sub(r'\s+',' ',m.group(1)).strip() if m else None

def session_list_line(t):
    # "**Session 1: The Battle** (Job 1:1–2:13) | desc"  ->  "- **Session 1: The Battle** (Job 1:1–2:13) — desc"
    t=re.sub(r'\s*\|\s*',' — ',t.strip())
    return '- '+clean(t)

# ─────────────────────────── The Opening / The Recall ───────────────────────────
def build_opening_recall(name, title, kind):  # kind: 'opening'|'recall'
    P=paras(name); out=['# '+title]; i=0; idbase=ID_PREFIX+('Opening' if kind=='opening' else 'Recall')
    # 1) creed block (opening: under first "# Introduction"; recall: "# Conclusion" empty)
    # find "# The Opening"/"# The Recall"
    def find_h1(txt):
        for j,p in enumerate(P):
            h=hd(p)
            if h and h[0]==1 and h[1].lower()==txt: return j
        return None
    j_title=find_h1('the '+kind if kind=='recall' else 'the opening')
    j_title=None
    for j,p in enumerate(P):
        h=hd(p)
        if h and h[0]==1 and h[1].lower() in ('the opening','the recall'): j_title=j; break
    creed=[P[k] for k in range(1,j_title) if not hd(P[k])]  # paras before title, after first heading
    out+=['', '## Overview']
    if creed and any(len(c)>40 for c in creed):
        out+=['', '### Creedal Statement']
        emit_creed(creed, out)
    # 2) Key Elements: bullets right after the title heading
    out+=['', '### Key Elements']
    k=j_title+1
    while k<len(P) and is_bullet(P[k]) is not None:
        item=is_bullet(P[k]); k+=1
        m=re.match(r'^\*\*(.+?)\*\*:\s*(.*)$',item)
        if m:
            label,val=m.group(1),m.group(2)
            if label.lower()=='catechism':
                # "What is the foundation of the Christian life? Faith." -> Q: … A: Faith.
                qa=val.strip()
                mm=re.match(r'^(.*\?)\s*(.+?)\.?$',qa)
                if mm: val=f"Q: {mm.group(1).strip()} A: {mm.group(2).strip()}."
                out.append(f'- **{clean(label)}** - {clean(val)}')
            else:
                out.append(f'- **{clean(label)}** - {clean(val)}')
        else:
            out.append('- '+clean(item))
    # 3) walk the rest
    i=k; cur_h2=None; cur_h3=None; qn=0
    while i<len(P):
        p=P[i]; i+=1; h=hd(p)
        if h:
            lvl,text=h; low=text.lower()
            if lvl==1:
                # "# The Opening: Introduction" -> ## Introduction ; "# The Recall: Conclusion" -> ## Conclusion
                sub=text.split(':',1)[1].strip() if ':' in text else text
                out+=['', '## '+sub]; cur_h2=sub.lower(); cur_h3=None; qn=0; continue
            if lvl==2:
                # drop editorial "(1500 words)" etc.
                text=re.sub(r'\s*\(\d+\s*words?\)\s*$','',text)
                if re.match(r'^introduction$', text, re.I) and cur_h2 in ('introduction','conclusion'):
                    continue  # merge the duplicate Introduction sub-heading into the body
                out+=['', '## '+clean(text)]; cur_h2=low; cur_h3=None; qn=0; continue
            if lvl>=3:
                out+=['', '### '+clean(text)]; cur_h3=low; qn=0; continue
        # paragraph
        nb=is_num(p); bl=is_bullet(p); sp=split_attr(p)
        # session-list lines (but not the Selected Passages / Recommended Reading sections,
        # which have their own handlers below)
        if re.match(r'^\*\*Session\s+\d+',p) and not (cur_h3 and ('selected passages' in cur_h3 or 'recommended reading' in cur_h3)):
            out+=['', session_list_line(p)]; continue
        # quotes in Introduction/Conclusion and Significant Quote
        if sp and (cur_h2 in ('introduction','conclusion') or (cur_h3 and 'significant quote' in cur_h3)):
            emit_quote(p,out); continue
        # numbered question -> <Question>
        if nb is not None and (cur_h3 and ('question' in cur_h3 or 'interest' in cur_h3)):
            n,qt=nb; qn+=1
            sect = 'Interest' if 'interest' in cur_h3 else ('Discussion' if 'discussion' in cur_h3 else 'Q')
            out+=['', f'<Question id={idbase}-{sect}-Q{n}>{n}. {clean(qt)}</Question>']; continue
        # ***Key Idea:*** *text*
        m=re.match(r'^\*\*\*(.+?):\*\*\*\s*\*?(.*?)\*?$',p)
        if m:
            out+=['', f'<Accent>{clean(m.group(1))}:</Accent> _{clean(m.group(2))}_']; continue
        # Selected Passages: one run-on paragraph with many **Session N** -> split into lines
        if cur_h3 and 'selected passages' in cur_h3 and '**Session' in p:
            for part in re.split(r'(?=\*\*Session\s+\d+)', p):
                part=part.strip()
                if part: out+=['', session_list_line(part)]
            continue
        # Recommended Reading: "**Session N** | Topic | - book - book" -> session + book sub-bullets
        if cur_h3 and 'recommended reading' in cur_h3 and p.startswith('**Session'):
            segs=[s.strip() for s in re.split(r'\s*\|\s*', p)]
            head=segs[0]; topic=segs[1] if len(segs)>1 else ''; books=segs[2] if len(segs)>2 else ''
            out+=['', f'- {clean(head)} — {clean(topic)}']
            for bk in re.split(r'\s*\\?-\s+', books):
                bk=bk.strip().rstrip('\\').strip()
                if bk: out.append(f'  - {clean(bk)}')
            continue
        # highlight ==...== (Example Creed shorthand) -> full creed blockquote
        if '==' in p and 'we believe in god almighty' in p.lower():
            emit_creed(creed, out); continue
        # Growth Evaluation metrics legend -> 5 bullets (the doc export flattened the
        # rubric grid; the per-level cells can't be recovered — see MATTER_DECISIONS)
        if cur_h3 and 'growth evaluation' in cur_h3 and p.strip().startswith('**Metrics'):
            body=re.sub(r'^\*\*Metrics\*\*\s*','',p.strip())
            out+=['', 'The evaluation considers five metrics:']
            for part in re.split(r'(?=\*\*(?:Conviction|Commitment|Conduct|Community|Character)\*\*)', body):
                part=part.strip()
                if part: out.append('- '+clean(part))
            continue
        if cur_h3 and 'growth evaluation' in cur_h3 and re.match(r'^\*\*(Exemplary|Mature|Developing|Emerging|Unsound)\*\*',p.strip()):
            out+=['', clean(p)]; continue
        if bl is not None:
            out+=['- '+clean(bl)]; continue
        out+=['', clean(p)]
    result='\n'.join(out).strip()+'\n'
    return re.sub(r'\n{3,}','\n\n',result)

# ─────────────────────────── Further Resources ───────────────────────────
def build_further():
    P=paras('further.md'); out=['# Further Resources']; i=0; cur=None
    while i<len(P):
        p=P[i]; i+=1; h=hd(p)
        if h:
            lvl,text=h; low=text.lower()
            if lvl==1 and 'scripture verses' in low: break  # drop trailing editorial note
            if lvl==1: continue  # "# Further Resources" already emitted
            if lvl==2: out+=['', '## '+clean(text)]; continue
            if lvl>=3:
                out+=['', '### '+clean(text)]
                cur='reading' if 'reading plan' in low else ('biblio' if 'bibliography' in low else None)
                continue
        # session group header  "**Session 1: The Battle**"
        m=re.match(r'^\*\*(Session\s+\d+:[^*]+)\*\*\s*$',p.strip())
        if m: out+=['', '#### '+clean(m.group(1))]; continue
        # reading-plan week line "Week 1 - a - b - c"
        if re.match(r'^Week\s+\d+',p.strip()):
            wk=re.sub(r'\s*[-–]\s*',' · ',clean(p).strip())
            out+=['', '- '+wk]; continue
        sp=split_attr(p)
        if sp: emit_quote(p,out); continue
        out+=['', clean(p)]
    return re.sub(r'\n{3,}','\n\n','\n'.join(out).strip()+'\n')

files={
 '00-The-Opening.md': build_opening_recall('opening.md','The Opening','opening'),
 '13-The-Recall.md': build_opening_recall('recall.md','The Recall','recall'),
 '14-Further-Resources.md': build_further(),
}
for fn,content in files.items():
    open(os.path.join(OUT,fn),'w',encoding='utf-8',newline='').write(content)
    print(f"wrote {fn} ({len(content)} bytes)")
