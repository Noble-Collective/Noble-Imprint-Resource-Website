// Noble Imprint — Admin Console Client JS
(function () {
  'use strict';

  var data = window.__ADMIN_DATA || { users: [], books: [] };

  // --- Tab switching ---
  document.querySelectorAll('[data-admin-tab]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.admin-tab').forEach(function (t) { t.classList.remove('admin-tab--active'); });
      document.querySelectorAll('.admin-panel').forEach(function (p) { p.classList.add('admin-panel--hidden'); });
      btn.classList.add('admin-tab--active');
      var panel = document.getElementById('panel-' + btn.getAttribute('data-admin-tab'));
      if (panel) panel.classList.remove('admin-panel--hidden');
    });
  });

  // --- Modal helpers ---
  function openModal(id) {
    document.getElementById(id).style.display = 'flex';
  }
  function closeModal(id) {
    document.getElementById(id).style.display = 'none';
  }

  document.querySelectorAll('[data-close-modal]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var modal = btn.closest('.admin-modal-overlay');
      if (modal) modal.style.display = 'none';
    });
  });

  // Close modals on overlay click
  document.querySelectorAll('.admin-modal-overlay').forEach(function (overlay) {
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.style.display = 'none';
    });
  });

  // --- API helpers ---
  function apiCall(method, url, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    return fetch(url, opts).then(function (res) {
      if (!res.ok) return res.json().then(function (d) { throw new Error(d.error || 'Request failed'); });
      return res.json();
    });
  }

  function roleName(role) {
    var names = {
      'viewer': 'Viewer',
      'comment-suggest': 'Comment / Suggest',
      'manuscript-owner': 'Manuscript Owner',
      'admin': 'Admin',
      'super-admin': 'Super Admin',
    };
    return names[role] || role || '--';
  }

  function decodeBookPath(encoded) {
    return encoded.replace(/\|/g, '/');
  }

  function bookTitleByPath(repoPath) {
    for (var i = 0; i < data.books.length; i++) {
      if (data.books[i].repoPath === repoPath) return data.books[i].title;
    }
    return repoPath;
  }

  // --- Add User ---
  document.getElementById('add-user-btn').addEventListener('click', function () {
    document.getElementById('add-user-email').value = '';
    openModal('modal-add-user');
    document.getElementById('add-user-email').focus();
  });

  document.getElementById('add-user-submit').addEventListener('click', function () {
    var email = document.getElementById('add-user-email').value.trim();
    if (!email) return;

    apiCall('POST', '/api/admin/users', { email: email })
      .then(function () { window.location.reload(); })
      .catch(function (err) { alert('Error: ' + err.message); });
  });

  // Enter key in email field
  document.getElementById('add-user-email').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') document.getElementById('add-user-submit').click();
  });

  // --- Edit User ---
  document.querySelectorAll('[data-edit-user]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var email = btn.getAttribute('data-edit-user');
      var currentRole = btn.getAttribute('data-role');
      document.getElementById('edit-user-email').textContent = email;
      document.getElementById('edit-user-role').value = currentRole || '';
      document.getElementById('edit-user-submit').setAttribute('data-email', email);
      openModal('modal-edit-user');
    });
  });

  document.getElementById('edit-user-submit').addEventListener('click', function () {
    var email = this.getAttribute('data-email');
    var role = document.getElementById('edit-user-role').value || null;

    apiCall('PUT', '/api/admin/users/' + encodeURIComponent(email) + '/role', { role: role })
      .then(function () { window.location.reload(); })
      .catch(function (err) { alert('Error: ' + err.message); });
  });

  // --- Delete User ---
  document.querySelectorAll('[data-delete-user]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var email = btn.getAttribute('data-delete-user');
      if (!confirm('Remove ' + email + '? This will revoke all their roles and access.')) return;

      apiCall('DELETE', '/api/admin/users/' + encodeURIComponent(email))
        .then(function () { window.location.reload(); })
        .catch(function (err) { alert('Error: ' + err.message); });
    });
  });

  // --- Show Book Roles for a User (all books with dropdowns) ---
  var currentBookRolesEmail = null;

  document.querySelectorAll('[data-show-book-roles]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var email = btn.getAttribute('data-show-book-roles');
      var isAdmin = btn.getAttribute('data-is-admin') === 'true';
      var isSuper = btn.getAttribute('data-is-super') === 'true';
      currentBookRolesEmail = email;
      document.getElementById('book-roles-user-email').textContent = email;
      renderBookRolesForUser(email, isAdmin, isSuper);
      openModal('modal-book-roles');
    });
  });

  function renderBookRolesForUser(email, isAdmin, isSuper) {
    var user = null;
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].email === email) { user = data.users[i]; break; }
    }
    var userRoles = (user && user.bookRoles) ? user.bookRoles : {};

    var listEl = document.getElementById('book-roles-list');
    var html = '<table class="admin-table admin-table--compact"><thead><tr><th>Book</th><th>Series</th><th>Role</th></tr></thead><tbody>';

    var adminLabel = isSuper ? 'Super Admin' : 'Admin';

    data.books.forEach(function (book) {
      var encodedKey = book.repoPath.replace(/\//g, '|');
      var currentRole = userRoles[encodedKey] || '';

      html += '<tr>';
      html += '<td>' + book.title + '</td>';
      html += '<td class="text-muted">' + (book.seriesTitle || '') + '</td>';

      if (isAdmin || isSuper) {
        html += '<td><span class="admin-badge admin-badge--disabled">' + adminLabel + '</span></td>';
      } else {
        html += '<td><select class="admin-select admin-select--inline" data-book-role-select data-path="' + book.repoPath + '" data-email="' + email + '">';
        html += '<option value=""' + (currentRole === '' ? ' selected' : '') + '>None</option>';
        html += '<option value="viewer"' + (currentRole === 'viewer' ? ' selected' : '') + '>Viewer</option>';
        html += '<option value="comment-suggest"' + (currentRole === 'comment-suggest' ? ' selected' : '') + '>Comment / Suggest</option>';
        html += '<option value="manuscript-owner"' + (currentRole === 'manuscript-owner' ? ' selected' : '') + '>Manuscript Owner</option>';
        html += '</select></td>';
      }

      html += '</tr>';
    });

    html += '</tbody></table>';
    listEl.innerHTML = html;

    // Bind change events on dropdowns
    listEl.querySelectorAll('[data-book-role-select]').forEach(function (select) {
      select.addEventListener('change', function () {
        var bookPath = select.getAttribute('data-path');
        var email = select.getAttribute('data-email');
        var role = select.value;
        var encodedKey = bookPath.replace(/\//g, '|');

        select.disabled = true;

        if (role === '') {
          // Remove role
          apiCall('DELETE', '/api/admin/users/' + encodeURIComponent(email) + '/books', { bookPath: bookPath })
            .then(function () {
              // Update local data
              data.users.forEach(function (u) {
                if (u.email === email && u.bookRoles) delete u.bookRoles[encodedKey];
              });
              select.disabled = false;
              updateBookRoleCountInTable(email);
            })
            .catch(function (err) { select.disabled = false; alert('Error: ' + err.message); });
        } else {
          // Set role
          apiCall('PUT', '/api/admin/users/' + encodeURIComponent(email) + '/books', { bookPath: bookPath, role: role })
            .then(function () {
              // Update local data
              data.users.forEach(function (u) {
                if (u.email === email) {
                  if (!u.bookRoles) u.bookRoles = {};
                  u.bookRoles[encodedKey] = role;
                }
              });
              select.disabled = false;
              updateBookRoleCountInTable(email);
            })
            .catch(function (err) { select.disabled = false; alert('Error: ' + err.message); });
        }
      });
    });
  }

  // --- Toggle Book Status ---
  document.querySelectorAll('[data-toggle-status]').forEach(function (checkbox) {
    checkbox.addEventListener('change', function () {
      var bookPath = checkbox.getAttribute('data-toggle-status');
      var status = checkbox.checked ? 'public' : 'hidden';
      var label = checkbox.parentElement.querySelector('.admin-toggle-label');

      // Optimistic UI
      label.textContent = status === 'public' ? 'Public' : 'Hidden';
      checkbox.disabled = true;

      apiCall('PUT', '/api/admin/books/status', { bookPath: bookPath, status: status })
        .then(function () {
          checkbox.disabled = false;
        })
        .catch(function (err) {
          // Revert
          checkbox.checked = !checkbox.checked;
          label.textContent = checkbox.checked ? 'Public' : 'Hidden';
          checkbox.disabled = false;
          alert('Error: ' + err.message);
        });
    });
  });

  // --- Manage Book Access ---
  var currentAccessBookPath = null;

  document.querySelectorAll('[data-manage-access]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var bookPath = btn.getAttribute('data-manage-access');
      var bookTitle = btn.getAttribute('data-book-title');
      currentAccessBookPath = bookPath;

      document.getElementById('access-book-title').textContent = bookTitle;
      refreshAccessList(bookPath);
      openModal('modal-manage-access');
    });
  });

  function refreshAccessList(bookPath) {
    var listEl = document.getElementById('access-list');
    var encodedKey = bookPath.replace(/\//g, '|');

    // Find users with roles on this book
    var entries = [];
    data.users.forEach(function (u) {
      if (u.bookRoles && u.bookRoles[encodedKey]) {
        entries.push({ email: u.email, displayName: u.displayName, role: u.bookRoles[encodedKey] });
      }
    });

    if (entries.length === 0) {
      listEl.innerHTML = '<p class="text-muted">No users have specific access to this book. Admins can always see all books.</p>';
    } else {
      var html = '<table class="admin-table admin-table--compact"><thead><tr><th>User</th><th>Role</th><th></th></tr></thead><tbody>';
      entries.forEach(function (entry) {
        html += '<tr><td>' + (entry.displayName || entry.email) + ' <span class="text-muted">(' + entry.email + ')</span></td>';
        html += '<td>' + roleName(entry.role) + '</td>';
        html += '<td><button class="admin-btn admin-btn--sm admin-btn--danger" data-revoke-access data-email="' + entry.email + '">Revoke</button></td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
      listEl.innerHTML = html;

      // Bind revoke buttons
      listEl.querySelectorAll('[data-revoke-access]').forEach(function (rb) {
        rb.addEventListener('click', function () {
          var email = rb.getAttribute('data-email');
          apiCall('DELETE', '/api/admin/users/' + encodeURIComponent(email) + '/books', { bookPath: currentAccessBookPath })
            .then(function () {
              // Update local data
              var encodedKey = currentAccessBookPath.replace(/\//g, '|');
              data.users.forEach(function (u) {
                if (u.email === email && u.bookRoles) delete u.bookRoles[encodedKey];
              });
              refreshAccessList(currentAccessBookPath);
              // Update the book roles count in the users table
              updateBookRoleCountInTable(email);
            })
            .catch(function (err) { alert('Error: ' + err.message); });
        });
      });
    }
  }

  function updateBookRoleCountInTable(email) {
    var row = document.querySelector('[data-user-email="' + email + '"]');
    if (!row) return;
    var user = null;
    data.users.forEach(function (u) { if (u.email === email) user = u; });
    if (!user) return;

    // Build summary counts
    var roles = user.bookRoles || {};
    var counts = {};
    var labels = { 'viewer': 'Viewer', 'comment-suggest': 'Commenter', 'manuscript-owner': 'Manuscript Owner' };
    Object.values(roles).forEach(function (role) {
      var label = labels[role] || role;
      counts[label] = (counts[label] || 0) + 1;
    });

    var cell = row.querySelector('td:nth-child(4)');
    var summaryHtml = '';
    var keys = Object.keys(counts);
    if (keys.length > 0) {
      keys.forEach(function (label) {
        summaryHtml += '<span class="admin-role-summary">' + label + ' for ' + counts[label] + ' book' + (counts[label] === 1 ? '' : 's') + '</span>';
      });
    } else {
      summaryHtml = '<span class="text-muted">None</span>';
    }
    summaryHtml += ' <button class="admin-btn-inline" data-show-book-roles="' + email + '" data-is-admin="false" data-is-super="false">Edit</button>';
    cell.innerHTML = summaryHtml;

    // Re-bind the new Edit button
    cell.querySelector('[data-show-book-roles]').addEventListener('click', function () {
      currentBookRolesEmail = email;
      document.getElementById('book-roles-user-email').textContent = email;
      renderBookRolesForUser(email, false, false);
      openModal('modal-book-roles');
    });
  }

  document.getElementById('access-add-btn').addEventListener('click', function () {
    var email = document.getElementById('access-user-select').value;
    var role = document.getElementById('access-role-select').value;
    if (!email || !currentAccessBookPath) return;

    apiCall('PUT', '/api/admin/users/' + encodeURIComponent(email) + '/books', { bookPath: currentAccessBookPath, role: role })
      .then(function () {
        // Update local data
        var encodedKey = currentAccessBookPath.replace(/\//g, '|');
        data.users.forEach(function (u) {
          if (u.email === email) {
            if (!u.bookRoles) u.bookRoles = {};
            u.bookRoles[encodedKey] = role;
          }
        });
        refreshAccessList(currentAccessBookPath);
        document.getElementById('access-user-select').value = '';
      })
      .catch(function (err) { alert('Error: ' + err.message); });
  });

  // --- Reviews Tab ---

  var reviewsLoaded = false;

  document.querySelectorAll('[data-admin-tab]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (btn.getAttribute('data-admin-tab') === 'reviews' && !reviewsLoaded) {
        loadReviewsList();
        reviewsLoaded = true;
      }
    });
  });

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Convert markdown text to clean formatted HTML for copy-paste into Affinity
  function formatCleanText(text) {
    // Curly quotes FIRST (before any HTML escaping)
    // Double quotes
    text = text.replace(/"(\S)/g, '\u201c$1');   // opening "
    text = text.replace(/(\S)"/g, '$1\u201d');    // closing "
    text = text.replace(/"/g, '\u201d');           // remaining " → closing
    // Single quotes / apostrophes
    text = text.replace(/'(\S)/g, '\u2018$1');    // opening '
    text = text.replace(/(\S)'/g, '$1\u2019');    // closing / apostrophe
    text = text.replace(/'/g, '\u2019');           // remaining ' → closing

    // Convert <sup>...</sup> to placeholder to preserve through escaping
    text = text.replace(/<sup>([^<]*)<\/sup>/g, '{{SUP:$1}}');
    // Strip <Question ...>, </Question>, <Callout ...>, </Callout> tags — keep inner content
    text = text.replace(/<(Question|Callout)[^>]*>/gi, '');
    text = text.replace(/<\/(Question|Callout)>/gi, '');
    // Strip << Reference >> markers
    text = text.replace(/<<\s*/g, '');
    text = text.replace(/\s*>>/g, '');
    // Strip heading markers (# through ######)
    text = text.replace(/^#{1,6}\s+/gm, '');
    // Strip blockquote markers
    text = text.replace(/^>\s?/gm, '');
    // Bold **text** → <b>text</b>
    text = text.replace(/\*\*(.+?)\*\*/g, '{{B:$1}}');
    // Italic *text* or _text_ → <i>text</i>
    text = text.replace(/\*(.+?)\*/g, '{{I:$1}}');
    text = text.replace(/\b_(.+?)_\b/g, '{{I:$1}}');

    // Escape all remaining HTML
    text = escapeHtml(text);

    // Restore formatted tags from placeholders
    text = text.replace(/\{\{B:(.*?)\}\}/g, '<b>$1</b>');
    text = text.replace(/\{\{I:(.*?)\}\}/g, '<i>$1</i>');
    text = text.replace(/\{\{SUP:(.*?)\}\}/g, '<sup>$1</sup>');

    // Convert newlines to <br> for display
    text = text.replace(/\n/g, '<br>');
    return text;
  }

  function fileNameFromPath(path) {
    var parts = path.split('/');
    return parts[parts.length - 1];
  }

  function loadReviewsList() {
    var listEl = document.getElementById('reviews-list');
    listEl.innerHTML = '<p class="text-muted">Loading...</p>';

    apiCall('GET', '/api/suggestions?status=pending')
      .then(function (items) {
        if (items.length === 0) {
          listEl.innerHTML = '<p class="text-muted">No pending suggestions.</p>';
          return;
        }

        // Group by filePath
        var byFile = {};
        items.forEach(function (item) {
          if (!byFile[item.filePath]) byFile[item.filePath] = { book: item.bookPath, items: [] };
          byFile[item.filePath].items.push(item);
        });

        var html = '<table class="admin-table"><thead><tr>';
        html += '<th>Session</th><th>Book</th><th>Suggestions</th><th>Authors</th><th></th>';
        html += '</tr></thead><tbody>';

        Object.keys(byFile).forEach(function (filePath) {
          var group = byFile[filePath];
          var authors = [];
          group.items.forEach(function (item) {
            if (authors.indexOf(item.authorName || item.authorEmail) === -1) {
              authors.push(item.authorName || item.authorEmail);
            }
          });

          // Build a URL to the session page
          // filePath looks like: series/Narrative Journey Series/Foundations/Test Book/sessions/1-Session1.md
          // We need to construct the website URL from this
          html += '<tr>';
          html += '<td>' + escapeHtml(fileNameFromPath(filePath)) + '</td>';
          html += '<td class="text-muted">' + escapeHtml(group.book.split('/').pop()) + '</td>';
          html += '<td>' + group.items.length + '</td>';
          html += '<td>' + escapeHtml(authors.join(', ')) + '</td>';
          html += '<td><a href="/?reviewFile=' + encodeURIComponent(filePath) + '" class="admin-btn admin-btn--sm">Open Session</a></td>';
          html += '</tr>';
        });

        html += '</tbody></table>';
        listEl.innerHTML = html;
      })
      .catch(function (err) {
        listEl.innerHTML = '<p class="text-muted">Error: ' + err.message + '</p>';
      });
  }

  // --- Diff Reports ---
  var tagsLoaded = false;
  var diffFromSelect = document.getElementById('diff-from-select');
  var diffToSelect = document.getElementById('diff-to-select');
  var diffBookSelect = document.getElementById('diff-book-select');
  var diffGenerateBtn = document.getElementById('diff-generate-btn');
  var diffOutput = document.getElementById('diff-report-output');

  // Load tags when the tab is first shown
  document.querySelector('[data-admin-tab="diff-reports"]')?.addEventListener('click', function () {
    if (tagsLoaded) return;
    tagsLoaded = true;
    apiCall('GET', '/api/admin/tags').then(function (tags) {
      diffFromSelect.innerHTML = '<option value="">Select a tag...</option>';
      diffToSelect.innerHTML = '<option value="main">main (latest)</option>';
      tags.forEach(function (t) {
        diffFromSelect.innerHTML += '<option value="' + escapeHtml(t.name) + '">' + escapeHtml(t.name) + '</option>';
        diffToSelect.innerHTML += '<option value="' + escapeHtml(t.name) + '">' + escapeHtml(t.name) + '</option>';
      });
      diffFromSelect.disabled = false;
      updateDiffBtn();
    }).catch(function () {
      diffFromSelect.innerHTML = '<option value="">Failed to load tags</option>';
    });
  });

  function updateDiffBtn() {
    if (diffGenerateBtn) {
      diffGenerateBtn.disabled = !diffBookSelect?.value || !diffFromSelect?.value;
    }
  }
  diffBookSelect?.addEventListener('change', updateDiffBtn);
  diffFromSelect?.addEventListener('change', updateDiffBtn);

  diffGenerateBtn?.addEventListener('click', function () {
    var bookPath = diffBookSelect.value;
    var from = diffFromSelect.value;
    var to = diffToSelect.value || 'main';
    if (!bookPath || !from) return;

    diffOutput.innerHTML = '<div class="admin-diff-loading"><span class="margin-card-spinner" style="width:18px;height:18px;display:inline-block"></span> Generating diff report...</div>';
    diffGenerateBtn.disabled = true;

    var url = '/api/admin/diff-report?bookPath=' + encodeURIComponent(bookPath) + '&from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
    apiCall('GET', url).then(function (report) {
      diffGenerateBtn.disabled = false;
      renderDiffReport(report);
    }).catch(function (err) {
      diffGenerateBtn.disabled = false;
      diffOutput.innerHTML = '<p class="text-muted">Error: ' + escapeHtml(err.message || 'Failed to generate report') + '</p>';
    });
  });

  function renderDiffReport(report) {
    if (!report.files || report.files.length === 0) {
      diffOutput.innerHTML = '<div class="admin-diff-empty">No changes found between <strong>' + escapeHtml(report.from) + '</strong> and <strong>' + escapeHtml(report.to) + '</strong>.</div>';
      return;
    }

    // Track change IDs for sidebar links
    var changeId = 0;
    var sidebarEntries = []; // {id, fileIdx, displayName, breadcrumb, type}

    // --- Build main diff content ---
    var contentHtml = '<h3 class="admin-diff-title">' + escapeHtml(report.from) + ' &rarr; ' + escapeHtml(report.to) + ' <span class="text-muted">(' + report.files.length + ' file' + (report.files.length === 1 ? '' : 's') + ' changed)</span></h3>';

    report.files.forEach(function (file, idx) {
      var statusClass = 'admin-badge--' + file.status;
      contentHtml += '<div class="admin-diff-file" id="diff-file-' + idx + '">';
      contentHtml += '<div class="admin-diff-file-header" data-diff-toggle="' + idx + '">';
      contentHtml += '<span>' + escapeHtml(file.displayName || file.filename) + '</span>';
      contentHtml += ' <span class="admin-badge ' + statusClass + '">' + file.status + '</span>';
      contentHtml += '</div>';
      contentHtml += '<div class="admin-diff-file-body" id="diff-body-' + idx + '">';

      file.chunks.forEach(function (chunk, ci) {
        if (chunk.type === 'equal') {
          var lines = chunk.text.split('\n');
          if (lines.length > 7) {
            var first = lines.slice(0, 3).join('\n');
            var last = lines.slice(-3).join('\n');
            var hidden = lines.slice(3, -3).join('\n');
            contentHtml += '<div class="admin-diff-chunk admin-diff-chunk--equal">' + escapeHtml(first) + '\n</div>';
            contentHtml += '<div class="admin-diff-context-toggle" data-expand="ctx-' + idx + '-' + ci + '">... ' + (lines.length - 6) + ' unchanged lines ...</div>';
            contentHtml += '<div class="admin-diff-chunk admin-diff-chunk--equal" id="ctx-' + idx + '-' + ci + '" style="display:none">' + escapeHtml(hidden) + '\n</div>';
            contentHtml += '<div class="admin-diff-chunk admin-diff-chunk--equal">' + escapeHtml(last) + '</div>';
          } else {
            contentHtml += '<div class="admin-diff-chunk admin-diff-chunk--equal">' + escapeHtml(chunk.text) + '</div>';
          }
        } else {
          var cid = 'diff-change-' + changeId++;
          var bc = chunk.breadcrumb || [];
          var lineNum = chunk.toLine || null;

          // Every change gets a full breadcrumb bar with line number + heading trail
          contentHtml += '<div class="admin-diff-breadcrumb" id="' + cid + '">';
          if (lineNum) {
            contentHtml += '<span class="admin-diff-breadcrumb-line">Line ' + lineNum + '</span>';
          }
          if (bc.length > 0) {
            if (lineNum) contentHtml += '<span class="admin-diff-breadcrumb-sep"> &mdash; </span>';
            bc.forEach(function (part, pi) {
              if (pi > 0) contentHtml += '<span class="admin-diff-breadcrumb-sep"> &rsaquo; </span>';
              contentHtml += '<span class="admin-diff-breadcrumb-part">' + escapeHtml(part) + '</span>';
            });
          }
          contentHtml += '</div>';

          // Track for sidebar
          sidebarEntries.push({
            id: cid,
            fileIdx: idx,
            displayName: file.displayName || file.filename,
            breadcrumb: bc,
            type: chunk.type
          });

          // Build diff column + clean copy column side by side
          var diffHtml = '';
          var cleanText = '';

          if (chunk.type === 'added') {
            diffHtml = '<div class="admin-diff-chunk admin-diff-chunk--added">' + escapeHtml(chunk.text) + '</div>';
            cleanText = chunk.text;
          } else if (chunk.type === 'removed') {
            diffHtml = '<div class="admin-diff-chunk admin-diff-chunk--removed">' + escapeHtml(chunk.text) + '</div>';
            cleanText = ''; // nothing to copy for removals
          } else if (chunk.type === 'changed') {
            diffHtml = '<div class="admin-diff-chunk admin-diff-chunk--changed">';
            var toText = '';
            chunk.words.forEach(function (w) {
              if (w.type === 'added') {
                diffHtml += '<span class="admin-diff-word--added">' + escapeHtml(w.text) + '</span>';
                toText += w.text;
              } else if (w.type === 'removed') {
                diffHtml += '<span class="admin-diff-word--removed">' + escapeHtml(w.text) + '</span>';
              } else {
                diffHtml += escapeHtml(w.text);
                toText += w.text;
              }
            });
            diffHtml += '</div>';
            cleanText = toText;
          }

          if (cleanText) {
            // Two-column: diff left, clean copy right (grid via display:contents)
            contentHtml += '<div class="admin-diff-change-row">';
            contentHtml += '<div class="admin-diff-change-row-diff">' + diffHtml + '</div>';
            contentHtml += '<div class="admin-diff-change-row-clean">' + formatCleanText(cleanText) + '</div>';
            contentHtml += '</div>';
          } else {
            // Removed-only: spans full width
            contentHtml += diffHtml;
          }
        }
      });

      contentHtml += '</div></div>';
    });

    // --- Build sidebar TOC from heading outline + change locations ---
    var sidebarHtml = '<div class="admin-diff-sidebar-title">Changes</div>';

    report.files.forEach(function (file, idx) {
      // Group changes by their breadcrumb section (capped at depth 4)
      var fileEntries = sidebarEntries.filter(function (e) { return e.fileIdx === idx; });
      var MAX_SIDEBAR_DEPTH = 4;
      var DEFAULT_DEPTH = 2;

      // Count top-of-file changes (empty breadcrumb) to show on the file name row
      var topOfFileCount = 0;
      var topOfFileId = null;
      var sections = [];
      var currentSection = { heading: null, level: 0, firstChangeId: null, changeCount: 0 };

      fileEntries.forEach(function (entry) {
        var bc = entry.breadcrumb;
        if (bc.length === 0) {
          topOfFileCount++;
          if (!topOfFileId) topOfFileId = entry.id;
          return;
        }
        var truncated = bc.slice(0, MAX_SIDEBAR_DEPTH);
        var sectionKey = truncated.join(' > ');
        if (sectionKey !== (currentSection._key || null)) {
          if (currentSection.changeCount > 0) sections.push(currentSection);
          currentSection = {
            heading: truncated[truncated.length - 1],
            breadcrumb: truncated,
            level: truncated.length,
            firstChangeId: entry.id,
            changeCount: 1,
            _key: sectionKey
          };
        } else {
          currentSection.changeCount++;
        }
      });
      if (currentSection.changeCount > 0) sections.push(currentSection);

      // Ensure parent entries exist at depth 1 and 2 for all deeper sections.
      // If "Session One > Seeking God's Wisdom > Core Principle" exists at depth 3
      // but no section at depth 2 for "Session One", insert one.
      var seenKeys = {};
      sections.forEach(function (s) { seenKeys[s._key] = true; });
      var extraSections = [];
      sections.forEach(function (sec) {
        for (var d = 1; d < sec.level; d++) {
          var parentBc = sec.breadcrumb.slice(0, d);
          var parentKey = parentBc.join(' > ');
          if (!seenKeys[parentKey]) {
            seenKeys[parentKey] = true;
            extraSections.push({
              heading: parentBc[parentBc.length - 1],
              breadcrumb: parentBc,
              level: d,
              firstChangeId: sec.firstChangeId,
              changeCount: 0, // navigation-only parent
              _key: parentKey
            });
          }
        }
      });
      // Merge extras and sort by first appearance order (by firstChangeId index in sidebarEntries)
      sections = sections.concat(extraSections);
      sections.sort(function (a, b) {
        // Sort by breadcrumb path to maintain tree order
        var aPath = a._key;
        var bPath = b._key;
        // If one is a prefix of the other, the shorter one comes first
        if (bPath.indexOf(aPath) === 0) return -1;
        if (aPath.indexOf(bPath) === 0) return 1;
        // Otherwise sort by the first change ID (numeric suffix)
        var aId = parseInt((a.firstChangeId || '').replace('diff-change-', ''), 10) || 0;
        var bId = parseInt((b.firstChangeId || '').replace('diff-change-', ''), 10) || 0;
        return aId - bId;
      });

      // File name row — includes top-of-file count if any
      sidebarHtml += '<div class="admin-diff-sidebar-file">';
      sidebarHtml += '<div class="admin-diff-sidebar-file-name" data-sidebar-file="' + idx + '"';
      if (topOfFileId) sidebarHtml += ' data-sidebar-jump="' + topOfFileId + '"';
      sidebarHtml += '>';
      sidebarHtml += escapeHtml(file.displayName || file.filename);
      if (topOfFileCount > 0) {
        sidebarHtml += ' <span class="admin-diff-sidebar-count">' + topOfFileCount + '</span>';
      }
      sidebarHtml += '</div>';

      // Render sections — depth 1-2 always visible, depth 3-4 in collapsible groups
      var inExpandable = false;
      var expandGroupId = 0;

      // Pre-scan: count depth 3-4 children per depth-2 parent
      var parentIdx = -1;
      var deepCount = 0;
      sections.forEach(function (sec, si) {
        if (sec.level <= DEFAULT_DEPTH) {
          if (parentIdx >= 0 && deepCount > 0) sections[parentIdx]._deepCount = deepCount;
          parentIdx = si;
          deepCount = 0;
        } else {
          deepCount++;
        }
      });
      if (parentIdx >= 0 && deepCount > 0) sections[parentIdx]._deepCount = deepCount;

      sections.forEach(function (sec) {
        if (sec.level <= DEFAULT_DEPTH) {
          if (inExpandable) { sidebarHtml += '</div>'; inExpandable = false; }

          var indent = Math.min(sec.level, 4);
          var hasChildren = sec._deepCount > 0;
          sidebarHtml += '<a class="admin-diff-sidebar-link' + (hasChildren ? ' admin-diff-sidebar-link--expandable' : '') + '" href="#' + sec.firstChangeId + '" style="padding-left:' + (8 + indent * 12) + 'px"';
          if (hasChildren) sidebarHtml += ' data-sidebar-expand="expand-' + idx + '-' + expandGroupId + '"';
          sidebarHtml += '>';
          if (hasChildren) sidebarHtml += '<span class="admin-diff-sidebar-arrow">&#9654;</span>';
          sidebarHtml += '<span class="admin-diff-sidebar-heading">' + escapeHtml(sec.heading) + '</span>';
          if (sec.changeCount > 0) sidebarHtml += ' <span class="admin-diff-sidebar-count">' + sec.changeCount + '</span>';
          sidebarHtml += '</a>';

          if (hasChildren) {
            sidebarHtml += '<div class="admin-diff-sidebar-expand" id="expand-' + idx + '-' + expandGroupId + '">';
            inExpandable = true;
            expandGroupId++;
          }
        } else {
          var indent = Math.min(sec.level, 4);
          sidebarHtml += '<a class="admin-diff-sidebar-link" href="#' + sec.firstChangeId + '" style="padding-left:' + (8 + indent * 12) + 'px">';
          sidebarHtml += '<span class="admin-diff-sidebar-heading">' + escapeHtml(sec.heading) + '</span>';
          if (sec.changeCount > 0) sidebarHtml += ' <span class="admin-diff-sidebar-count">' + sec.changeCount + '</span>';
          sidebarHtml += '</a>';
        }
      });
      if (inExpandable) { sidebarHtml += '</div>'; }

      sidebarHtml += '</div>';
    });

    // --- Render two-column layout ---
    diffOutput.innerHTML =
      '<div class="admin-diff-layout">' +
        '<nav class="admin-diff-sidebar">' + sidebarHtml + '</nav>' +
        '<div class="admin-diff-content">' + contentHtml + '</div>' +
      '</div>';

    // Bind toggle listeners for collapsible file sections
    diffOutput.querySelectorAll('[data-diff-toggle]').forEach(function (header) {
      header.addEventListener('click', function () {
        var body = document.getElementById('diff-body-' + header.getAttribute('data-diff-toggle'));
        if (body) body.classList.toggle('admin-diff-file-body--collapsed');
      });
    });

    // Bind expand listeners for collapsed context
    diffOutput.querySelectorAll('[data-expand]').forEach(function (toggle) {
      toggle.addEventListener('click', function () {
        var target = document.getElementById(toggle.getAttribute('data-expand'));
        if (target) {
          target.style.display = '';
          toggle.style.display = 'none';
        }
      });
    });

    // Sidebar expand/collapse for depth 3-4 sections
    diffOutput.querySelectorAll('[data-sidebar-expand]').forEach(function (link) {
      var arrow = link.querySelector('.admin-diff-sidebar-arrow');
      link.addEventListener('click', function (e) {
        // Toggle the expandable group (don't prevent the scroll)
        var groupId = link.getAttribute('data-sidebar-expand');
        var group = document.getElementById(groupId);
        if (group) {
          var isOpen = group.classList.toggle('admin-diff-sidebar-expand--open');
          if (arrow) arrow.classList.toggle('admin-diff-sidebar-arrow--open', isOpen);
        }
      });
    });

    // Sidebar file name clicks jump to file header (or first top-of-file change)
    diffOutput.querySelectorAll('[data-sidebar-file]').forEach(function (el) {
      el.addEventListener('click', function () {
        var jumpId = el.getAttribute('data-sidebar-jump');
        var target = jumpId ? document.getElementById(jumpId) : document.getElementById('diff-file-' + el.getAttribute('data-sidebar-file'));
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    // Smooth scroll for sidebar links
    diffOutput.querySelectorAll('.admin-diff-sidebar-link').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        var target = document.getElementById(link.getAttribute('href').slice(1));
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    // Highlight active sidebar link on scroll
    var sidebarLinks = diffOutput.querySelectorAll('.admin-diff-sidebar-link');
    var changeAnchors = [];
    sidebarLinks.forEach(function (link) {
      var id = link.getAttribute('href').slice(1);
      var el = document.getElementById(id);
      if (el) changeAnchors.push({ el: el, link: link });
    });

    var scrollTimeout;
    function updateActiveSidebarLink() {
      var scrollTop = window.scrollY || document.documentElement.scrollTop;
      var active = null;
      for (var i = 0; i < changeAnchors.length; i++) {
        if (changeAnchors[i].el.getBoundingClientRect().top <= 100) {
          active = changeAnchors[i].link;
        }
      }
      sidebarLinks.forEach(function (l) { l.classList.remove('admin-diff-sidebar-link--active'); });
      if (active) active.classList.add('admin-diff-sidebar-link--active');
    }

    window.addEventListener('scroll', function () {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(updateActiveSidebarLink, 50);
    });
    updateActiveSidebarLink();
  }

})();
