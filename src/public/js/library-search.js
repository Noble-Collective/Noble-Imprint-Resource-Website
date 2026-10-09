/* The Home search box (Collective-Shared plans/2026-10-09-library-search-terms.md, P4; mockup
 * plans/assets/2026-10-09-library-search/search-mockups.html). Typing searches titles AND topic words
 * through /api/library/search (the shared matcher, so the site and the app agree) and replaces the
 * series list with "12 books match “catechism”" rows; a topic match carries a "Matches …" chip.
 * Clear / Esc restore the list. The query sits in the URL (?q=) so a link opens with results.
 * The pure helpers at the top are unit-tested in node (tests/unit/library-search-box.test.js). */
(function (root) {
  var PREVIEW_ROWS = 5; // then "Show all N"
  var DEBOUNCE_MS = 150;
  var MIN_LETTERS = 2; // the matcher needs one word of 2+ letters

  // Enough to tell "worth asking the server" from "keep the list": 2+ letters or digits.
  function isSearchable(q) {
    return String(q || '').replace(/[^\p{L}\p{N}]/gu, '').length >= MIN_LETTERS;
  }

  function headText(count, q) {
    var quoted = '“' + q + '”';
    if (!count) return 'No books match ' + quoted;
    return count === 1 ? '1 book matches ' + quoted : count + ' books match ' + quoted;
  }

  // One result → what its row shows. The reason chip only when the title isn't what matched.
  function rowModel(r) {
    var m = r.matched || {};
    return {
      href: r.url,
      title: r.title,
      cover: r.cover || null,
      banner: r.banner === 'Preview' || r.banner === 'Pre-Release' ? r.banner : null,
      path: (r.seriesPath || []).join(' · '),
      chip: m.field && m.field !== 'title' && m.text ? 'Matches ' + m.text : null,
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { isSearchable: isSearchable, headText: headText, rowModel: rowModel, PREVIEW_ROWS: PREVIEW_ROWS };
  }
  if (!root || !root.document) return;

  var doc = root.document;
  var form = doc.querySelector('[data-nc-libsearch]');
  var input = doc.querySelector('[data-nc-libsearch-q]');
  var section = doc.querySelector('[data-nc-libresults]');
  if (!form || !input || !section) return;
  var main = form.closest('.main');
  var clearBtn = form.querySelector('[data-nc-libsearch-clear]');
  var hint = form.querySelector('[data-nc-libsearch-hint]');
  var live = form.querySelector('[data-nc-libsearch-status]');
  var head = section.querySelector('.nc-libresults__head');
  var list = section.querySelector('.nc-libresults__list');
  var more = section.querySelector('.nc-libresults__more');

  var timer = null;
  var seq = 0;
  var controller = null;
  var shown = null; // { q, results, count } on screen

  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function setUrl(q) {
    try {
      var u = new URL(root.location.href);
      if (q) u.searchParams.set('q', q);
      else u.searchParams.delete('q');
      root.history.replaceState(root.history.state, '', u.pathname + u.search + u.hash);
    } catch (e) { /* history blocked: the box still works */ }
  }

  function setSearching(on) {
    main.classList.toggle('is-lib-searching', on);
    section.hidden = !on;
    if (hint) hint.hidden = on;
  }

  function renderRow(r) {
    var m = rowModel(r);
    var li = el('li');
    var a = el('a', 'nc-libresults__row');
    a.href = m.href;
    if (m.cover) {
      var img = el('img', 'nc-libresults__cover');
      img.src = m.cover;
      img.alt = '';
      img.loading = 'lazy';
      a.appendChild(img);
    } else {
      a.appendChild(el('span', 'nc-libresults__cover nc-libresults__cover--none'));
    }
    var body = el('span', 'nc-libresults__body');
    var title = el('span', 'nc-libresults__title', m.title);
    if (m.banner) {
      title.appendChild(doc.createTextNode(' '));
      title.appendChild(el('span', 'badge ' + (m.banner === 'Preview' ? 'badge-preview' : 'badge-prerelease'), m.banner));
    }
    body.appendChild(title);
    if (m.path) body.appendChild(el('span', 'nc-libresults__path', m.path));
    if (m.chip) body.appendChild(el('span', 'nc-libresults__chip', m.chip));
    a.appendChild(body);
    li.appendChild(a);
    return li;
  }

  function render(q, data, all) {
    shown = { q: q, results: data.results || [], count: data.count || 0 };
    var text = headText(shown.count, q);
    head.textContent = text;
    if (live) live.textContent = text;
    list.textContent = '';
    var upTo = all ? shown.results.length : Math.min(PREVIEW_ROWS, shown.results.length);
    for (var i = 0; i < upTo; i++) list.appendChild(renderRow(shown.results[i]));
    var old = section.querySelector('.nc-libresults__empty');
    if (old) old.remove();
    if (!shown.count) {
      list.after(el('p', 'nc-libresults__empty', 'Try a theme, a Bible book, a person or a translation.'));
    }
    more.hidden = upTo >= shown.results.length;
    if (!more.hidden) more.textContent = 'Show all ' + shown.results.length;
  }

  function showError(q) {
    shown = null;
    head.textContent = 'Search isn’t available right now. Please try again.';
    if (live) live.textContent = head.textContent;
    list.textContent = '';
    more.hidden = true;
    setUrl(q);
  }

  function run(raw) {
    clearTimeout(timer);
    timer = null;
    var q = raw.trim();
    clearBtn.hidden = !raw;
    if (!isSearchable(q)) {
      seq++;
      if (controller) controller.abort();
      shown = null;
      if (live) live.textContent = '';
      setSearching(false);
      setUrl('');
      return;
    }
    if (shown && shown.q === q) return;
    var mine = ++seq;
    if (controller) controller.abort();
    controller = typeof AbortController === 'function' ? new AbortController() : null;
    fetch('/api/library/search?limit=100&q=' + encodeURIComponent(q), controller ? { signal: controller.signal } : undefined)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (mine !== seq) return; // a newer query is in flight
        setSearching(true);
        render(q, data, false);
        setUrl(q);
      })
      .catch(function (err) {
        if (mine !== seq || (err && err.name === 'AbortError')) return;
        setSearching(true);
        showError(q);
      });
  }

  function schedule() {
    clearTimeout(timer);
    clearBtn.hidden = !input.value;
    timer = setTimeout(function () { run(input.value); }, DEBOUNCE_MS);
  }

  function clear() {
    input.value = '';
    run('');
    input.focus();
  }

  function rowLinks() {
    return Array.prototype.slice.call(list.querySelectorAll('.nc-libresults__row'));
  }

  input.addEventListener('input', schedule);
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    run(input.value);
  });
  clearBtn.addEventListener('click', clear);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && input.value) {
      e.preventDefault();
      clear();
    } else if (e.key === 'ArrowDown') {
      var links = rowLinks();
      if (links.length) {
        e.preventDefault();
        links[0].focus();
      }
    }
  });
  list.addEventListener('keydown', function (e) {
    var links = rowLinks();
    var i = links.indexOf(doc.activeElement);
    if (i < 0) return;
    if (e.key === 'ArrowDown' && i < links.length - 1) {
      e.preventDefault();
      links[i + 1].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      (i > 0 ? links[i - 1] : input).focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      clear();
    }
  });
  more.addEventListener('click', function () {
    if (!shown) return;
    render(shown.q, { results: shown.results, count: shown.count }, true);
    var next = rowLinks()[PREVIEW_ROWS];
    if (next) next.focus();
  });
  if (hint) {
    hint.addEventListener('click', function (e) {
      var b = e.target.closest('[data-q]');
      if (!b) return;
      input.value = b.getAttribute('data-q');
      run(input.value); // no focus: on a phone that would raise the keyboard over the results
    });
  }

  // A ?q= link (or the no-JS form) opened the page: search at once.
  if (input.value) run(input.value);
})(typeof window !== 'undefined' ? window : null);
