#!/usr/bin/env python3
"""Verify every word of manuscript prose survived conversion.

For each session: tokenize the source Google-Doc export and the converted output
to bare lowercased words, then check the source token stream is an in-order
subsequence of the output token stream. Report the first unmatched source token
with context (that's the drop point).

Known source-only exclusions (legitimately NOT in the session file):
  - the Apostles' Creed body (now <!-- @include: ApostlesCreed -->)
  - "Insert ... template/instructions" placeholders
  - the "The Apostles' Creed" attribution label under Creedal Statement
  - empty Passage Outline digits
"""
import re, sys, os, glob

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.join(HERE, 'docs')
BOOK = 'C:/Users/Steve/Dev/Noble-Imprint-Resources/series/Narrative Journey Series/Essentials/The Story Behind It All (Final)/sessions'

def norm(s):
    s = s.replace('’',"'").replace('‘',"'").replace('“','"').replace('”','"')
    s = s.replace("'", "")            # God's -> gods
    s = s.lower()
    return re.findall(r'[a-z0-9]+', s)

def output_text(path):
    t = open(path, encoding='utf-8').read()
    t = re.sub(r'<!--.*?-->', ' ', t, flags=re.S)     # strip @include comments
    t = re.sub(r'</?[A-Za-z][^>]*>', ' ', t)          # strip real HTML tags only (not << / >)
    return t

def source_text(path):
    raw = open(path, encoding='utf-8').read().replace('\r\n','\n').lstrip('﻿')
    paras = re.split(r'\n\s*\n', raw)
    out = []
    in_creed = False
    for p in paras:
        s = p.strip()
        low = re.sub(r'[*_#]', '', s).strip().lower()
        # creed span: between "Creedal Statement" heading and "Key Elements" heading
        if low.startswith('creedal statement'):
            out.append(s); in_creed = True; continue
        if low.startswith('key elements'):
            in_creed = False; out.append(s); continue
        if in_creed:
            continue  # drop creed body + "The Apostles' Creed"
        if low.startswith('insert ') and ('template' in low or 'instruction' in low):
            continue
        # empty outline paragraph: only digits + dots
        if re.fullmatch(r'(\s*\d+\.\s*)+', s):
            continue
        out.append(s)
    return '\n\n'.join(out)

import difflib
def check(n, src_path, out_path):
    S = norm(source_text(src_path))
    O = norm(output_text(out_path))
    sm = difflib.SequenceMatcher(None, S, O, autojunk=False)
    gaps = []  # source spans present in source but NOT matched in output
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag in ('delete', 'replace'):
            gaps.append((i1, i2, ' '.join(S[i1:i2])))
    dropped = sum(i2 - i1 for (i1, i2, _) in gaps)
    return (n, dropped == 0, len(S), len(O), gaps)

# map session number -> output filename
titles = {1:'01-The-Battle',2:'02-The-Beginning',3:'03-The-Image',4:'04-The-Fall',
 5:'05-The-Promise',6:'06-The-Coming',7:'07-The-Cross',8:'08-The-Spirit',
 9:'09-The-Change',10:'10-The-Church',11:'11-The-Kingdom',12:'12-The-Finale'}

allok = True
for n in range(1,13):
    src = os.path.join(DOCS, f'session{n}.md')
    out = os.path.join(BOOK, titles[n] + '.md')
    if not os.path.exists(src) or not os.path.exists(out):
        print(f"session {n}: MISSING file"); allok=False; continue
    (_, ok, ns, no, gaps) = check(n, src, out)
    dropped = sum(i2-i1 for (i1,i2,_) in gaps)
    print(f"session {n:2d}: src={ns:5d} out={no:5d}  unmatched_src_words={dropped:4d}  {'OK 100%' if ok else 'CHECK'}")
    for (i1,i2,txt) in gaps:
        print(f"     [{i2-i1:3d} words @src#{i1}] {txt[:150]}")
    if not ok: allok=False
print('\nALL COMPLETE' if allok else '\nGaps listed above (may be benign: artifacts/duplicates)')
