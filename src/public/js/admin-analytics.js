// Admin analytics dashboard renderer (P3). Lazy: only queries BigQuery when the
// Analytics tab is first opened, then on range / bot-toggle changes. Charts via
// Chart.js (vendored). Palette is the Okabe-Ito CVD-safe categorical set,
// validated for the light surface (the admin console is light-only).
(function () {
  'use strict';

  var PAL = ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#56B4E9', '#D55E00'];
  var BAR = '#0072B2';        // single-series bars (title names the series)
  var INK = '#3a3a38';        // text token — labels/values never wear series color
  var MUTED = '#8a8a86';
  var GRID = 'rgba(0,0,0,0.06)';

  var charts = {};
  var loaded = false;
  var range = '30d';
  var includeBots = false;
  var book = ''; // '' = all content; otherwise a single book's title
  var subTab = 'resource';
  var compareData = null;
  var lbSort = { key: 'pageviews', dir: -1 };
  var reqSeq = 0; // guards against out-of-order responses clobbering fresh data
  var funnelSeq = 0;

  function el(id) { return document.getElementById(id); }
  function num(n) { return (n == null) ? '—' : Number(n).toLocaleString(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pct(x) { return x == null ? '—' : Math.round(x * 100) + '%'; }
  function mins(sec) { if (sec == null) return '—'; sec = Math.round(sec); return sec < 60 ? sec + 's' : Math.floor(sec / 60) + 'm ' + (sec % 60) + 's'; }

  function destroy() { Object.keys(charts).forEach(function (k) { if (charts[k]) charts[k].destroy(); }); charts = {}; }

  var COMMON = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: INK, font: { family: 'inherit' }, boxWidth: 12, boxHeight: 12 } } },
  };

  // Resource Analytics tab: content-focused views + the book-comparison views.
  // Needs both the dashboard aggregates and the book-comparison payload.
  function loadResource() {
    var status = el('an-status'); if (status) status.textContent = 'Loading…';
    var mySeq = ++reqSeq;
    Promise.all([
      fetch('/api/admin/analytics?range=' + range + '&includeBots=' + (includeBots ? '1' : '0') + (book ? '&book=' + encodeURIComponent(book) : ''), { credentials: 'same-origin' }).then(function (r) { return r.json(); }),
      fetch('/api/admin/analytics/books?range=' + range + '&includeBots=' + (includeBots ? '1' : '0'), { credentials: 'same-origin' }).then(function (r) { return r.json(); }),
    ]).then(function (res) {
      if (mySeq !== reqSeq) return;
      var d = res[0], cmp = res[1] || {};
      if (d.error) throw new Error(d.error);
      renderResource(d, cmp); if (status) status.textContent = '';
    }).catch(function (e) { if (mySeq === reqSeq && status) status.textContent = 'Error: ' + e.message; });
  }

  // Basic Analytics tab: generic web-analytics views (site-wide, no book scope).
  function loadBasic() {
    var status = el('an-status'); if (status) status.textContent = 'Loading…';
    var mySeq = ++reqSeq;
    fetch('/api/admin/analytics?range=' + range + '&includeBots=' + (includeBots ? '1' : '0'), { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (mySeq !== reqSeq) return; if (d.error) throw new Error(d.error); renderBasic(d); if (status) status.textContent = ''; })
      .catch(function (e) { if (mySeq === reqSeq && status) status.textContent = 'Error: ' + e.message; });
  }

  function renderResource(d, cmp) {
    compareData = cmp || {};
    applyScopeResource(d.book);
    destroy();
    renderTiles(d);
    renderLeaderboard((cmp && cmp.leaderboard) || []);
    scatter((cmp && cmp.leaderboard) || []);
    multitrend((cmp && cmp.trend) || [], (cmp && cmp.topBooks) || []);
    hbar('an-books', pluck(d.topBooks, 'label'), pluck(d.topBooks, 'pageviews'));
    hbar('an-bible', pluck(d.topBible, 'label'), pluck(d.topBible, 'pageviews'));
    sessionsTable(d.topSessions || []);
    audioTiles(d.audio || {});
    dwellTable(d.dwellTop || []);
    doughnut('an-split', pluck(d.contentSplit, 'category'), pluck(d.contentSplit, 'pageviews'));
    if (d.book) loadFunnel(d.book); else hideFunnel();
  }

  function renderBasic(d) {
    destroy();
    trend(d.trend || []);
    doughnut('an-devices', pluck(d.devices, 'label'), pluck(d.devices, 'pageviews'));
    hbar('an-browsers', pluck(d.browsers, 'label'), pluck(d.browsers, 'pageviews'));
    hbar('an-os', pluck(d.os, 'label'), pluck(d.os, 'pageviews'));
    kvTable('an-countries', d.countries || [], 'label', 'visitors', 'Country', 'Visitors');
    kvTable('an-referrers', d.referrers || [], 'label', 'pageviews', 'Source', 'Views');
  }

  // When one book is selected, the cross-book comparison + cross-content panels
  // aren't meaningful — hide them, show the drop-off funnel, label the scope.
  function applyScopeResource(bookName) {
    var scoped = !!bookName;
    ['an-card-leaderboard', 'an-card-scatter', 'an-card-momentum', 'an-card-books', 'an-card-bible', 'an-card-split'].forEach(function (id) {
      var c = el(id); if (c) c.style.display = scoped ? 'none' : '';
    });
    var title = el('an-scope-title');
    if (title) { title.textContent = scoped ? '📖 ' + bookName : ''; title.style.display = scoped ? '' : 'none'; }
    var st = el('an-sessions-title');
    if (st) st.textContent = scoped ? 'Sessions in this book' : 'Top sessions';
  }

  function pluck(arr, key) { return (arr || []).map(function (r) { return r[key]; }); }

  function tile(label, value, sub) {
    return '<div class="an-tile"><div class="an-tile-val">' + value + '</div><div class="an-tile-label">' + esc(label) +
      (sub ? '<span class="an-tile-sub">' + esc(sub) + '</span>' : '') + '</div></div>';
  }

  function renderTiles(d) {
    var t = d.totals || {};
    el('an-tiles').innerHTML =
      tile('Pageviews', num(t.pageviews)) +
      tile('Unique visitors', num(t.visitors)) +
      tile('Sessions', num(t.sessions)) +
      tile('Engaged time', (t.engaged_minutes == null ? '—' : num(t.engaged_minutes) + 'm'));
  }

  function audioTiles(a) {
    var completion = (a.plays > 0) ? Math.round((a.completions / a.plays) * 100) + '%' : '—';
    el('an-audio-tiles').innerHTML =
      tile('Plays', num(a.plays)) +
      tile('Listeners', num(a.listeners)) +
      tile('Completion rate', completion, 'ended ÷ played') +
      tile('Avg % heard', pct(a.avg_pct_on_end), 'at end');
  }

  function trend(rows) {
    var c = el('an-trend'); if (!c) return;
    charts.trend = new Chart(c, {
      type: 'line',
      data: {
        labels: rows.map(function (r) { return r.day; }),
        datasets: [
          { label: 'Pageviews', data: rows.map(function (r) { return r.pageviews; }), borderColor: PAL[0], backgroundColor: PAL[0], borderWidth: 2, tension: 0.25, pointRadius: rows.length > 40 ? 0 : 3, fill: false },
          { label: 'Visitors', data: rows.map(function (r) { return r.visitors; }), borderColor: PAL[1], backgroundColor: PAL[1], borderWidth: 2, tension: 0.25, pointRadius: rows.length > 40 ? 0 : 3, fill: false },
        ],
      },
      options: Object.assign({}, COMMON, {
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { grid: { color: GRID }, ticks: { color: MUTED, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
          y: { beginAtZero: true, grid: { color: GRID }, ticks: { color: MUTED, precision: 0 } },
        },
      }),
    });
  }

  function doughnut(id, labels, values) {
    var c = el(id); if (!c) return;
    charts[id] = new Chart(c, {
      type: 'doughnut',
      data: { labels: labels, datasets: [{ data: values, backgroundColor: PAL, borderColor: '#fff', borderWidth: 2 }] },
      options: Object.assign({}, COMMON, { cutout: '58%', plugins: { legend: { position: 'right', labels: COMMON.plugins.legend.labels } } }),
    });
  }

  function hbar(id, labels, values) {
    var c = el(id); if (!c) return;
    charts[id] = new Chart(c, {
      type: 'bar',
      data: { labels: labels, datasets: [{ data: values, backgroundColor: BAR, borderRadius: 4, maxBarThickness: 22 }] },
      options: Object.assign({}, COMMON, {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, grid: { color: GRID }, ticks: { color: MUTED, precision: 0 } },
          y: { grid: { display: false }, ticks: { color: INK, autoSkip: false } },
        },
      }),
    });
  }

  function tableHTML(head, rows) {
    if (!rows.length) return '<p class="an-empty">No data in this range.</p>';
    return '<table class="an-table"><thead><tr>' + head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows.join('') + '</tbody></table>';
  }

  function sessionsTable(rows) {
    el('an-sessions').innerHTML = tableHTML(['Book', 'Session', 'Views', 'Visitors'], rows.map(function (r) {
      return '<tr><td>' + esc(r.book) + '</td><td>' + esc(r.session) + '</td><td class="an-num">' + num(r.pageviews) + '</td><td class="an-num">' + num(r.visitors) + '</td></tr>';
    }));
  }

  function kvTable(id, rows, k, v, kh, vh) {
    el(id).innerHTML = tableHTML([kh, vh], rows.map(function (r) {
      return '<tr><td>' + esc(r[k]) + '</td><td class="an-num">' + num(r[v]) + '</td></tr>';
    }));
  }

  function dwellTable(rows) {
    el('an-dwell').innerHTML = tableHTML(['Book', 'Session', 'Avg time', 'Views'], rows.map(function (r) {
      return '<tr><td>' + esc(r.book) + '</td><td>' + esc(r.session) + '</td><td class="an-num">' + mins(r.avg_dwell_sec) + '</td><td class="an-num">' + num(r.pageviews) + '</td></tr>';
    }));
  }

  // --- within-book drop-off funnel (Dashboard tab, when a book is selected) ---
  function hideFunnel() { var c = el('an-card-funnel'); if (c) c.style.display = 'none'; }
  function loadFunnel(bookName) {
    var c = el('an-card-funnel'); if (c) c.style.display = '';
    var mySeq = ++funnelSeq;
    fetch('/api/admin/analytics/funnel?range=' + range + '&includeBots=' + (includeBots ? '1' : '0') + '&book=' + encodeURIComponent(bookName), { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (mySeq === funnelSeq && !d.error) renderFunnel(d); })
      .catch(function () {});
  }
  function renderFunnel(d) {
    var steps = d.steps || [];
    if (!steps.length) { el('an-funnel').innerHTML = '<p class="an-empty">No session data for this book.</p>'; return; }
    var max = Math.max.apply(null, steps.map(function (s) { return s.readers; }).concat([1]));
    var first = steps[0].readers || 0;
    el('an-funnel').innerHTML = steps.map(function (s) {
      var w = Math.round((s.readers / max) * 100);
      var ret = first ? Math.round((s.readers / first) * 100) : 0;
      return '<div class="an-funnel-row"><div class="an-funnel-label">' + (s.n ? 'S' + esc(s.n) + ' · ' : '') + esc(s.title) + '</div>' +
        '<div class="an-funnel-bar-wrap"><div class="an-funnel-bar" style="width:' + w + '%"></div></div>' +
        '<div class="an-funnel-val">' + num(s.readers) + '<span class="an-funnel-ret">' + ret + '%</span></div></div>';
    }).join('');
  }

  // --- book-comparison views (rendered on the Resource tab) ---
  function renderLeaderboard(rows) {
    var cols = [['book', 'Book'], ['readers', 'Readers'], ['pageviews', 'Views'], ['sessions_viewed', 'Sessions'], ['avg_dwell_sec', 'Avg time'], ['audio_plays', 'Audio'], ['avg_pct_heard', '% heard']];
    var sorted = rows.slice().sort(function (a, b) {
      var k = lbSort.key, av = a[k], bv = b[k];
      if (k === 'book') return lbSort.dir * String(av || '').localeCompare(String(bv || ''));
      return lbSort.dir * ((av == null ? -1 : av) - (bv == null ? -1 : bv));
    });
    var head = '<tr>' + cols.map(function (c) {
      var arrow = lbSort.key === c[0] ? (lbSort.dir < 0 ? ' ▾' : ' ▴') : '';
      return '<th class="an-sortable' + (c[0] === 'book' ? ' an-th-left' : '') + '" data-sort="' + c[0] + '">' + esc(c[1]) + arrow + '</th>';
    }).join('') + '</tr>';
    var body = sorted.map(function (r) {
      return '<tr class="an-lb-row" data-book="' + esc(r.book) + '"><td>' + esc(r.book) + '</td><td class="an-num">' + num(r.readers) +
        '</td><td class="an-num">' + num(r.pageviews) + '</td><td class="an-num">' + num(r.sessions_viewed) +
        '</td><td class="an-num">' + mins(r.avg_dwell_sec) + '</td><td class="an-num">' + num(r.audio_plays) +
        '</td><td class="an-num">' + pct(r.avg_pct_heard) + '</td></tr>';
    }).join('');
    var host = el('an-leaderboard');
    host.innerHTML = '<table class="an-table an-lb"><thead>' + head + '</thead><tbody>' + (body || '<tr><td>No data</td></tr>') + '</tbody></table>';
    host.querySelectorAll('.an-sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-sort');
        if (lbSort.key === k) lbSort.dir *= -1; else { lbSort.key = k; lbSort.dir = (k === 'book') ? 1 : -1; }
        renderLeaderboard(compareData.leaderboard || []);
      });
    });
    host.querySelectorAll('.an-lb-row').forEach(function (tr) {
      tr.addEventListener('click', function () { drillIntoBook(tr.getAttribute('data-book')); });
    });
  }
  function scatter(rows) {
    var c = el('an-scatter'); if (!c) return;
    var pts = rows.filter(function (r) { return r.readers > 0; }).map(function (r) {
      return { x: r.readers, y: r.avg_dwell_sec || 0, r: Math.max(6, Math.min(30, Math.sqrt(r.pageviews || 1) * 3)), book: r.book };
    });
    charts['an-scatter'] = new Chart(c, {
      type: 'bubble',
      data: { datasets: [{ data: pts, backgroundColor: PAL[0] + '99', borderColor: PAL[0] }] },
      options: Object.assign({}, COMMON, {
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (ctx) { var p = ctx.raw; return p.book + ' — ' + p.x + ' readers, ' + mins(p.y); } } } },
        scales: {
          x: { title: { display: true, text: 'Readers', color: MUTED }, beginAtZero: true, grid: { color: GRID }, ticks: { color: MUTED, precision: 0 } },
          y: { title: { display: true, text: 'Avg time on page', color: MUTED }, beginAtZero: true, grid: { color: GRID }, ticks: { color: MUTED, callback: function (v) { return mins(v); } } },
        },
      }),
    });
  }
  function multitrend(rows, books) {
    var c = el('an-multitrend'); if (!c) return;
    var days = []; var seen = {};
    rows.forEach(function (r) { if (!seen[r.day]) { seen[r.day] = 1; days.push(r.day); } });
    days.sort();
    var byBook = {};
    rows.forEach(function (r) { (byBook[r.book] = byBook[r.book] || {})[r.day] = r.pageviews; });
    var datasets = (books || []).slice(0, 6).map(function (b, i) {
      return { label: b, data: days.map(function (d) { return (byBook[b] && byBook[b][d]) || 0; }), borderColor: PAL[i % PAL.length], backgroundColor: PAL[i % PAL.length], borderWidth: 2, tension: 0.25, pointRadius: days.length > 40 ? 0 : 2, fill: false };
    });
    charts['an-multitrend'] = new Chart(c, {
      type: 'line', data: { labels: days, datasets: datasets },
      options: Object.assign({}, COMMON, {
        interaction: { mode: 'index', intersect: false },
        scales: { x: { grid: { color: GRID }, ticks: { color: MUTED, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } }, y: { beginAtZero: true, grid: { color: GRID }, ticks: { color: MUTED, precision: 0 } } },
      }),
    });
  }
  function drillIntoBook(bookName) {
    book = bookName;
    var sel = el('an-book'); if (sel) sel.value = bookName;
    loadResource(); // already on the Resource tab (leaderboard lives there)
  }

  // Reader Activity: privacy-safe engagement aggregates (Firestore, not BigQuery).
  function renderReader(d) {
    var t = d.totals || {};
    el('ra-tiles').innerHTML =
      tile('Highlights', num(t.highlights)) +
      tile('Notes', num(t.notes)) +
      tile('Bookmarks', num(t.bookmarks)) +
      tile('Answers', num(t.answers)) +
      tile('Readers', num(t.readers), 'saved something');
    var books = d.byBook || [];
    el('ra-books').innerHTML = !books.length ? '<p class="text-muted">No reader activity yet.</p>' :
      '<table class="admin-table"><thead><tr><th>Book</th><th>Highlights</th><th>Notes</th><th>Bookmarks</th><th>Answers</th><th>Readers</th></tr></thead><tbody>' +
      books.map(function (b) {
        return '<tr><td>' + esc(b.title) + '</td><td>' + num(b.highlights) + '</td><td>' + num(b.notes) + '</td><td>' + num(b.bookmarks) + '</td><td>' + num(b.answers) + '</td><td>' + num(b.readers) + '</td></tr>';
      }).join('') + '</tbody></table>';
    var ps = d.topPassages || [];
    el('ra-passages').innerHTML = !ps.length ? '<p class="text-muted">No highlights yet.</p>' :
      ps.map(function (p) {
        return '<div class="ra-passage"><span class="ra-passage-count">' + num(p.count) + '×</span><span class="ra-passage-ref">“' + esc(p.ref) + '”</span><span class="ra-passage-book">' + esc(p.book) + '</span></div>';
      }).join('');
  }
  function loadReader() {
    var mySeq = ++reqSeq;
    el('ra-books').innerHTML = '<p class="text-muted">Loading…</p>';
    fetch('/api/admin/reader-activity', { credentials: 'same-origin' }).then(function (r) { return r.json(); })
      .then(function (d) { if (mySeq !== reqSeq) return; if (d.error) throw new Error(d.error); renderReader(d); })
      .catch(function (e) { el('ra-books').innerHTML = '<p class="text-muted">Error: ' + esc(e.message) + '</p>'; });
  }

  // --- wiring ---
  function reloadActive() { if (subTab === 'reader') loadReader(); else if (subTab === 'basic') loadBasic(); else loadResource(); }

  document.addEventListener('DOMContentLoaded', function () {
    var tabBtn = document.querySelector('[data-admin-tab="analytics"]');
    if (tabBtn) tabBtn.addEventListener('click', function () { if (!loaded) { loaded = true; reloadActive(); } });

    document.querySelectorAll('.an-subtab').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.an-subtab').forEach(function (x) { x.classList.remove('an-subtab--active'); });
        b.classList.add('an-subtab--active');
        subTab = b.getAttribute('data-an-sub');
        var res = el('an-sub-resource'), basic = el('an-sub-basic'), reader = el('an-sub-reader');
        if (res) res.classList.toggle('an-sub--hidden', subTab !== 'resource');
        if (basic) basic.classList.toggle('an-sub--hidden', subTab !== 'basic');
        if (reader) reader.classList.toggle('an-sub--hidden', subTab !== 'reader');
        var bookSel = el('an-book'); if (bookSel) bookSel.style.display = (subTab === 'resource') ? '' : 'none';
        loaded = true;
        reloadActive();
      });
    });

    document.querySelectorAll('.an-range-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.an-range-btn').forEach(function (x) { x.classList.remove('an-range-btn--active'); });
        b.classList.add('an-range-btn--active');
        range = b.getAttribute('data-range');
        loaded = true; reloadActive();
      });
    });
    var bots = el('an-include-bots');
    if (bots) bots.addEventListener('change', function () { includeBots = bots.checked; loaded = true; reloadActive(); });
    var bookSel = el('an-book');
    if (bookSel) bookSel.addEventListener('change', function () { book = bookSel.value; loaded = true; loadResource(); });
  });
})();
