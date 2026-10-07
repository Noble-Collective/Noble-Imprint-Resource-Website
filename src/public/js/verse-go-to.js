/* The verse pop-up's one footer link (Noble-Imprint-App plans/2026-10-07-settings-redesign-and-multi-tab.md,
 * P5c, Q8/Q9): always "Go to <Book> <chapter> ›", the same words as the app and the Institute. A whole
 * passage opens its first chapter AT the first verse quoted ("Hebrews 11:4" → Hebrews 11, #v4); a passage
 * cut short opens the first chapter not shown (/api/verses `continuesAt`: "Genesis 1–50" → Genesis 4).
 * One psalm is "Psalm 23". Pure; loaded by footer.ejs before main.js, unit-tested in node. */
(function (root) {
  function verseGoTo(data, translation) {
    if (!data || !data.verses) return null;
    var at = data.continuesAt;
    var target = at ? at.ref : null;
    if (!target) {
      for (var i = 0; i < data.verses.length; i++) {
        if (!data.verses[i].gap && data.verses[i].ref) { target = data.verses[i].ref; break; }
      }
    }
    var m = target && target.match(/^(.+?)\s+(\d+):(\d+)$/);
    if (!m) return null;
    var book = m[1] === 'Psalms' ? 'Psalm' : m[1];
    return {
      label: 'Go to ' + book + ' ' + m[2] + ' ›',
      href: '/bible/' + translation + '/' + encodeURIComponent(m[1]) + '?chapter=' + m[2] + '#v' + m[3],
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { verseGoTo: verseGoTo };
  else root.ncVerseGoTo = verseGoTo;
})(this);
