# Build The Bond Between Us matter (Front Matter / The Opening / The Recall) in the
# COMMONIZED format (§2c) by templating off book 3 and dropping in book-4 content.
# Prose is pulled verbatim from the Doc exports (normalized via convert_matter helpers)
# so nothing is transcribed by hand; the Growth-Evaluation rubric is read from the PDF.
# NOTE (§2c): convert_matter.py is NOT run for Opening/Recall — it emits the old flat
# format. This script assembles the commonized structure directly.
import os, re, sys
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # story-conversion/
sys.path.insert(0, HERE)
import convert_matter as cm

BONDDIR = r"C:\Users\Steve\Dev\Noble-Imprint-Resources\series\Narrative Journey Series\Essentials\The Bond Between Us\sessions"
PDF = r"C:\Users\Steve\Downloads\The Bond Between Us_Interior_v15 (bleed).pdf"

def w(name, lines):
    path = os.path.join(BONDDIR, name)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines).rstrip("\n") + "\n")
    print("wrote", name, "(", sum(len(l) for l in lines), "chars )")

# ---------- helpers over Doc paragraphs ----------
def find_head(P, text):
    for j, p in enumerate(P):
        h = cm.hd(p)
        if h and h[1].lower() == text.lower():
            return j
    raise SystemExit(f"heading not found: {text!r}")

def body_between(P, j0, j1):
    "non-heading, non-bullet, non-numbered body paragraphs in (j0, j1)"
    out = []
    for k in range(j0 + 1, j1):
        p = P[k]
        if cm.hd(p) or cm.is_bullet(p) is not None or cm.is_num(p) is not None:
            continue
        out.append(p)
    return out

def quote_lines(p):
    "quote paragraph -> ['> q', '', '<< attr'] using split_attr; strip wrapping quotes"
    sp = cm.split_attr(p)
    if not sp:
        # fallback: trailing 'Author Name, Work Title' after a closing quote, where the
        # work is PLAIN text (split_attr only matches italic/quoted works). E.g. the
        # Baxter significant quote: '...reformation.” Richard Baxter, The Christian Directory'
        idx = max(p.rfind('”'), p.rfind('"'))
        if idx != -1:
            tail = p[idx + 1:].strip()
            m = re.match(r'^((?:[A-Z][A-Za-z.\'’-]+\s*)+,\s+[A-Z].+?)\s*$', tail)
            if m:
                sp = (p[:idx + 1], m.group(1))
    if sp:
        q, a = sp
        a = cm.clean(a)
        a = re.sub(r'"([^"]+)"\s*$', r'_\1_', a)          # "Work" -> _Work_
        a = re.sub(r'(,\s+)([^_"].*?)$', r'\1_\2_', a)    # plain Work -> _Work_
        q = cm.clean(q).strip().strip('"').strip()
        return ["> " + q, "", "<< " + a]
    return ["> " + cm.clean(p).strip().strip('"').strip()]

def numbered_items(P, j0, j1):
    "collect '1. …' items between headings j0..j1; the Doc packs several per paragraph"
    items = []
    for k in range(j0 + 1, j1):
        if cm.hd(P[k]):
            continue
        for line in P[k].split("\n"):
            s = line.strip()
            if not s:
                continue
            m = re.match(r'^(\d+)\.\s+(.*)$', s)
            if m:
                items.append(m.group(2).strip())
            elif items:                      # wrapped continuation line
                items[-1] = (items[-1] + " " + s).strip()
    return [re.sub(r'\s+', ' ', x).strip() for x in items]

def q_block(idbase, section, n, text):
    return f"<Question id={cm.ID_PREFIX}{idbase}-{section}-Q{n}>{n}. {cm.clean(text)}</Question>"

# ============================================================ FRONT MATTER
# Introductory Quotes are the PDF p.1 epigraphs (Augustine / Pascal / Donne / Baxter) —
# community-themed; NOT the "1 Tim + Spurgeon" pair (those are the Opening intro epigraphs, p.21).
FM_QUOTES = [
    ("For there is nothing so social by nature, so unsocial by its corruption, as this [human] race.",
     "Augustine, _The City of God_"),
    ("The body loves the hand; and the hand, if it had a will, should love itself in the same way as it is loved by the soul. All love which goes beyond this is unfair.",
     "Blaise Pascal, _Thoughts_"),
    ("No man is an island, entire of itself; every man is a piece of the continent, a part of the main; if a clod be washed away by the sea, Europe is the less, as well as if a promontory were, as well as if a manor of thy friend's or of thine own were; any man's death diminishes me, because I am involved in mankind, and therefore never send to know for whom the bell tolls; it tolls for thee.",
     "John Donne, _Devotions Upon Emergent Occasions_"),
    ("It is a mercy to have a faithful friend, that loveth you entirely, and is as true to you as yourself, to whom you may open your mind and communicate your affairs, and who would be ready to strengthen you, and divide the cares of your affairs and family with you, and help you to bear your burdens, and comfort you in your sorrows, and be the daily companion of your lives, and partaker of your joys and sorrows. And it is a mercy to have so near a friend to be a helper to your soul; to join with you in prayer and other holy exercises; to watch over you and tell you of your sins and dangers, and to stir up in you the grace of God, and remember to you of the life to come, and cheerfully accompany you in the ways of holiness.",
     "Richard Baxter, _A Christian Directory_"),
]
fm = ["# Front Matter", "", "## Introductory Quotes"]
for q, a in FM_QUOTES:
    fm += ["", "> " + q, "", "<< " + a]
fm += [
    "", "## A Narrative Journey Series",
    "", "<!-- @include: NarrativeJourneySeriesList -->",
    "", "## Publishing and Licensing",
    "", "_The Bond Between Us: A Narrative Journey of Christian Community_, Pre-Release Edition",
    "", "<!-- @include: PublishingLicensing -->",
    "", "## Series Introduction",
    "", "<!-- @include: SeriesIntroduction -->",
    "", "## Session Overview",
    "", "<!-- @include: SessionOverview -->",
]
w("00-Front-Matter.md", fm)

# ============================================================ THE OPENING
O = cm.paras("opening.md")
# epigraphs: between "The Opening: Introduction" and "Introduction (1500 words)"
j_ointro = find_head(O, "The Opening: Introduction")
j_intro1500 = next(j for j in range(j_ointro + 1, len(O))
                   if cm.hd(O[j]) and O[j].lower().replace("*", "").strip().startswith("## introduction"))
epi = body_between(O, j_ointro, j_intro1500)          # 2 epigraphs (1 Tim, Spurgeon)
# intro essay: between "Introduction (1500 words)" and "Survey the Landscape"
j_survey = find_head(O, "Survey the Landscape")
intro_essay = body_between(O, j_intro1500, j_survey)   # 8 paragraphs

# core content sessions: numbered "Session N:" body lines between "Core Content" and "Key Idea"
j_core = find_head(O, "Core Content")
j_keyidea = find_head(O, "Key Idea")
sess = []
for k in range(j_core + 1, j_keyidea):
    m = re.match(r'^Session\s+(\d+):\s*(.+?)\s*\(([^)]*)\)\s*(.*)$', O[k].strip(), re.S)
    if m:
        n, title, ref, focus = m.groups()
        sess.append((int(n), cm.clean(title).strip(), cm.clean(ref).strip(),
                     re.sub(r'\s+', ' ', cm.clean(focus)).strip()))
assert len(sess) == 12, f"core content sessions: {len(sess)}"

key_idea = body_between(O, j_keyidea, find_head(O, "Personal Interest"))[0]

# personal interest questions
j_pi = find_head(O, "Personal Interest")
j_ff = find_head(O, "Faith Foundation: Exploring the Terrain")
pi_qs = numbered_items(O, j_pi, j_ff)
# discussion questions
j_dq = find_head(O, "Discussion Questions")
j_sq = find_head(O, "Significant Quote")
disc_qs = numbered_items(O, j_dq, j_sq)
# significant quote (Baxter): body paragraph with an attribution between SQ and Learning Plan
j_lp = find_head(O, "Learning Plan: Charting the Course")
sq_bodies = body_between(O, j_sq, j_lp)
sig_quote = max(sq_bodies, key=len)   # the Baxter quote (plain-text work; split_attr misses it)

op = ["# The Opening", "", "## Overview", "", "### Creedal Statement",
      "", "<!-- @include: CommunityCovenant -->",
      "", "### Key Elements",
      "- **Key Passage** - Preview",
      '- **Scripture Memory** - "We ... are one body in Christ, and individually members one of another." Romans 12:5',
      "- **Catechism** - Q: How are Christians to relate to one another? A: Community.",
      "", "## Introduction"]
for p in epi:
    op += [""] + quote_lines(p)
for p in intro_essay:
    op += ["", cm.clean(p)]

op += ["", "## Book Overview: Surveying the Landscape",
       "", "<!-- @include: Opening_BookOverview_Directions -->",
       "", "### Core Content",
       "", "<!-- @include: Opening_CoreContent_Directions -->",
       "", "| Session | Focus |", "| :--- | :--- |"]
for n, title, ref, focus in sess:
    op.append(f"| **Session {n}: {title}**<br>({ref}) | {focus} |")
op += ["", "### Key Idea",
       "", "<!-- @include: Opening_KeyIdea_Directions -->",
       "", f"<Accent>Key Idea:</Accent> _{cm.clean(key_idea)}_",
       "", "### Personal Interest",
       "", "<!-- @include: Opening_PersonalInterest_Directions -->", ""]
for i, qq in enumerate(pi_qs, 1):
    op += [q_block("Opening", "Interest", i, qq), ""]
op += ["## Faith Foundation: Exploring the Terrain",
       "", "<!-- @include: Opening_FaithFoundation_Directions -->",
       "", "### Discussion Questions",
       "", "<!-- @include: Opening_Discussion_Directions -->", ""]
for i, qq in enumerate(disc_qs, 1):
    op += [q_block("Opening", "Discussion", i, qq), ""]
op += ["### Significant Quote",
       "", "<!-- @include: Opening_SignificantQuote_Directions -->", ""]
op += quote_lines(sig_quote)
op += ["", "Record any initial observations or community insights below.",
       "", "## Learning Plan: Charting the Course",
       "", "<!-- @include: Opening_LearningPlan_Directions -->",
       "", "### Session Framework",
       "", "<!-- @include: Opening_SessionFramework_Intro -->",
       "", "<!-- @include: Opening_SessionFrameworkInfographic -->",
       "", "### Planning Calendar",
       "", "<!-- @include: Opening_PlanningCalendar_Directions -->",
       "", "| Biblical Passage | Teacher | Date |", "| :--- | :--- | :--- |"]
for n, title, ref, focus in sess:
    op.append(f"| **Session {n}: {title}**<br>({ref}) |  |  |")
op += ["", "## Core Project: Synthesizing the Faith",
       "", "<!-- @include: Opening_CoreProject_Directions -->",
       "", "### Project Preview", "", "Coming soon.",
       "", "### Example Covenant",
       "", "Coming soon.",
       "", "### Imaginative Storytelling",
       "", "<!-- @include: Opening_ImaginativeStorytelling_Directions -->",
       "", "If I could know the truth about life, these are some things I would want to understand…",
       "", "If I could grow in my understanding of the truth, this is how my life would look…",
       "", "## Faith Practice: Following the Way",
       "", "<!-- @include: Opening_FaithPractice_Directions -->",
       "", "### Growth Outcomes",
       "", "<!-- @include: Opening_GrowthOutcomes_Directions -->",
       "", "As a result of this study, disciples, families, and churches will …",
       "- **establish** a mature Christian understanding of the essentials of the Christian faith",
       "- **cultivate** a deepening commitment to biblical truth",
       "- **demonstrate** clarity and capability in articulating Christian truth",
       "- **participate** in teaching basic Christian truths to others",
       "", "### Focused Area",
       "", "<!-- @include: Opening_FocusedArea_Directions -->",
       "", "### Community Prayer",
       "", "<!-- @include: Opening_CommunityPrayer_Directions -->"]
w("00-The-Opening.md", op)

# ============================================================ THE RECALL
R = cm.paras("recall.md")
j_rconc = find_head(R, "The Recall: Conclusion")
j_rintro = next(j for j in range(j_rconc + 1, len(R))
                if cm.hd(R[j]) and R[j].lower().replace("*", "").strip() == "## introduction")
rec_epi = body_between(R, j_rconc, j_rintro)               # Mt 18:20 + Swinnock
j_bookov = find_head(R, "Book Overview: Surveying the Landscape")
rec_conc = body_between(R, j_rintro, j_bookov)             # 4 conclusion paragraphs

# rubric from PDF p.408 (index 407)
import fitz
doc = fitz.open(PDF)
tab = doc[407].find_tables().tables[0].extract()
metric = ["Conviction", "Commitment", "Conduct", "Community", "Character"]
def cc(x): return re.sub(r'\s+', ' ', (x or "").replace("\x92", "'").replace("’", "'")).strip()
rubric_rows = []
for mi, row in enumerate(tab[1:]):          # skip header row
    cells = [cc(c) for c in row]
    obj = cells[0]
    rest = " | ".join(cells[1:])
    rubric_rows.append(f"| **{metric[mi]}:** {obj} | {rest} |")

rc = ["# The Recall", "", "## Overview", "", "### Key Elements",
      "- **Key Passage** - Review",
      '- **Scripture Memory** - "Carry one another\'s burdens, and in this way you will fulfill the law of Christ." Galatians 6:2',
      "- **Catechism** - Q: How are Christians to relate to one another? A: Community.",
      "", "## Conclusion"]
for p in rec_epi:
    rc += [""] + quote_lines(p)
for p in rec_conc:
    rc += ["", cm.clean(p)]
rc += ["", "## Book Overview: Surveying the Landscape",
       "", "<!-- @include: Recall_BookOverview_Directions -->",
       "", "### Key Idea", "", "<!-- @include: Recall_BookOverview_KeyIdea -->",
       "", "### Story Retell", "", "<!-- @include: Recall_BookOverview_StoryRetell -->",
       "", "### Narrative Review", "", "<!-- @include: Recall_BookOverview_NarrativeReview -->",
       "", "## Faith Foundation: Exploring the Terrain",
       "", "<!-- @include: Recall_FaithFoundation_Directions -->",
       "", "### Discussion Questions",
       "", "<!-- @include: Recall_FaithFoundation_DiscussionDirections -->",
       "", '<!-- @include: Recall_FaithFoundation_DiscussionQuestions id="TheBondBetweenUsRecall-Discussion" -->',
       "", "### Significant Insights",
       "", "<!-- @include: Recall_FaithFoundation_SignificantInsights -->",
       "", "## Learning Plan: Charting the Course",
       "", "<!-- @include: Recall_LearningPlan_Directions -->",
       "", "### Selected Passages",
       "", "<!-- @include: Recall_LearningPlan_SelectedPassages -->",
       "", "| Session | Topic | Passages |", "| :--- | :--- | :--- |"]
for n in range(1, 13):
    rc.append(f"| Session {n} |  |  |")
rc += ["", "### Recommended Reading",
       "", "<!-- @include: Recall_LearningPlan_RecommendedReading -->",
       "", "| Session | Topic | Recommended Reading |", "| :--- | :--- | :--- |"]
for n in range(1, 13):
    rc.append(f"| Session {n} |  |  |")
rc += ["", "## Core Project: Synthesizing the Faith",
       "", "<!-- @include: Recall_CoreProject_Directions -->",
       "", "### Journal Reflection",
       "", "<!-- @include: Recall_CoreProject_JournalReflection -->",
       "", "## Faith Practice: Following the Way",
       "", "<!-- @include: Recall_FaithPractice_Directions -->",
       "", "### Growth Evaluation",
       "", "<!-- @include: Recall_FaithPractice_GrowthEvaluation -->",
       "", "| Objective | Exemplary | Mature | Developing | Emerging | Unsound |",
       "| :--- | :--- | :--- | :--- | :--- | :--- |"]
rc += rubric_rows
rc += ["", "### Next Steps",
       "", '<!-- @include: Recall_FaithPractice_NextSteps id="TheBondBetweenUsRecall-NextSteps" -->',
       "", "### Community Prayer",
       "", "<!-- @include: Recall_FaithPractice_CommunityPrayer -->"]
w("13-The-Recall.md", rc)

print("\nOpening core-content sessions:")
for s in sess: print("  ", s[0], s[1], "(" + s[2] + ")")
print("rubric rows:", len(rubric_rows))
