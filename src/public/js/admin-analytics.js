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
  var reqSeq = 0; // guards against out-of-order responses clobbering fresh data

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

  function load() {
    var mySeq = ++reqSeq;
    var status = el('an-status');
    if (status) status.textContent = 'Loading…';
    fetch('/api/admin/analytics?range=' + range + '&includeBots=' + (includeBots ? '1' : '0'), { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (mySeq !== reqSeq) return; // a newer request superseded this one
        if (d.error) throw new Error(d.error);
        render(d); if (status) status.textContent = '';
      })
      .catch(function (e) { if (mySeq === reqSeq && status) status.textContent = 'Error: ' + e.message; });
  }

  function render(d) {
    renderTiles(d);
    destroy();
    trend(d.trend || []);
    doughnut('an-split', pluck(d.contentSplit, 'category'), pluck(d.contentSplit, 'pageviews'));
    doughnut('an-devices', pluck(d.devices, 'label'), pluck(d.devices, 'pageviews'));
    hbar('an-bible', pluck(d.topBible, 'label'), pluck(d.topBible, 'pageviews'));
    hbar('an-browsers', pluck(d.browsers, 'label'), pluck(d.browsers, 'pageviews'));
    hbar('an-os', pluck(d.os, 'label'), pluck(d.os, 'pageviews'));
    sessionsTable(d.topSessions || []);
    kvTable('an-countries', d.countries || [], 'label', 'visitors', 'Country', 'Visitors');
    kvTable('an-referrers', d.referrers || [], 'label', 'pageviews', 'Source', 'Views');
    audioTiles(d.audio || {});
    dwellTable(d.dwellTop || []);
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

  // --- wiring ---
  function ensureLoaded() { if (!loaded) { loaded = true; } load(); }

  document.addEventListener('DOMContentLoaded', function () {
    var tabBtn = document.querySelector('[data-admin-tab="analytics"]');
    if (tabBtn) tabBtn.addEventListener('click', function () { if (!loaded) ensureLoaded(); });

    document.querySelectorAll('.an-range-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.an-range-btn').forEach(function (x) { x.classList.remove('an-range-btn--active'); });
        b.classList.add('an-range-btn--active');
        range = b.getAttribute('data-range');
        ensureLoaded();
      });
    });
    var bots = el('an-include-bots');
    if (bots) bots.addEventListener('change', function () { includeBots = bots.checked; ensureLoaded(); });
  });
})();
