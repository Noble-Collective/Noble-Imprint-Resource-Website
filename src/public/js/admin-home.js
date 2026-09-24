// Admin console — Home tab: edit the shared Home content (Resource of the day book list + per-session
// exclusions, Partner with us copy/link) served by GET /api/home. See src/server/home.js.
(function () {
  'use strict';

  var tabBtn = document.querySelector('[data-admin-tab="home"]');
  if (!tabBtn) return;

  var $ = function (id) { return document.getElementById(id); };
  var state = { config: null, books: [], loaded: false };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function bookInfo(bookPath) {
    return state.books.find(function (b) { return b.bookPath === bookPath; }) || null;
  }
  function status(msg, isError) {
    var el = $('hm-status');
    el.textContent = msg || '';
    el.hidden = !msg;
    el.classList.toggle('hm-status--error', !!isError);
  }

  function renderBooks() {
    var cfg = state.config.resourceOfTheDay;
    var list = $('hm-books');
    list.innerHTML = cfg.books.map(function (bp, i) {
      var b = bookInfo(bp);
      if (!b) {
        return '<li class="hm-book hm-book--missing"><div class="hm-book-head"><span class="hm-book-title">' + esc(bp) +
          '</span><span class="hm-tag hm-tag--warn">Not found or not public</span>' +
          '<button type="button" class="admin-btn admin-btn--sm admin-btn--danger" data-remove="' + i + '">Remove</button></div></li>';
      }
      var excl = cfg.excludeSessions[bp] || [];
      var sessions = b.sessions.filter(function (s) { return s.numbered; }).map(function (s) {
        var on = excl.indexOf(s.filename) === -1;
        return '<label class="hm-session"><input type="checkbox" data-book="' + i + '" data-file="' + esc(s.filename) + '"' + (on ? ' checked' : '') + '> ' + esc(s.title) + '</label>';
      }).join('');
      return '<li class="hm-book">' +
        '<div class="hm-book-head"><span class="hm-book-title">' + esc(b.title) + '</span>' +
        (b.hasAudio ? '<span class="hm-tag">Audio</span>' : '<span class="hm-tag hm-tag--muted">No audio</span>') +
        '<span class="hm-book-series">' + esc(b.series) + '</span>' +
        '<span class="hm-book-btns">' +
        '<button type="button" class="admin-btn admin-btn--sm" data-up="' + i + '" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button type="button" class="admin-btn admin-btn--sm" data-down="' + i + '" aria-label="Move down"' + (i === cfg.books.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button type="button" class="admin-btn admin-btn--sm admin-btn--danger" data-remove="' + i + '">Remove</button></span></div>' +
        '<div class="hm-book-sub">' + esc(b.subtitle) + '</div>' +
        '<details class="hm-sessions"><summary>' + (b.sessions.filter(function (s) { return s.numbered; }).length - excl.length) + ' sessions in rotation</summary>' + sessions + '</details>' +
        '</li>';
    }).join('');

    var add = $('hm-add-book');
    var inList = {};
    cfg.books.forEach(function (bp) { inList[bp] = true; });
    add.innerHTML = '<option value="">Add a book…</option>' + state.books.filter(function (b) { return !inList[b.bookPath]; })
      .map(function (b) { return '<option value="' + esc(b.bookPath) + '">' + esc(b.title) + (b.hasAudio ? ' (audio)' : '') + '</option>'; }).join('');
  }

  function renderPreview(preview) {
    var rows = (preview && preview.picks) || [];
    $('hm-preview').innerHTML = rows.length
      ? rows.map(function (p) { return '<tr><td>' + esc(p.date) + '</td><td>' + esc(p.bookTitle || '—') + '</td><td>' + esc(p.sessionTitle || '—') + '</td></tr>'; }).join('')
      : '<tr><td colspan="3">No sessions in rotation.</td></tr>';
  }

  function renderPartner() {
    var p = state.config.partner;
    $('hm-p-title').value = p.title;
    $('hm-p-body').value = p.body;
    $('hm-p-button').value = p.buttonLabel;
    $('hm-p-url').value = p.url;
  }

  function collect() {
    var cfg = state.config;
    cfg.partner = {
      title: $('hm-p-title').value,
      body: $('hm-p-body').value,
      buttonLabel: $('hm-p-button').value,
      url: $('hm-p-url').value,
    };
    return cfg;
  }

  var previewTimer = null;
  function refreshPreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(function () {
      fetch('/api/admin/home-config/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(collect()) })
        .then(function (r) { return r.json(); }).then(renderPreview).catch(function () {});
    }, 250);
  }

  function load() {
    status('Loading…');
    fetch('/api/admin/home-config').then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      state.config = d.config;
      state.books = d.books || [];
      state.loaded = true;
      renderBooks();
      renderPartner();
      renderPreview(d.preview);
      status('');
      $('hm-body').hidden = false;
    }).catch(function (e) { status('Could not load the Home settings (' + e.message + '). Reload to try again.', true); });
  }

  $('hm-books').addEventListener('click', function (e) {
    var t = e.target.closest('button');
    if (!t) return;
    var books = state.config.resourceOfTheDay.books;
    if (t.dataset.remove != null) books.splice(+t.dataset.remove, 1);
    else if (t.dataset.up != null) { var i = +t.dataset.up; books.splice(i - 1, 0, books.splice(i, 1)[0]); }
    else if (t.dataset.down != null) { var j = +t.dataset.down; books.splice(j + 1, 0, books.splice(j, 1)[0]); }
    else return;
    renderBooks();
    refreshPreview();
  });

  $('hm-books').addEventListener('change', function (e) {
    var cb = e.target;
    if (!cb.matches('input[type=checkbox][data-file]')) return;
    var cfg = state.config.resourceOfTheDay;
    var bp = cfg.books[+cb.dataset.book];
    var excl = (cfg.excludeSessions[bp] = cfg.excludeSessions[bp] || []);
    var idx = excl.indexOf(cb.dataset.file);
    if (cb.checked && idx !== -1) excl.splice(idx, 1);
    if (!cb.checked && idx === -1) excl.push(cb.dataset.file);
    var summary = cb.closest('details').querySelector('summary');
    var total = cb.closest('details').querySelectorAll('input[type=checkbox]').length;
    summary.textContent = (total - excl.length) + ' sessions in rotation';
    refreshPreview();
  });

  $('hm-add-btn').addEventListener('click', function () {
    var v = $('hm-add-book').value;
    if (!v) return;
    state.config.resourceOfTheDay.books.push(v);
    renderBooks();
    refreshPreview();
  });

  $('hm-save').addEventListener('click', function () {
    var btn = $('hm-save');
    btn.disabled = true;
    $('hm-saved').textContent = 'Saving…';
    fetch('/api/admin/home-config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(collect()) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        state.config = d.config;
        renderBooks();
        renderPartner();
        renderPreview(d.preview);
        $('hm-saved').textContent = 'Saved';
        setTimeout(function () { $('hm-saved').textContent = ''; }, 2500);
      })
      .catch(function (e) { $('hm-saved').textContent = 'Could not save (' + e.message + ')'; })
      .finally(function () { btn.disabled = false; });
  });

  tabBtn.addEventListener('click', function () { if (!state.loaded) load(); });
})();
