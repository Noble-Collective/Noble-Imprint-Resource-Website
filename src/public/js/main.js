/* ============================================================
   Noble Imprint Resource Website - Client-side JS
   ============================================================ */

(function () {
  'use strict';

  /* ----- View Mode Toggle (Visual / List) ----- */

  /**
   * Switch between visual (grid) and list mode on the homepage.
   * @param {'visual'|'text'} mode
   */
  function setMode(mode) {
    var body = document.body;
    var buttons = document.querySelectorAll('.view-toggle button');

    if (mode === 'text') {
      body.classList.add('text-mode');
    } else {
      body.classList.remove('text-mode');
    }

    buttons.forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
    });
  }

  // Expose globally so inline onclick or templates can call it
  window.setMode = setMode;

  /* ----- Sidebar Series Expand / Collapse ----- */

  function initSidebarToggle() {
    var toggles = document.querySelectorAll('[data-toggle-series]');

    toggles.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var expanded = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        var list = btn.nextElementSibling;
        if (list && list.classList.contains('nav-subseries')) {
          list.classList.toggle('is-expanded');
        }
      });
    });

    var subToggles = document.querySelectorAll('[data-toggle-subseries]');
    subToggles.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var expanded = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        var books = btn.closest('.nav-subseries-group').querySelector('.nav-sub-books');
        if (books) {
          books.classList.toggle('is-expanded');
        }
      });
    });
  }

  /* ----- Toggle Button Listeners ----- */

  function initViewToggle() {
    var buttons = document.querySelectorAll('.view-toggle button');

    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var mode = btn.getAttribute('data-mode');
        if (mode) {
          setMode(mode);
        }
      });
    });
  }

  /* ----- Mobile Menu Drawer ----- */

  function initMenuDrawer() {
    var toggle = document.querySelector('[data-drawer-toggle]');
    var drawer = document.querySelector('[data-drawer]');
    var overlay = document.querySelector('[data-drawer-overlay]');

    if (!toggle || !drawer || !overlay) return;

    var submenuToggles = drawer.querySelectorAll('[data-submenu]');
    var backButtons = drawer.querySelectorAll('[data-submenu-back]');

    function openDrawer() {
      toggle.classList.add('is-open');
      toggle.setAttribute('aria-expanded', 'true');
      drawer.classList.add('is-open');
      overlay.classList.add('is-open');
      document.body.classList.add('drawer-open');
    }

    function closeDrawer() {
      toggle.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      drawer.classList.remove('is-open');
      overlay.classList.remove('is-open');
      document.body.classList.remove('drawer-open');
      // Close any open submenus
      var openSubs = drawer.querySelectorAll('.menu-drawer__submenu.is-open');
      openSubs.forEach(function (sub) { sub.classList.remove('is-open'); });
    }

    toggle.addEventListener('click', function () {
      if (drawer.classList.contains('is-open')) {
        closeDrawer();
      } else {
        openDrawer();
      }
    });

    overlay.addEventListener('click', closeDrawer);

    submenuToggles.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-submenu');
        var panel = drawer.querySelector('[data-submenu-panel="' + id + '"]');
        if (panel) panel.classList.add('is-open');
      });
    });

    backButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var panel = btn.closest('.menu-drawer__submenu');
        if (panel) panel.classList.remove('is-open');
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && drawer.classList.contains('is-open')) {
        closeDrawer();
      }
    });
  }

  /* ----- Mobile Sidebar Toggle ----- */

  function initMobileSidebarToggle() {
    var title = document.querySelector('.sidebar .sidebar-title');
    if (!title) return;
    title.addEventListener('click', function () {
      var sidebar = title.closest('.sidebar');
      if (sidebar) sidebar.classList.toggle('sidebar-expanded');
    });
  }

  /* ----- Bible Verse Popup ----- */

  function initVersePopup() {
    var overlay = document.querySelector('[data-verse-overlay]');
    var titleEl = document.querySelector('[data-verse-title]');
    var bodyEl = document.querySelector('[data-verse-body]');
    var translationEl = document.querySelector('[data-verse-translation]');
    var linkEl = document.querySelector('[data-verse-link]');
    var closeBtn = document.querySelector('[data-verse-close]');

    if (!overlay) return;

    function closePopup() {
      overlay.classList.remove('is-visible');
    }

    closeBtn.addEventListener('click', closePopup);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closePopup();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closePopup();
    });

    document.addEventListener('click', function (e) {
      var ref = e.target.closest('.bible-ref');
      if (!ref) return;
      e.preventDefault();

      var refText = ref.getAttribute('data-ref');
      var translation = 'bsb';

      titleEl.textContent = refText;
      bodyEl.innerHTML = '<div class="verse-popup-loading">Loading...</div>';
      translationEl.textContent = '';
      linkEl.href = '#';
      overlay.classList.add('is-visible');

      // Normalize en-dash to hyphen for API
      var apiRef = refText.replace(/\u2013/g, '-');

      fetch('/api/verses?ref=' + encodeURIComponent(apiRef) + '&translation=' + translation)
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.error || !data.verses || data.verses.length === 0) {
            bodyEl.innerHTML = '<div class="verse-popup-loading">Verse not found.</div>';
            return;
          }

          var html = '';
          var inParagraph = false;
          data.verses.forEach(function (v, i) {
            if (v.gap) {
              if (inParagraph) { html += '</p>'; inParagraph = false; }
              html += '<div class="verse-gap"></div>';
              return;
            }
            if (v.sectionHeading) {
              if (inParagraph) { html += '</p>'; inParagraph = false; }
              html += '<div class="verse-popup-heading">' + v.sectionHeading + '</div>';
            }
            if (v.paragraphStart || !inParagraph) {
              if (inParagraph) html += '</p>';
              html += '<p>';
              inParagraph = true;
            }
            html += '<sup class="verse-num">' + v.verse + '</sup> ' + v.text + ' ';
          });
          if (inParagraph) html += '</p>';
          bodyEl.innerHTML = html;
          translationEl.textContent = 'Berean Standard Bible';

          // Build link to Bible browsing page
          var firstRef = data.verses[0].ref;
          var match = firstRef.match(/^(.+?)\s+(\d+):/);
          if (match) {
            linkEl.href = '/bible/bsb/' + encodeURIComponent(match[1]) + '?chapter=' + match[2] + '#v' + data.verses[0].verse;
          }
        })
        .catch(function () {
          bodyEl.innerHTML = '<div class="verse-popup-loading">Failed to load verses.</div>';
        });
    });
  }

  /* ----- Init on DOM Ready ----- */

  document.addEventListener('DOMContentLoaded', function () {
    initSidebarToggle();
    initViewToggle();
    initMenuDrawer();
    initMobileSidebarToggle();
    initVersePopup();
  });
})();
