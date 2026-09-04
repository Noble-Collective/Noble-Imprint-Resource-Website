# Fill the Recall Learning Plan tables (Selected Passages + Recommended Reading) in
# The Bond Between Us 13-The-Recall.md from the interior PDF (idx 403 & 404).
# Selected-Passages cells are read straight from the PDF table (exact, long refs).
# Recommended-Reading book pairs are taken from the PDF (two books per cell, joined
# with <br> per the §2c convention).
import fitz, re
PDF = r"C:\Users\Steve\Downloads\The Bond Between Us_Interior_v15 (bleed).pdf"
REC = r"C:\Users\Steve\Dev\Noble-Imprint-Resources\series\Narrative Journey Series\Essentials\The Bond Between Us\sessions\13-The-Recall.md"
doc = fitz.open(PDF)
def norm(t):
    for a,b in [('\x92',"'"),('\x93','"'),('\x94','"'),('\x91',"'"),('​',''),(' ',' '),('\xa0',' '),('\x07','')]:
        t=t.replace(a,b)
    return re.sub(r'\s+',' ',t).strip()

# --- Selected Passages from PDF table (idx 403) ---
sp = doc[403].find_tables().tables[0].extract()
topics=[]; passages=[]
for row in sp:
    topics.append(norm(row[1])); passages.append(norm(row[2]).replace("Philppians","Philippians"))
assert len(sp)==12, len(sp)

def ital_title(book):
    "'Author, Title' -> 'Author, _Title_' (author-title comma is the first comma)"
    i=book.find(", ")
    return book if i<0 else book[:i+2] + "_" + book[i+2:].strip() + "_"

# --- Recommended Reading: two books per session (from PDF idx 404) ---
reading = {
 1:["Elisabeth Elliot, The Shaping of a Christian Family","Donald S. Whitney, Family Worship"],
 2:["Andreas J. Köstenberger and David W. Jones, Marriage and the Family","John MacArthur Jr., Divine Design"],
 3:["Voddie Baucham Jr., Family Shepherds","Tedd Tripp, Shepherding a Child's Heart"],
 4:["C. S. Lewis, The Four Loves","Joel R. Beeke and Michael A. G. Haykin, How Should We Develop Biblical Friendship?"],
 5:["James K. A. Smith, How (Not) to Be Secular","David F. Wells, God in the Wasteland"],
 6:["Timothy Keller, Every Good Endeavor","Ben Witherington III, Work: A Kingdom Perspective on Labor"],
 7:["Scot McKnight, A Fellowship of Differents","Joseph H. Hellerman, When the Church Was a Family"],
 8:["Dietrich Bonhoeffer, Life Together","Jim Wilder, The Other Half of Church"],
 9:["Tim Chester, Total Church","Mark Dever, Nine Marks of a Healthy Church"],
 10:["Colin Marshall and Tony Payne, The Trellis and the Vine","George Miley, Loving the Church … Blessing the Nations"],
 11:["Francis A. Schaeffer, The Church Before the Watching World","Russell Moore, Onward: Engaging the Culture without Losing the Gospel"],
 12:["Rosaria Butterfield, The Gospel Comes with a House Key","Christine D. Pohl, Making Room"],
}

def filled(header, col3):
    rows="\n".join(f"| Session {n} | {topics[n-1]} | {col3(n)} |" for n in range(1,13))
    return f"| Session | Topic | {header} |\n| :--- | :--- | :--- |\n{rows}"

def replace_table(src, header, newtable):
    # idempotent: match the existing Learning-Plan table (blank or filled) by its header + 12 rows
    pat=re.compile(r"\| Session \| Topic \| "+re.escape(header)+r" \|\n\| :--- \| :--- \| :--- \|\n(?:\|[^\n]*\|\n?){12}")
    src2, n = pat.subn(lambda m: newtable, src, count=1)
    assert n==1, f"table not found/updated for header {header!r} (n={n})"
    return src2

src=open(REC,encoding="utf-8").read()
src=replace_table(src, "Passages", filled("Passages", lambda n: passages[n-1]))
src=replace_table(src, "Recommended Reading", filled("Recommended Reading", lambda n: "<br>".join(ital_title(b) for b in reading[n])))
open(REC,"w",encoding="utf-8",newline="\n").write(src)
print("filled both tables in 13-The-Recall.md")
for n in range(1,13):
    print(f"  S{n:2d} {topics[n-1]:18s} | {passages[n-1][:45]}… | {reading[n][0][:30]}…")
