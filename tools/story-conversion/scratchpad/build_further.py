# Populate The Bond Between Us 14-Further-Resources.md from the interior PDF.
# - Bibliography (idx 411-416): titles italicized using the PDF's own italic font runs.
# - Reading Plan (idx 418-421): rendered as per-session 4-column week tables, like the PDF.
import fitz, re

PDF = r"C:\Users\Steve\Downloads\The Bond Between Us_Interior_v15 (bleed).pdf"
OUT = r"C:\Users\Steve\Dev\Noble-Imprint-Resources\series\Narrative Journey Series\Essentials\The Bond Between Us\sessions\14-Further-Resources.md"
doc = fitz.open(PDF)

TITLES = {1:"The Household",2:"The Union",3:"The Offspring",4:"The Bond",5:"The Public",
          6:"The Work",7:"The Church",8:"The Community",9:"The Commons",10:"The Network",
          11:"The Worlds",12:"The Other"}

def norm(t):
    for a,b in [('\x92',"'"),('\x93','"'),('\x94','"'),('\x91',"'"),('​',''),(' ',' '),('\xa0',' '),('\x07','')]:
        t=t.replace(a,b)
    return t
def ws(t): return re.sub(r"\s+"," ",t).strip()

def block_to_md(blk):
    "reconstruct one citation block as markdown, wrapping the PDF's italic runs in _..._"
    runs=[]  # (text, italic) merged across spans/lines
    for line in blk.get("lines",[]):
        for sp in line.get("spans",[]):
            txt=norm(sp["text"]); ital=bool(sp["flags"] & 2)
            if runs and runs[-1][1]==ital:
                prev=runs[-1][0]
                if prev and not prev.endswith(" ") and not txt.startswith(" "): txt=" "+txt
                runs[-1]=(prev+txt, ital)
            else:
                runs.append((txt, ital))
    md=""
    for txt, ital in runs:
        if ital and txt.strip():
            md += (" " if txt[:1]==" " else "") + "_"+txt.strip()+"_" + (" " if txt[-1:]==" " else "")
        else:
            md += txt
    md=re.sub(r"\s+"," ",md).strip()
    md=re.sub(r"\s+([.,;:])", r"\1", md)          # drop space before punctuation
    return md

# ---------- bibliography (per-block; each PDF block = one citation) ----------
biblio={n:[] for n in range(1,13)}
cur=None
for i in range(411,417):
    for blk in doc[i].get_text("dict").get("blocks",[]):
        fonts={sp["font"] for line in blk.get("lines",[]) for sp in line.get("spans",[])}
        text=ws(" ".join(sp["text"] for line in blk.get("lines",[]) for sp in line.get("spans",[])))
        if not text: continue
        m=re.match(r"^Session\s+(\d+):", text)
        if m: cur=int(m.group(1)); continue
        if not any("AGaramondPro" in f for f in fonts): continue   # page furniture (ProximaNova)
        if cur is None: continue                                    # intro/section headings
        biblio[cur].append(block_to_md(blk))

# One title the PDF itself failed to italicize (S6 Banks) — italicize for consistency.
_FIX = "God the Worker: Journeys into the Mind, Heart, and Imagination of God"
for n in biblio:
    biblio[n]=[c.replace(_FIX, "_"+_FIX+"_") if (_FIX in c and "_"+_FIX not in c) else c
               for c in biblio[n]]

# ---------- reading plan (week tables) ----------
weektables=[]
for i in range(418,422):
    for tb in doc[i].find_tables().tables:
        data=tb.extract()
        if data and data[0] and str(data[0][0]).strip().lower().startswith("week"):
            weektables.append(data)
assert len(weektables)==12, len(weektables)
def clean_ref(x):
    x=ws(norm(x)); x=re.sub(r"[;\s]+$","",x)
    x=x.replace("Philppians","Philippians")
    # source typos: bare book name followed by a stray semicolon, and a ':' used as a
    # ref separator (both break the site's Bible-reference detection)
    x=re.sub(r"\b(Nehemiah|Ecclesiastes); (?=\d)", r"\1 ", x)
    x=x.replace("6:1–14: Romans", "6:1–14; Romans")
    x=x.replace("6:1–22 Genesis 47:13–31", "6:1–22; Genesis 47:13–31")
    return x
plan={}
for idx,data in enumerate(weektables, start=1):
    weeks=[clean_ref(c) for c in data[0]]
    cols=[]
    for cell in data[1]:
        parts=[clean_ref(p) for p in norm(cell or "").split("☐")]
        cols.append([p for p in parts if p])
    plan[idx]=(weeks, cols)

# ---------- assemble ----------
BIB_INTRO=("This resource is not innovative. It finds itself in a long tradition of faithful biblical "
 "scholarship. For the usability of this resource as an establishing tool for Christians and churches, "
 "we have opted not to include footnotes in the sessions themselves. In lieu of footnotes, we have given "
 "reference to pertinent resources in this backend section of the tool. In what follows, there is a list "
 "of resources that have been helpful in specific details, general insights, noteworthy observations, or "
 "simply as further resources for study as it relates to Christian community. These resources include "
 "commentaries that address the particular biblical passage being studied along with other written works "
 "that address the specific topic of the session. Many are simply resources for continued reflection on "
 "these matters. While not every facet of each resource is recommended, in its own way, each resource "
 "contributes to the overall conversation of understanding of Christian community. In this way, the "
 "following resource summary represents a blend of aids used in the development of this tool and a bank "
 "of resources for further study.")
RP_INTRO=("Disciplined Scripture reading is a formative habit that assists disciples and churches to grow "
 "in Christian maturity. Life transformation occurs when the Holy Spirit applies the truth of God's Word "
 "to the lives of his people. This reading plan organizes biblical passages that correspond with the "
 "twelve sessions in this study. Encouraging you to read the Bible (at least) five days per week and "
 "lasting a total of 48 weeks, this plan provides an ordered reading arrangement with built-in margin as "
 "your church community reads these biblical portions over the course of a year. Each block of four weeks "
 "starts with reading the biblical narrative for that session. After reading this passage, you will "
 "engage relevant passages across a variety of biblical genres. As you engage each passage (or set of "
 "passages), take time to follow a simple process of reflective reading: 1) read the passage, 2) meditate "
 "on its teaching, 3) discuss its meaning with others, and 4) pray the passage back to God. We trust that "
 'your church community will be edified in "the whole counsel of God" (Acts 20:27) as you see the beauty '
 "of God's truth expressed across the tapestry of Scripture.")

out=["# Further Resources","","## Seeing the Design","",
     "### Bibliography and Resources for Further Study","", BIB_INTRO]
for n in range(1,13):
    out+=["", f"#### Session {n}: {TITLES[n]}", ""]
    for c in biblio[n]: out.append(f"- {c}")
out+=["","### Reading Plan: Meeting God in His Word","", RP_INTRO]
for n in range(1,13):
    weeks, cols = plan[n]
    ndays = max(len(c) for c in cols)           # 5 daily readings per week
    out+=["", f"#### Session {n}: {TITLES[n]}", "",
          "| " + " | ".join(weeks) + " |",
          "| " + " | ".join([":---"]*len(weeks)) + " |"]
    for d in range(ndays):                        # one row per day; weeks are the columns
        row=[(cols[w][d] if d < len(cols[w]) else "") for w in range(len(weeks))]
        out.append("| " + " | ".join(row) + " |")

open(OUT,"w",encoding="utf-8",newline="\n").write("\n".join(out).rstrip("\n")+"\n")
print("wrote", OUT)
print("sample S1 biblio[0]:", biblio[1][0])
print("sample S4 biblio[0]:", biblio[4][0])
print("S1 reading weeks:", plan[1][0], "| wk1 days:", len(plan[1][1][0]))
PY_DONE=1
