# Build The Bond Between Us commonBook.md <CommunityCovenant> block straight from
# the interior PDF (page index 19 = printed p.20), so the covenant text is never
# round-tripped through model output (the book-2 content-filter lesson).
# Mirrors the <LordsPrayer>/<TenCommandments> block style: blockquote lines with
# markdown hard breaks (two trailing spaces), straight quotes, two stanzas separated
# by a blank blockquote line, attribution on its own line.
import fitz, re, os

PDF = r"C:\Users\Steve\Downloads\The Bond Between Us_Interior_v15 (bleed).pdf"
OUT = r"C:\Users\Steve\Dev\Noble-Imprint-Resources\series\Narrative Journey Series\Essentials\The Bond Between Us\commonBook.md"
PAGE = 19            # printed p.20 — the Opening covenant page
ATTR = "A Christian Community Covenant"

doc = fitz.open(PDF)
raw = doc[PAGE].get_text()

# normalize Windows-1252 curly quotes/apostrophes to straight
raw = raw.replace("’", "'").replace("‘", "'")
raw = raw.replace("“", '"').replace("”", '"')
raw = raw.replace("\x92", "'").replace("\x91", "'")
raw = raw.replace("\x93", '"').replace("\x94", '"')

lines = [ln.strip() for ln in raw.split("\n")]

# keep only the covenant body: drop page number, the "Introduction" running header,
# and the trailing attribution/title line.
body = []
for ln in lines:
    if not ln:
        continue
    if re.fullmatch(r"\d+", ln):          # page number
        continue
    if ln.lower() == "introduction":       # running header
        continue
    if ln == ATTR:                          # title/attribution line
        continue
    body.append(ln)

# split into two stanzas at the "We confess the church" lead-in
split_i = next(i for i, ln in enumerate(body) if ln.startswith("We confess the church"))
stanza1 = body[:split_i]
stanza2 = body[split_i:]

assert len(stanza1) == 6, f"stanza1 expected 6 lines, got {len(stanza1)}: {stanza1}"
assert len(stanza2) == 6, f"stanza2 expected 6 lines (lead-in + 5), got {len(stanza2)}: {stanza2}"

def quote_block(stz):
    # each line becomes a blockquote line with a markdown hard break (two spaces)
    return "\n".join(f"> {ln}  " for ln in stz)

out = (
    "<CommunityCovenant>\n"
    + quote_block(stanza1) + "\n"
    + ">\n"                                 # blank blockquote line = stanza break
    + quote_block(stanza2) + "\n"
    + "\n"
    + f"<< {ATTR}\n"
    + "</CommunityCovenant>\n"
)

with open(OUT, "w", encoding="utf-8", newline="\n") as f:
    f.write(out)

print("wrote", OUT)
print("stanza1 lines:", len(stanza1), "| stanza2 lines:", len(stanza2))
print("--- file ---")
print(out)
