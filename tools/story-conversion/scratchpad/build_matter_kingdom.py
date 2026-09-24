# Build The Kingdom Come (book 6) matter — Front Matter / The Opening / The Recall /
# Further Resources — in the COMMONIZED format (§2c), templating off book 5's matter files
# (same shared-block structure) and dropping in the GENUINE book-6 content from the Doc
# exports. Stale Doc sections (book-1 carryover) get the generic placeholder treatment
# used by books 3–5 ("Coming soon." / blank tables / generic rubric skeleton).
# Prose is pulled from docs/*.md via convert_matter helpers — nothing transcribed by hand.
# No interior PDF exists for this book, so none of the PDF build_*.py scripts apply.
import os, re, sys
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # story-conversion/
sys.path.insert(0, HERE)
import convert_matter as cm

ESS = r"C:\Users\Steve\Dev\Noble-Imprint-Resources\series\Narrative Journey Series\Essentials"
OUTDIR = os.path.join(ESS, "The Kingdom Come", "sessions")
TPL = os.path.join(ESS, "The Glory Due His Name", "sessions")
ID = "TheKingdomCome"
CREED_KEY = "WitnessCreed"
TITLES = {1: "The Mission", 2: "The Work", 3: "The Call", 4: "The Harvest", 5: "The Soils",
          6: "The Lost", 7: "The Samaritan", 8: "The Encounter", 9: "The Stones",
          10: "The Forum", 11: "The Speech", 12: "The Bush"}

def w(name, text):
    with open(os.path.join(OUTDIR, name), "w", encoding="utf-8", newline="\n") as f:
        f.write(text.rstrip("\n") + "\n")
    print("wrote", name, len(text), "chars")

def tpl(name):
    return open(os.path.join(TPL, name), encoding="utf-8").read()

def sub_section(text, heading, new_body):
    """Replace the body under an exact heading line (up to the next heading of any level)."""
    pat = re.compile(r"(^" + re.escape(heading) + r"\n\n)(.*?)(?=^#{1,6} |\Z)", re.S | re.M)
    assert pat.search(text), f"heading not in template: {heading}"
    return pat.sub(lambda m: m.group(1) + new_body.strip("\n") + "\n\n", text, count=1)

def key_passage(n):
    """Key Passage straight from the session Doc's Key Elements."""
    s = open(os.path.join(HERE, "docs", f"session{n}.md"), encoding="utf-8").read()
    return cm.clean(re.search(r"\*\*Key Passage\*\*:\s*(.+)", s).group(1)).strip()

def catechism(v):
    v = cm.clean(v).strip()
    m = re.match(r"^(?!Q:)(.+\?)\s+(\S.*)$", v)
    return f"Q: {m.group(1)} A: {m.group(2)}" if m else v

def quote_md(p):
    sp = cm.split_attr(p)
    if not sp:  # plain (un-italicized) work title, e.g. "… heart. Arthur T. Pierson, The New Acts…"
        m = re.search(r"[.!?]\s+((?:[A-Z]\.\s*)*[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*)*,\s+[A-Z][^.!?]+?)\s*$", p)
        assert m, f"no attribution: {p[:60]}"
        auth, work = m.group(1).split(",", 1)
        sp = (p[:m.start() + 1], f"{auth}, _{work.strip()}_")
    q, a = sp
    a = re.sub(r'"([^"]+)"\s*$', r"_\1_", cm.clean(a))
    return f"> {cm.clean(q)}\n\n<< {a}"

def paras_between(P, start_pred, stop_pred):
    out, on = [], False
    for p in P:
        if on and stop_pred(p):
            break
        if on:
            out.append(p)
        elif start_pred(p):
            on = True
    return out

def is_head(p, text):
    h = cm.hd(p)
    return bool(h) and h[1].lower().startswith(text.lower())

def dash(ref):
    return re.sub(r"(\d)-(\d)", r"\1–\2", ref)

# ───────────────────────── Front Matter ─────────────────────────
fm = tpl("00-Front-Matter.md").replace(
    "_The Glory Due His Name: A Narrative Journey of Christian Devotion_",
    "_The Kingdom Come: A Narrative Journey of Christian Witness_")
w("00-Front-Matter.md", fm)  # Introductory Quotes stay "Coming soon." (no PDF p.1)

# ───────────────────────── The Opening ─────────────────────────
OP = cm.paras("opening.md")
op = tpl("00-The-Opening.md").replace("DevotionCreed", CREED_KEY)

ke = next(p for p in OP if "**Key Passage**" in p)
sm = cm.clean(re.search(r"\*\*Scripture Memory\*\*:\s*(.+)", ke).group(1)).strip()
ca = catechism(re.search(r"\*\*Catechism\*\*:\s*(.+)", ke).group(1))
op = op.replace("- **Scripture Memory** - ____", f"- **Scripture Memory** - {sm}")
op = op.replace("- **Catechism** - ____", f"- **Catechism** - {ca}", 1)

# Introduction = the two epigraphs under "# The Opening: Introduction" + the prose under
# "## Introduction (1500 words)" (the word-count spec is an authoring note — heading dropped).
epi = paras_between(OP, lambda p: is_head(p, "The Opening: Introduction"),
                    lambda p: bool(cm.hd(p)))
prose = paras_between(OP, lambda p: is_head(p, "Introduction (1500"),
                      lambda p: bool(cm.hd(p)))
intro = "\n\n".join([quote_md(p) for p in epi] + [cm.clean(p) for p in prose])
op = sub_section(op, "## Introduction", intro)

# Core Content — genuine book-6 focus lines, but the Doc uses OLD working titles
# (Fish/Testimony/Lake/Seed/Neighbor/Portico/Hill) and has the S6/S7 descriptions paired
# with the wrong passages. Use final titles + session-Doc Key Passages, and pair each
# description with its passage (S6 Luke 15 = seeking the lost; S7 Luke 10 = Samaritan).
desc = {}
for line in "\n".join(OP).split("\n"):
    m = re.match(r"^\*\*Session (\d+):[^*]*\*\*\s*\(([^)]*)\)\s*\|\s*(.+?)\s*$", line.strip())
    if m:
        desc[int(m.group(1))] = (m.group(2), cm.clean(m.group(3)))
assert len(desc) == 12, desc.keys()
desc[6], desc[7] = (desc[6][0], desc[7][1]), (desc[7][0], desc[6][1])
for n in range(1, 13):  # sanity: Doc passage == session Key Passage (modulo dash style)
    assert dash(desc[n][0]) == key_passage(n), (n, desc[n][0], key_passage(n))
rows = ["| Session | Focus |", "| :--- | :--- |"] + [
    f"| **Session {n}: {TITLES[n]}**<br>({key_passage(n)}) | {desc[n][1]} |" for n in range(1, 13)]
op = re.sub(r"\| Session \| Focus \|\n(?:\|.*\|\n)+", "\n".join(rows) + "\n", op)

# Planning Calendar — the Doc's is stale book-1; rebuild from the real session lineup.
cal = ["| Biblical Passage | Teacher | Date |", "| :--- | :--- | :--- |"] + [
    f"| **Session {n}: {TITLES[n]}**<br>({key_passage(n)}) |  |  |" for n in range(1, 13)]
op = re.sub(r"\| Biblical Passage \| Teacher \| Date \|\n(?:\|.*\|\n)+", "\n".join(cal) + "\n", op)

# Key Idea (genuine) — book-4 form: <Accent>Key Idea:</Accent> _…_
ki = next(p for p in OP if "Key Idea:" in p and p.lstrip().startswith("***"))
ki_text = cm.clean(re.sub(r"^\*\*\*Key Idea:\*\*\*\s*", "", ki.strip())).strip("_ ")
op = op.replace("<!-- @include: Opening_KeyIdea_Directions -->\n\nComing soon.",
                f"<!-- @include: Opening_KeyIdea_Directions -->\n\n<Accent>Key Idea:</Accent> _{ki_text}_")

# Personal Interest (genuine; the generic pair books 1/3/4 also use) → answerable Questions
piq = paras_between(OP, lambda p: is_head(p, "Personal Interest"), lambda p: bool(cm.hd(p)))
qs = [cm.is_num(p) for p in piq if cm.is_num(p) is not None]
pi = "\n\n".join(f"<Question id={ID}Opening-Interest-Q{i}>{i}. {cm.clean(t)}</Question>"
                 for i, (_, t) in enumerate(qs, 1) if t.strip())
op = op.replace("<!-- @include: Opening_PersonalInterest_Directions -->\n\nComing soon.",
                f"<!-- @include: Opening_PersonalInterest_Directions -->\n\n{pi}")
# Discussion Questions + Significant Quote = stale book-1 copies → stay "Coming soon."
# Project Preview / Example Creed = stale book-1 ("creedal statement … Christian belief",
# "==We believe in God Almighty==") → stay "Coming soon." Imaginative Storytelling +
# Growth Outcomes = shared boilerplate (identical in the Doc) → kept from template.
w("00-The-Opening.md", op)

# ───────────────────────── The Recall ─────────────────────────
RP = cm.paras("recall.md")
rc = tpl("13-The-Recall.md").replace("TheGloryDueHisNameRecall", f"{ID}Recall")
smr = next(p for p in RP if "Scripture Memory:" in p)
car = next(p for p in RP if p.lstrip("* ").startswith("Catechism:"))
rc = rc.replace("- **Scripture Memory** - ____",
                "- **Scripture Memory** - " + cm.clean(smr.split("Scripture Memory:", 1)[1]))
rc = rc.replace("- **Catechism** - ____",
                "- **Catechism** - " + catechism(car.split("Catechism:", 1)[1]))
repi = paras_between(RP, lambda p: is_head(p, "The Recall: Conclusion"), lambda p: bool(cm.hd(p)))
rpro = paras_between(RP, lambda p: cm.hd(p) and cm.hd(p)[1] == "Introduction",
                     lambda p: bool(cm.hd(p)))
concl = "\n\n".join([quote_md(p) for p in repi] + [cm.clean(p) for p in rpro])
rc = sub_section(rc, "## Conclusion", concl)
# Capstone: the Doc's "Creedal Confession" is stale book-1 → placeholder, named for this book.
rc = rc.replace("### Devotion Creed", "### Witness Creed")
# Selected Passages / Recommended Reading / Growth rubric = stale book-1 → template blanks.
w("13-The-Recall.md", rc)

# ───────────────────────── Further Resources ─────────────────────────
FP = cm.paras("further.md")
bib_intro = paras_between(FP, lambda p: is_head(p, "Bibliography"), lambda p: bool(cm.hd(p)))
rp_all = paras_between(FP, lambda p: is_head(p, "Reading Plan"), lambda p: bool(cm.hd(p)))
rp_epi = [p for p in rp_all[:2]]
rp_intro = rp_all[2]

# Parse the per-session reading plan: **Session N: Title** / **Week N** / **passage**
plan, cur, week = {}, None, None
for p in rp_all[3:]:
    t = p.strip().strip("*").strip()
    m = re.match(r"^Session (\d+):", t)
    if m:
        cur = int(m.group(1)); plan[cur] = {}; week = None; continue
    m = re.match(r"^Week (\d+)$", t)
    if m:
        week = int(m.group(1)); plan[cur][week] = []; continue
    if cur and week:
        plan[cur][week].append(t)

FIXES = {"Revelation 21:-22:5": "Revelation 21:1–22:5"}  # Doc typo (missing verse 1)
def ref(r):
    r = FIXES.get(r, r)
    return dash(r)

out = ["# Further Resources", "", "## Seeing the Design", "",
       "### Bibliography and Resources for Further Study", ""]
out += [cm.clean(p) + "\n" for p in bib_intro]
for n in range(1, 13):
    out += [f"#### Session {n}: {TITLES[n]}", ""]
out += ["### Reading Plan: Meeting God in His Word", ""]
out += [quote_md(p) + "\n" for p in rp_epi]
out += [cm.clean(rp_intro), ""]
complete = []
for n in range(1, 13):
    out += [f"#### Session {n}: {TITLES[n]}", ""]
    weeks = plan.get(n, {})
    if len(weeks) == 4 and all(len(v) == 5 for v in weeks.values()):
        wk = sorted(weeks)
        out += ["| " + " | ".join(f"Week {k}" for k in wk) + " |",
                "| " + " | ".join(":---" for _ in wk) + " |"]
        for i in range(5):
            out.append("| " + " | ".join(ref(weeks[k][i]) for k in wk) + " |")
        out.append("")
        complete.append(n)
w("14-Further-Resources.md", "\n".join(out))
print("reading plan tables built for sessions:", complete)
