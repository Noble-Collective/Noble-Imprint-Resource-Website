#!/usr/bin/env python3
"""Convert a Google-Docs markdown export of a session into the Noble Imprint
custom session markdown (with shared @includes and infographic includes).

Per Steve (2026-07): sessions 2-12 get NO creed bold and NO active practice dot
(do not infer either); keep the Passage Outline heading even when empty; never
fabricate Spiritual Practice liturgy.

Usage: python convert.py <session_number>
Reads docs/session{N}.md, writes out/session{N}.md, prints WARN lines.
"""
import re, sys, os

N = int(sys.argv[1])
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'docs', f'session{N}.md')
OUTDIR = os.path.join(HERE, 'out'); os.makedirs(OUTDIR, exist_ok=True)
OUT = os.path.join(OUTDIR, f'session{N}.md')

warnings = []
def warn(m): warnings.append(m)

# ── inline cleaning ──
def italic_to_us(s):
    s = s.replace('**', '\x00')
    s = re.sub(r'\*([^\*\x00]+?)\*', r'_\1_', s)
    return s.replace('\x00', '**')

def strip_short_bold(s):
    return re.sub(r'\*\*(.{1,2}?)\*\*', r'\1', s)  # **u**ltimate export artifacts

def clean(s):
    for a, b in [('\\!','!'),('\\[','['),('\\]',']'),('\\.','.'),("\\'","'"),
                 ('\\-','-'),('\\#','#'),('\\(','('),('\\)',')'),('\\&','&'),
                 ('\\>','>'),('\\<','<'),('\\*','*'),('\\_','_'),('\\:',':'),('\\;',';')]:
        s = s.replace(a, b)
    s = s.replace('’',"'").replace('‘',"'").replace('“','"').replace('”','"')
    s = strip_short_bold(s)
    s = italic_to_us(s)
    return s.strip()

# ── attribution split for quote paragraphs ──
BOOK = r"(?:[1-3]\s)?[A-Z][a-z]+(?:\s[A-Z][a-z]+)*"
SCRIP = BOOK + r"\s\d+:\d+(?:[–-]\d+)?(?:[;,]\s*(?:\d+:)?\d+(?:[–-]\d+)?)*"
def split_attr(p, loose=False):
    m = re.search(r'[.!?]\s+(' + SCRIP + r')\s*$', p)
    if m:
        return p[:m.start()+1].strip(), m.group(1).strip()
    m = re.search(r'[.!?]\s+([A-Z][^.]*?,\s*(?:\*[^*]+\*|"[^"]+"|“[^”]+”|_[^_]+_))\s*$', p)
    if m:
        return p[:m.start()+1].strip(), m.group(1).strip()
    if loose:
        idx = max(p.rfind('. '), p.rfind('! '), p.rfind('? '))
        if idx != -1:
            return p[:idx+1].strip(), p[idx+2:].strip()
    return None

def emit_quote(p, out, loose=False):
    sp = split_attr(p, loose=loose)
    if sp:
        q, a = sp
        a = clean(a)
        a = re.sub(r'"([^"]+)"\s*$', r'_\1_', a)  # quoted work title -> italic, per house style
        out.append('> ' + clean(q)); out.append(''); out.append('<< ' + a)
    else:
        out.append('> ' + clean(p)); warn(f"quote without attribution: {p[:60]}")

# ── callouts + run-in labels in commentary ──
def callouts(s):
    return re.sub(r'\*\*([^*]{12,}?)\*\*',
                  lambda m: f"<Callout>{m.group(1)}</Callout>" if ' ' in m.group(1) else m.group(0), s)

RUNIN = re.compile(r'^\*([^*]+?)\*(?:\*\*)?\.(?:\*\*)?\s+(.+)$')
def commentary_para(p, in_principles):
    if in_principles:
        m = RUNIN.match(p)
        if m:
            label = clean(m.group(1)).strip('_')
            return f"<Accent>_{label}._</Accent> {clean(callouts(m.group(2)))}"
    return clean(callouts(p))

def emit_synopsis(tbl, out):
    rows = []
    for line in tbl:
        cells = [c.strip() for c in line.strip().strip('|').split('|')]
        if set(''.join(cells)) <= set(':- '):
            continue
        rows.append(cells)
    if not rows:
        return
    title = rows[0][0].strip()
    out.append(''); out.append(f'| {title} |'); out.append('| :--- |')
    out.append(''); out.append('| | |'); out.append('| :--- | :--- |')
    for r in rows[1:]:
        left = clean(r[0]) if len(r) > 0 else ''
        right = clean(r[1]) if len(r) > 1 else ''
        out.append(f'| {left} | {right} |')

# ── parse doc into paragraphs ──
raw = open(SRC, encoding='utf-8').read().replace('\r\n', '\n').lstrip('﻿')
paras = [p.strip() for p in re.split(r'\n\s*\n', raw) if p.strip()]

def hd(p):
    m = re.match(r'^(#{1,6})\s+(.*)$', p)
    return (len(m.group(1)), m.group(2).replace('**', '').strip()) if m else None

def is_insert(p):
    return p.lower().startswith('insert ')

def qnum(p):
    m = re.match(r'^(\d+)\.\s+(.*)$', p)
    return (int(m.group(1)), m.group(2)) if m else None

def convert_question(text):
    m = re.match(r'^\*\*(.+?)\*\*:\s*(.*)$', text)
    if m:
        return f"<Accent>{clean(m.group(1))}:</Accent> {clean(m.group(2))}"
    return clean(text)

def flush_heading(level, text, extra=None):
    out.append(''); out.append('#'*level + ' ' + clean(text))
    if extra:
        out.append(''); out.append(extra)

def emit_questions(idkey):
    global i
    out.append('')
    while i < len(paras) and qnum(paras[i]):
        n, qt = qnum(paras[i]); i += 1
        out.append(f'<Question id=TheStoryFinalSes{N}-{idkey}-Q{n}>{n}. {convert_question(qt)}</Question>')

def skip_to_h2():
    global i
    while i < len(paras) and not (hd(paras[i]) and hd(paras[i])[0] == 2):
        i += 1

KNOWN = {'passage introduction': 4, 'key idea': 5, 'passage overview': 5,
         'introduction': 5, 'conclusion': 5}

out = []
i = 0
in_comment = in_principles = after_section_title = in_intro = False

while i < len(paras):
    p = paras[i]; i += 1
    h = hd(p)
    if h:
        level, text = h; low = text.lower()
        if level == 1:
            out.append('# ' + clean(text)); continue
        if level == 2:
            in_comment = in_principles = after_section_title = in_intro = False
            if 'biblical interpretation' in low:
                flush_heading(2, text, '<!-- @include: StudyTheText -->'); continue
            if 'theological dialogue' in low:
                flush_heading(2, text, '<!-- @include: ExploreTheText -->'); continue
            if 'personal reflection' in low:
                flush_heading(2, text, '<!-- @include: ApplyTheText -->'); continue
            if 'ministry practice' in low:
                flush_heading(2, text, '<!-- @include: MinisterTheText -->')
                out += ['', '### Application Questions',
                        '', '<!-- @include: ApplicationDirections -->',
                        '', f'<!-- @include: ApplicationQuestions id="TheStoryFinalSes{N}-RehearseScript" -->',
                        '', '<!-- @include: MinistryPracticesInfographic -->']
                skip_to_h2(); continue
            if 'missional outreach' in low:
                flush_heading(2, text, '<!-- @include: WitnessTheText -->')
                out += ['', '### Strategy Questions',
                        '', '<!-- @include: StrategyDirections -->',
                        '', f'<!-- @include: StrategyQuestions id="TheStoryFinalSes{N}-PublicizeTruth" -->',
                        '', '<!-- @include: MissionPracticesInfographic -->']
                skip_to_h2(); continue
            if low == 'introduction':
                flush_heading(2, text); in_intro = True; continue
            flush_heading(2, text); continue

        if in_comment:
            # Unified commentary-heading handling: normalize by TEXT, not doc level.
            if low.startswith('biblical principles'):
                in_principles = True; after_section_title = False; flush_heading(6, text); continue
            if low.startswith('biblical narrative'):
                in_principles = False; after_section_title = False; flush_heading(6, text); continue
            if low == 'session synopsis':
                in_principles = False; after_section_title = False; flush_heading(4, text)
                tbl_lines = []
                while i < len(paras) and paras[i].lstrip().startswith('|'):
                    tbl_lines.extend(paras[i].split('\n')); i += 1
                emit_synopsis(tbl_lines, out); continue
            if low == 'passage outline':
                in_principles = False; after_section_title = False; flush_heading(5, text)
                # Outline rows are packed into a single multi-line paragraph (no blank
                # lines between them). Consume that block whether filled or empty.
                if i < len(paras) and re.match(r'^\d+\.', paras[i].strip()):
                    items = []
                    for line in paras[i].split('\n'):
                        m = re.match(r'^\s*(\d+)\.\s*(.*?)\s*$', line)
                        if m and m.group(2).strip():
                            items.append((m.group(1), m.group(2)))
                    i += 1
                    if items:
                        out.append('')
                        for (n, t) in items:
                            out.append(f'{n}. {clean(t)}')
                    else:
                        warn("empty Passage Outline (heading kept)")
                continue
            if low in KNOWN:
                in_principles = False; after_section_title = False
                flush_heading(KNOWN[low], text); continue
            # unknown heading inside commentary: stray paragraph vs real title
            if re.search(r'[.!?]$', text) or '. ' in text:
                warn(f"stray heading -> body: {text[:55]}")
                out.append(''); out.append(commentary_para(text, in_principles)); continue
            lvl = 4 if level <= 4 else 5
            in_principles = False; after_section_title = (lvl == 4)
            flush_heading(lvl, text); continue

        if level == 3:
            if 'creedal statement' in low:
                flush_heading(3, text, '<!-- @include: ApostlesCreed -->')
                while i < len(paras) and not hd(paras[i]):
                    i += 1
                continue
            if 'key elements' in low:
                flush_heading(3, text); continue
            if 'observation questions' in low:
                flush_heading(3, text, '<!-- @include: ObservationDirections -->')
                emit_questions('Hearing'); continue
            if 'storycraft' in low:
                flush_heading(3, text, '<!-- @include: StorycraftDirections -->')
                out += ['', '#### Narrative Elements',
                        '', f'<!-- @include: NarrativeElementsQuestion id="TheStoryFinalSes{N}-Storycraft-Q1" -->',
                        '', '#### Story Retell',
                        '', f'<!-- @include: StoryRetellQuestion id="TheStoryFinalSes{N}-Storycraft-Q2" -->',
                        '', '<!-- @include: NarrativeStructureInfographic -->']
                while i < len(paras) and not (hd(paras[i]) and hd(paras[i])[0] <= 3):
                    i += 1
                continue
            if 'discussion questions' in low:
                flush_heading(3, text, '<!-- @include: DiscussionDirections -->')
                emit_questions('TheoDialogue'); continue
            if 'biblical commentary' in low:
                flush_heading(3, text, '<!-- @include: BiblicalCommentaryDirections -->')
                out += ['', '<!-- @include: NarrativeTheologyInfographic -->']
                in_comment = True; in_principles = False; continue
            if 'reflection questions' in low:
                flush_heading(3, text, '<!-- @include: ReflectionDirections -->')
                emit_questions('EnteringStory'); continue
            if 'spiritual practice' in low:
                flush_heading(3, text)
                # Emit any manuscript practice content (most sessions have none), then
                # the shared infographic — mirrors session 1's order (practice, then chart).
                while i < len(paras) and not (hd(paras[i]) and hd(paras[i])[0] <= 2):
                    pp = paras[i]; i += 1
                    hh = hd(pp)
                    if hh:
                        flush_heading(max(4, hh[0]), hh[1]); continue
                    mt = re.fullmatch(r'\*\*(.+?)\*\*', pp.strip())
                    if mt:  # bold-only line = the practice's title
                        flush_heading(4, mt.group(1)); continue
                    if ' | ' in pp and not pp.lstrip().startswith('|'):  # "Label | prompt"
                        label, _, rest = pp.partition(' | ')
                        out += ['', f'<Accent>{clean(label)}:</Accent> {clean(rest)}']; continue
                    out += ['', clean(pp)]
                out += ['', '<!-- @include: SpiritualPracticesInfographic -->']
                continue
            flush_heading(3, text); continue

        flush_heading(level, text); continue

    # ── non-heading paragraph ──
    if is_insert(p):
        continue
    if in_intro:
        out.append('')
        if split_attr(p):
            emit_quote(p, out)
        else:
            out.append(clean(p))
        continue
    if in_comment:
        if after_section_title:
            out.append(''); emit_quote(p, out, loose=True); continue
        out.append(''); out.append(commentary_para(p, in_principles)); continue
    bm = re.match(r'^\*\s+(.*)$', p)
    if bm:
        item = bm.group(1)
        lm = re.match(r'^\*\*(.+?)\*\*:\s*(.*)$', item)
        if lm:
            out.append(f'- **{clean(lm.group(1))}** - {clean(lm.group(2))}')
        else:
            out.append('- ' + clean(item))
        continue
    out.append(''); out.append(clean(p))

result = '\n'.join(out).strip() + '\n'
result = re.sub(r'\n{3,}', '\n\n', result)
open(OUT, 'w', encoding='utf-8').write(result)
print(f"wrote {OUT} ({len(result)} bytes)")
for w in warnings:
    print('WARN:', w)
