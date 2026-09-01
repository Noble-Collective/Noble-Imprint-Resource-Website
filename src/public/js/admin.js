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
    text = text.replace(/(^|[\s(\[{\u2014\u2013\-])"(\S)/gm, '$1\u201c$2');  // opening " after whitespace/start/dash
    text = text.replace(/(\S)"([\s,.\-;:!?\])}]|$)/gm, '$1\u201d$2');  // closing " before whitespace/punct/end
    text = text.replace(/"/g, '\u201d');           // remaining " → closing
    // Single quotes / apostrophes — do apostrophes FIRST (mid-word)
    text = text.replace(/(\w)'(\w)/g, '$1\u2019$2');  // apostrophe: it's, don't, God's → right curl
    text = text.replace(/(^|[\s(\[{\u2014\u2013\-])'(\S)/gm, '$1\u2018$2');  // opening ' after whitespace/start/dash
    text = text.replace(/(\S)'([\s,.\-;:!?\])}]|$)/gm, '$1\u2019$2');  // closing ' before whitespace/punct/end
    text = text.replace(/'/g, '\u2019');           // remaining ' → right curl

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

    // Markdown line breaks: two trailing spaces + newline = <br>
    text = text.replace(/  \n/g, '<br>');
    // Double newlines = paragraph breaks
    text = text.replace(/\n\n+/g, '</p><p>');
    // Remaining single newlines = space (text flows)
    text = text.replace(/\n/g, ' ');
    text = '<p>' + text + '</p>';
    // Clean up empty paragraphs
    text = text.replace(/<p>\s*<\/p>/g, '');
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
  var diffFileUpload = document.getElementById('diff-file-upload');
  var diffFileName = document.getElementById('diff-file-name');
  var uploadedFileContent = null;

  // Load tags when the tab is first shown
  document.querySelector('[data-admin-tab="diff-reports"]')?.addEventListener('click', function () {
    if (tagsLoaded) return;
    tagsLoaded = true;
    apiCall('GET', '/api/admin/tags').then(function (tags) {
      diffFromSelect.innerHTML = '<option value="">Select a tag...</option><option value="__upload__">Upload file...</option>';
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

  // Handle "Upload file..." selection
  diffFromSelect?.addEventListener('change', function () {
    if (diffFromSelect.value === '__upload__') {
      diffFileUpload.click();
    } else {
      uploadedFileContent = null;
      if (diffFileName) diffFileName.style.display = 'none';
    }
    updateDiffBtn();
  });

  diffFileUpload?.addEventListener('change', function () {
    var file = diffFileUpload.files[0];
    if (!file) {
      diffFromSelect.value = '';
      uploadedFileContent = null;
      if (diffFileName) diffFileName.style.display = 'none';
      updateDiffBtn();
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      uploadedFileContent = reader.result;
      if (diffFileName) {
        diffFileName.textContent = file.name;
        diffFileName.style.display = 'inline';
      }
      updateDiffBtn();
    };
    reader.readAsText(file);
  });

  function updateDiffBtn() {
    if (diffGenerateBtn) {
      var hasFrom = diffFromSelect?.value === '__upload__' ? !!uploadedFileContent : !!diffFromSelect?.value;
      diffGenerateBtn.disabled = !diffBookSelect?.value || !hasFrom;
    }
  }
  diffBookSelect?.addEventListener('change', updateDiffBtn);

  var lastDiffReport = null;
  var diffMergedMode = false;
  var diffTextOnly = false;
  var diffSplitView = false;
  var diffShowClean = false;

  diffGenerateBtn?.addEventListener('click', function () {
    var bookPath = diffBookSelect.value;
    var from = diffFromSelect.value;
    var to = diffToSelect.value || 'main';
    if (!bookPath || (!from && !uploadedFileContent)) return;

    diffOutput.innerHTML = '<div class="admin-diff-loading"><span class="margin-card-spinner" style="width:18px;height:18px;display:inline-block"></span> Generating diff report...</div>';
    diffGenerateBtn.disabled = true;

    if (from === '__upload__' && uploadedFileContent) {
      // POST uploaded file content for comparison
      fetch('/api/admin/diff-report-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookPath: bookPath, to: to, uploadedContent: uploadedFileContent })
      }).then(function (res) {
        if (!res.ok) return res.json().then(function (d) { throw new Error(d.error || 'Request failed'); });
        return res.json();
      }).then(function (report) {
        diffGenerateBtn.disabled = false;
        lastDiffReport = report;
        renderDiffReport(report, diffMergedMode, diffTextOnly, diffSplitView, diffShowClean);
      }).catch(function (err) {
        diffGenerateBtn.disabled = false;
        diffOutput.innerHTML = '<p class="text-muted">Error: ' + escapeHtml(err.message || 'Failed') + '</p>';
      });
      return;
    }

    var url = '/api/admin/diff-report?bookPath=' + encodeURIComponent(bookPath) + '&from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
    apiCall('GET', url).then(function (report) {
      diffGenerateBtn.disabled = false;
      lastDiffReport = report;
      renderDiffReport(report, diffMergedMode, diffTextOnly, diffSplitView, diffShowClean);
    }).catch(function (err) {
      diffGenerateBtn.disabled = false;
      diffOutput.innerHTML = '<p class="text-muted">Error: ' + escapeHtml(err.message || 'Failed to generate report') + '</p>';
    });
  });

  // Classify whether a change is formatting-only (not textual content)
  function isFormattingOnly(chunk) {
    var oldText = '', newText = '';
    if (chunk.type === 'changed') {
      chunk.words.forEach(function (w) {
        if (w.type === 'removed') oldText += w.text;
        else if (w.type === 'added') newText += w.text;
      });
    } else if (chunk.type === 'added') { newText = chunk.text; }
    else if (chunk.type === 'removed') { oldText = chunk.text; }

    // Normalize both sides: strip markdown, tags, collapse whitespace
    function normalize(t) {
      // Strip markdown heading markers
      t = t.replace(/^#{1,6}\s+/gm, '');
      // Strip bold/italic markers
      t = t.replace(/\*\*/g, '');
      t = t.replace(/\*/g, '');
      t = t.replace(/_/g, '');
      // Strip HTML tags (Callout, Question, sup, etc.)
      t = t.replace(/<[^>]+>/g, '');
      // Strip << >> reference markers
      t = t.replace(/<<\s*/g, '');
      t = t.replace(/\s*>>/g, '');
      // Strip blockquote markers
      t = t.replace(/^>\s?/gm, '');
      // Fix PDF hyphenation artifacts (word- continuation)
      t = t.replace(/(\w)- (\w)/g, '$1$2');
      t = t.replace(/(\w)-\n(\w)/g, '$1$2');
      // Normalize dashes to plain hyphen
      t = t.replace(/[\u2014\u2013]/g, '-');
      // Collapse all whitespace
      t = t.replace(/\s+/g, ' ').trim();
      return t;
    }

    return normalize(oldText) === normalize(newText);
  }

  function renderDiffReport(report, merged, textOnly, splitView, showClean) {
    if (!report.files || report.files.length === 0) {
      diffOutput.innerHTML = '<div class="admin-diff-empty">No changes found between <strong>' + escapeHtml(report.from) + '</strong> and <strong>' + escapeHtml(report.to) + '</strong>.</div>';
      return;
    }

    // Count textual vs formatting-only changes for the summary
    var totalChanges = 0, textualChanges = 0;
    report.files.forEach(function (f) {
      f.chunks.forEach(function (c) {
        if (c.type !== 'equal') {
          totalChanges++;
          if (!isFormattingOnly(c)) textualChanges++;
        }
      });
    });

    // Track change IDs for sidebar links
    var changeId = 0;
    var sidebarEntries = []; // {id, fileIdx, displayName, breadcrumb, type}

    // Save scroll position so toggles don't jump to top
    var savedScrollTop = window.scrollY || document.documentElement.scrollTop;

    // --- Build main diff content ---
    var contentHtml = '<h3 class="admin-diff-title">' + escapeHtml(report.from) + ' &rarr; ' + escapeHtml(report.to) + ' <span class="text-muted">(' + (textOnly ? textualChanges + ' text changes' : totalChanges + ' changes') + ')</span></h3>';

    report.files.forEach(function (file, idx) {
      var statusClass = 'admin-badge--' + file.status;
      contentHtml += '<div class="admin-diff-file" id="diff-file-' + idx + '">';
      contentHtml += '<div class="admin-diff-file-header admin-diff-file-header--sticky">';
      // Row 1: title + toggles
      contentHtml += '<div class="admin-diff-file-header-row">';
      var showBadge = report.files.length > 1;
      contentHtml += '<div class="admin-diff-file-header-left"><span>' + escapeHtml(file.displayName || file.filename) + '</span>';
      if (showBadge) contentHtml += ' <span class="admin-badge ' + statusClass + '">' + file.status + '</span>';
      contentHtml += '</div>';
      contentHtml += '<div class="admin-diff-mode-toggles">';
      contentHtml += '<div class="admin-diff-mode-group"><span class="admin-diff-mode-label">Columns</span><div class="admin-diff-mode-toggle">';
      contentHtml += '<button class="admin-diff-mode-btn' + (!splitView ? ' admin-diff-mode-btn--active' : '') + '" data-diff-view="merged">Single</button>';
      contentHtml += '<button class="admin-diff-mode-btn' + (splitView ? ' admin-diff-mode-btn--active' : '') + '" data-diff-view="split">Split</button>';
      contentHtml += '</div></div>';
      contentHtml += '<div class="admin-diff-mode-group"><span class="admin-diff-mode-label">Diff View</span><div class="admin-diff-mode-toggle">';
      contentHtml += '<button class="admin-diff-mode-btn' + (!merged ? ' admin-diff-mode-btn--active' : '') + '" data-diff-mode="individual">Single Line</button>';
      contentHtml += '<button class="admin-diff-mode-btn' + (merged ? ' admin-diff-mode-btn--active' : '') + '" data-diff-mode="merged">Merged</button>';
      contentHtml += '</div></div>';
      contentHtml += '<div class="admin-diff-mode-group"><span class="admin-diff-mode-label">Diffs to Show</span><div class="admin-diff-mode-toggle">';
      contentHtml += '<button class="admin-diff-mode-btn' + (!textOnly ? ' admin-diff-mode-btn--active' : '') + '" data-diff-filter="all">All</button>';
      contentHtml += '<button class="admin-diff-mode-btn' + (textOnly ? ' admin-diff-mode-btn--active' : '') + '" data-diff-filter="text">Text Only</button>';
      contentHtml += '</div></div>';
      contentHtml += '<div class="admin-diff-mode-group"><span class="admin-diff-mode-label">Clean Copy</span><div class="admin-diff-mode-toggle">';
      contentHtml += '<button class="admin-diff-mode-btn' + (!showClean ? ' admin-diff-mode-btn--active' : '') + '" data-diff-clean="off">Off</button>';
      contentHtml += '<button class="admin-diff-mode-btn' + (showClean ? ' admin-diff-mode-btn--active' : '') + '" data-diff-clean="on">On</button>';
      contentHtml += '</div></div>';
      contentHtml += '</div></div>';
      // Row 2: colored column labels — span full width of columns below
      var colLabels = [];
      if (splitView) {
        colLabels.push({ cls: 'from', text: 'From: ' + escapeHtml(report.from) });
        colLabels.push({ cls: 'to', text: 'To: ' + escapeHtml(report.to) });
      } else {
        colLabels.push({ cls: 'diff', text: 'From: ' + escapeHtml(report.from) + '  /  To: ' + escapeHtml(report.to) });
      }
      if (showClean) colLabels.push({ cls: 'clean', text: 'Clean Copy' });
      contentHtml += '<div class="admin-diff-file-header-row admin-diff-file-header-row--cols" style="grid-template-columns: repeat(' + colLabels.length + ', 1fr)">';
      colLabels.forEach(function (l) {
        contentHtml += '<span class="admin-diff-col-label admin-diff-col-label--' + l.cls + '">' + l.text + '</span>';
      });
      contentHtml += '</div>';
      contentHtml += '</div>';
      var bodyClass = 'admin-diff-file-body';
      if (splitView && showClean) bodyClass += ' admin-diff-file-body--split3';
      else if (splitView) bodyClass += ' admin-diff-file-body--split2';
      else if (showClean) bodyClass += ' admin-diff-file-body--clean';
      contentHtml += '<div class="' + bodyClass + '" id="diff-body-' + idx + '">';

      // Helper: render a single change chunk's diff HTML and extract clean text
      function renderChunkDiff(chunk) {
        var diffHtml = '';
        var cleanText = '';
        var splitLeft = '', splitRight = '';
        if (chunk.type === 'added') {
          diffHtml = '<div class="admin-diff-chunk admin-diff-chunk--added">' + escapeHtml(chunk.text) + '</div>';
          splitLeft = '';
          splitRight = '<div class="admin-diff-chunk admin-diff-chunk--added">' + escapeHtml(chunk.text) + '</div>';
          cleanText = chunk.text;
        } else if (chunk.type === 'removed') {
          diffHtml = '<div class="admin-diff-chunk admin-diff-chunk--removed">' + escapeHtml(chunk.text) + '</div>';
          splitLeft = '<div class="admin-diff-chunk admin-diff-chunk--removed">' + escapeHtml(chunk.text) + '</div>';
          splitRight = '';
        } else if (chunk.type === 'changed') {
          diffHtml = '<div class="admin-diff-chunk admin-diff-chunk--changed">';
          var leftHtml = '<div class="admin-diff-chunk admin-diff-chunk--changed">';
          var rightHtml = '<div class="admin-diff-chunk admin-diff-chunk--changed">';
          var toText = '';
          chunk.words.forEach(function (w) {
            if (w.type === 'added') {
              diffHtml += '<span class="admin-diff-word--added">' + escapeHtml(w.text) + '</span>';
              rightHtml += '<span class="admin-diff-word--added">' + escapeHtml(w.text) + '</span>';
              toText += w.text;
            } else if (w.type === 'removed') {
              diffHtml += '<span class="admin-diff-word--removed">' + escapeHtml(w.text) + '</span>';
              leftHtml += '<span class="admin-diff-word--removed">' + escapeHtml(w.text) + '</span>';
            } else {
              diffHtml += escapeHtml(w.text);
              leftHtml += escapeHtml(w.text);
              rightHtml += escapeHtml(w.text);
              toText += w.text;
            }
          });
          diffHtml += '</div>';
          leftHtml += '</div>';
          rightHtml += '</div>';
          splitLeft = leftHtml;
          splitRight = rightHtml;
          cleanText = toText;
        }
        return { diffHtml: diffHtml, splitLeft: splitLeft, splitRight: splitRight, cleanText: cleanText };
      }

      // Helper: render a breadcrumb bar
      function renderBreadcrumb(cid, chunk) {
        var bc = chunk.breadcrumb || [];
        var fromBc = chunk.fromBreadcrumb || [];
        var lineNum = chunk.toLine || null;
        var fromLineNum = chunk.fromLine || null;
        var bcStr = bc.join(' > ');
        var fromBcStr = fromBc.join(' > ');
        var showFromBc = fromBc.length > 0 && fromBcStr !== bcStr;

        var html = '<div class="admin-diff-breadcrumb" id="' + cid + '">';
        // Line numbers
        if (lineNum && fromLineNum && fromLineNum !== lineNum) {
          html += '<span class="admin-diff-breadcrumb-line">Lines ' + fromLineNum + ' / ' + lineNum + '</span>';
        } else if (lineNum) {
          html += '<span class="admin-diff-breadcrumb-line">Line ' + lineNum + '</span>';
        }
        // "To" breadcrumb
        if (bc.length > 0) {
          if (lineNum) html += '<span class="admin-diff-breadcrumb-sep"> &mdash; </span>';
          bc.forEach(function (part, pi) {
            if (pi > 0) html += '<span class="admin-diff-breadcrumb-sep"> &rsaquo; </span>';
            html += '<span class="admin-diff-breadcrumb-part">' + escapeHtml(part) + '</span>';
          });
        }
        // Show "from" breadcrumb if it differs
        if (showFromBc) {
          html += '<div class="admin-diff-breadcrumb-from">';
          html += '<span class="admin-diff-breadcrumb-from-label">From: </span>';
          fromBc.forEach(function (part, pi) {
            if (pi > 0) html += '<span class="admin-diff-breadcrumb-sep"> &rsaquo; </span>';
            html += '<span class="admin-diff-breadcrumb-part">' + escapeHtml(part) + '</span>';
          });
          html += '</div>';
        }
        html += '</div>';
        return html;
      }

      // Helper: render an equal chunk with context collapsing
      function renderEqualChunk(chunk, idx, ci) {
        var html = '';
        var lines = chunk.text.split('\n');
        if (lines.length > 7) {
          html += '<div class="admin-diff-chunk admin-diff-chunk--equal">' + escapeHtml(lines.slice(0, 3).join('\n')) + '\n</div>';
          html += '<div class="admin-diff-context-toggle" data-expand="ctx-' + idx + '-' + ci + '">... ' + (lines.length - 6) + ' unchanged lines ...</div>';
          html += '<div class="admin-diff-chunk admin-diff-chunk--equal" id="ctx-' + idx + '-' + ci + '" style="display:none">' + escapeHtml(lines.slice(3, -3).join('\n')) + '\n</div>';
          html += '<div class="admin-diff-chunk admin-diff-chunk--equal">' + escapeHtml(lines.slice(-3).join('\n')) + '</div>';
        } else {
          html += '<div class="admin-diff-chunk admin-diff-chunk--equal">' + escapeHtml(chunk.text) + '</div>';
        }
        return html;
      }

      // Helper: render a change row (diff + clean copy with Copy button)
      function renderChangeRow(r, chunkType) {
        var html = '';
        function cleanCol(text) {
          if (!showClean) return '';
          if (!text) return '<div class="admin-diff-change-row-clean"></div>';
          return '<div class="admin-diff-change-row-clean">' +
            '<button class="admin-diff-copy-btn" title="Copy for Affinity">Copy</button>' +
            '<div class="admin-diff-clean-text">' + formatCleanText(text) + '</div></div>';
        }
        if (splitView) {
          html += '<div class="admin-diff-change-row admin-diff-change-row--split">';
          html += '<div class="admin-diff-change-row-from">' + (r.splitLeft || '') + '</div>';
          html += '<div class="admin-diff-change-row-to">' + (r.splitRight || '') + '</div>';
          html += cleanCol(r.cleanText);
          html += '</div>';
        } else {
          if (r.cleanText) {
            html += '<div class="admin-diff-change-row">';
            html += '<div class="admin-diff-change-row-diff">' + r.diffHtml + '</div>';
            html += cleanCol(r.cleanText);
            html += '</div>';
          } else if (chunkType === 'removed') {
            html += '<div class="admin-diff-change-row">';
            html += '<div class="admin-diff-change-row-diff">' + r.diffHtml + '</div>';
            if (showClean) html += '<div class="admin-diff-change-row-clean"></div>';
            html += '</div>';
          } else if (chunkType === 'added') {
            html += '<div class="admin-diff-change-row">';
            if (showClean) html += '<div class="admin-diff-change-row-diff"></div>';
            html += '<div class="admin-diff-change-row-' + (showClean ? 'clean' : 'diff') + '">' + r.diffHtml + '</div>';
            html += '</div>';
          } else {
            html += r.diffHtml;
          }
        }
        return html;
      }

      if (!merged) {
        // --- INDIVIDUAL MODE: each change is its own row ---
        file.chunks.forEach(function (chunk, ci) {
          if (chunk.type === 'equal') {
            contentHtml += renderEqualChunk(chunk, idx, ci);
          } else {
            if (textOnly && isFormattingOnly(chunk)) return; // skip formatting-only
            var cid = 'diff-change-' + changeId++;
            contentHtml += renderBreadcrumb(cid, chunk);
            sidebarEntries.push({ id: cid, fileIdx: idx, displayName: file.displayName || file.filename, breadcrumb: chunk.breadcrumb || [], type: chunk.type });
            var r = renderChunkDiff(chunk);
            contentHtml += renderChangeRow(r, chunk.type);
          }
        });
      } else {
        // --- MERGED MODE: all changes in the same heading section combined into one row ---
        // Group all chunks by heading breadcrumb — changes that share a breadcrumb merge together,
        // absorbing any equal chunks between them.
        var currentBc = null;
        var groupItems = []; // {chunk, ci, isEqual}

        function flushMergedGroup() {
          if (groupItems.length === 0) return;
          // Find first and last non-equal chunks
          var firstChange = null, lastChange = null;
          for (var gi = 0; gi < groupItems.length; gi++) {
            if (!groupItems[gi].isEqual) { if (!firstChange) firstChange = groupItems[gi]; lastChange = groupItems[gi]; }
          }
          if (!firstChange) { groupItems = []; return; }

          var cid = 'diff-change-' + changeId++;
          var lineNum = firstChange.chunk.toLine || null;
          var endLine = lastChange.chunk.toLine || null;
          var bc = firstChange.chunk.breadcrumb || [];

          contentHtml += '<div class="admin-diff-breadcrumb" id="' + cid + '">';
          if (lineNum) {
            contentHtml += '<span class="admin-diff-breadcrumb-line">Lines ' + lineNum + (endLine && endLine !== lineNum ? '\u2013' + endLine : '') + '</span>';
          }
          if (bc.length > 0) {
            if (lineNum) contentHtml += '<span class="admin-diff-breadcrumb-sep"> &mdash; </span>';
            bc.forEach(function (part, pi) {
              if (pi > 0) contentHtml += '<span class="admin-diff-breadcrumb-sep"> &rsaquo; </span>';
              contentHtml += '<span class="admin-diff-breadcrumb-part">' + escapeHtml(part) + '</span>';
            });
          }
          contentHtml += '</div>';

          sidebarEntries.push({ id: cid, fileIdx: idx, displayName: file.displayName || file.filename, breadcrumb: bc, type: firstChange.chunk.type });

          var combinedDiffHtml = '';
          var combinedCleanText = '';
          var combinedSplitLeft = '';
          var combinedSplitRight = '';
          groupItems.forEach(function (g) {
            if (g.isEqual) {
              var eqHtml = '<div class="admin-diff-chunk admin-diff-chunk--equal">' + escapeHtml(g.chunk.text) + '</div>';
              combinedDiffHtml += eqHtml;
              combinedSplitLeft += eqHtml;
              combinedSplitRight += eqHtml;
              combinedCleanText += g.chunk.text;
            } else {
              var r = renderChunkDiff(g.chunk);
              combinedDiffHtml += r.diffHtml;
              combinedSplitLeft += r.splitLeft || '';
              combinedSplitRight += r.splitRight || '';
              if (r.cleanText) combinedCleanText += r.cleanText;
            }
          });
          contentHtml += renderChangeRow({ diffHtml: combinedDiffHtml, splitLeft: combinedSplitLeft, splitRight: combinedSplitRight, cleanText: combinedCleanText });
          groupItems = [];
        }

        file.chunks.forEach(function (chunk, ci) {
          if (chunk.type === 'equal') {
            groupItems.push({ chunk: chunk, ci: ci, isEqual: true });
          } else {
            if (textOnly && isFormattingOnly(chunk)) return; // skip formatting-only
            var bc = (chunk.breadcrumb || []).join(' > ');
            if (currentBc !== null && bc !== currentBc) {
              // Heading changed — flush previous group, but don't include trailing equal chunks
              // Pull trailing equal chunks out of the group before flushing
              var trailingEqual = [];
              while (groupItems.length > 0 && groupItems[groupItems.length - 1].isEqual) {
                trailingEqual.unshift(groupItems.pop());
              }
              flushMergedGroup();
              // Render the trailing equal chunks normally
              trailingEqual.forEach(function (g) {
                contentHtml += renderEqualChunk(g.chunk, idx, g.ci);
              });
            }
            currentBc = bc;
            groupItems.push({ chunk: chunk, ci: ci, isEqual: false });
          }
        });
        // Flush any remaining group (strip trailing equal chunks)
        while (groupItems.length > 0 && groupItems[groupItems.length - 1].isEqual) {
          var trailing = groupItems.pop();
          contentHtml += renderEqualChunk(trailing.chunk, idx, trailing.ci);
        }
        flushMergedGroup();
      }

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

    // Restore scroll position after re-render (toggle clicks)
    requestAnimationFrame(function () { window.scrollTo(0, savedScrollTop); });

    // Bind mode toggle (Individual / Merged)
    diffOutput.querySelectorAll('[data-diff-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var mode = btn.getAttribute('data-diff-mode');
        diffMergedMode = mode === 'merged';
        if (lastDiffReport) renderDiffReport(lastDiffReport, diffMergedMode, diffTextOnly, diffSplitView, diffShowClean);
      });
    });

    // Bind view toggle (Single / Split)
    diffOutput.querySelectorAll('[data-diff-view]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        diffSplitView = btn.getAttribute('data-diff-view') === 'split';
        if (lastDiffReport) renderDiffReport(lastDiffReport, diffMergedMode, diffTextOnly, diffSplitView, diffShowClean);
      });
    });

    // Bind filter toggle (All Changes / Text Only)
    diffOutput.querySelectorAll('[data-diff-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        diffTextOnly = btn.getAttribute('data-diff-filter') === 'text';
        if (lastDiffReport) renderDiffReport(lastDiffReport, diffMergedMode, diffTextOnly, diffSplitView, diffShowClean);
      });
    });

    // Bind clean copy toggle (On / Off)
    diffOutput.querySelectorAll('[data-diff-clean]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        diffShowClean = btn.getAttribute('data-diff-clean') === 'on';
        if (lastDiffReport) renderDiffReport(lastDiffReport, diffMergedMode, diffTextOnly, diffSplitView, diffShowClean);
      });
    });

    // Bind toggle listeners for collapsible file sections
    diffOutput.querySelectorAll('[data-diff-toggle]').forEach(function (header) {
      header.addEventListener('click', function () {
        var body = document.getElementById('diff-body-' + header.getAttribute('data-diff-toggle'));
        if (body) body.classList.toggle('admin-diff-file-body--collapsed');
      });
    });

    // Copy for Affinity buttons — copy formatted HTML, then trigger RTF conversion Shortcut
    diffOutput.querySelectorAll('.admin-diff-copy-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cleanEl = btn.parentElement.querySelector('.admin-diff-clean-text');
        if (!cleanEl) return;

        function onCopied() {
          btn.textContent = 'Copied';
          btn.classList.add('admin-diff-copy-btn--done');
          // After clipboard write settles, trigger macOS Shortcut to convert HTML→RTF
          setTimeout(triggerRTFConversion, 300);
          setTimeout(function () { btn.textContent = 'Copy'; btn.classList.remove('admin-diff-copy-btn--done'); }, 2500);
        }

        function triggerRTFConversion() {
          try {
            var a = document.createElement('a');
            a.href = 'shortcuts://run-shortcut?name=ClipboardToRTF';
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            setTimeout(function () { a.remove(); }, 1000);
          } catch (e) { /* Shortcut not installed — clipboard still has HTML */ }
        }

        // Method 1: Clipboard API with HTML blob
        if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
          var html = cleanEl.innerHTML;
          navigator.clipboard.write([
            new ClipboardItem({
              'text/html': new Blob([html], { type: 'text/html' }),
              'text/plain': new Blob([cleanEl.textContent], { type: 'text/plain' })
            })
          ]).then(onCopied).catch(fallbackCopy);
        } else {
          fallbackCopy();
        }

        // Method 2: Select the element and execCommand('copy') — works in Safari
        function fallbackCopy() {
          var range = document.createRange();
          range.selectNodeContents(cleanEl);
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          try {
            document.execCommand('copy');
            onCopied();
          } catch (e) {
            btn.textContent = 'Failed';
            setTimeout(function () { btn.textContent = 'Copy'; }, 2000);
          }
          sel.removeAllRanges();
        }
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

  // --- Bible Validation tab ---
  (function initBibleValidation() {
    var panel = document.getElementById('panel-bible-validation');
    if (!panel) return;

    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    // ── Sub-tab switching (Compare / Quotation Audit / Version & History) ──
    var versionHistoryLoaded = false;
    panel.querySelectorAll('[data-bv-sub]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        panel.querySelectorAll('.bv-subtab').forEach(function (b) { b.classList.remove('bv-subtab--active'); });
        panel.querySelectorAll('.bv-sub').forEach(function (s) { s.classList.add('bv-sub--hidden'); });
        btn.classList.add('bv-subtab--active');
        var sub = btn.getAttribute('data-bv-sub');
        var el = document.getElementById('bv-sub-' + sub);
        if (el) el.classList.remove('bv-sub--hidden');
        if (sub === 'version' && !versionHistoryLoaded) { versionHistoryLoaded = true; loadHistory(); }
        if (sub === 'version') { loadFreshness(); loadSyncLog(); }
      });
    });

    // Re-check publisher freshness whenever the Bible Validation tab is opened (and on load
    // if it's already the active panel).
    var bvMainTab = document.querySelector('[data-admin-tab="bible-validation"]');
    if (bvMainTab) bvMainTab.addEventListener('click', loadFreshness);
    if (!panel.classList.contains('admin-panel--hidden')) loadFreshness();

    // ── Compare to BSB (streaming, live checklist) ──
    var compareBtn = document.getElementById('bv-compare-btn');
    var checklistEl = document.getElementById('bv-checklist');
    var compareOut = document.getElementById('bv-compare-output');
    var changesById = {};
    var STEP_ORDER = ['download-verses', 'download-usfm', 'load-ours', 'compare', 'reader', 'structure', 'library'];
    var STEP_LABELS = {
      'download-verses': 'Download official verse text from bereanbible.com',
      'download-usfm': 'Download official structure (headings + footnotes)',
      'load-ours': 'Load our stored copy',
      'compare': 'Compare every book, verse by verse (BSB site → repo)',
      'reader': 'Compare every book, verse by verse (repo → web reader)',
      'structure': 'Check section headings & footnotes',
      'library': 'Scan the library for affected quotations'
    };

    function renderChecklist(steps, books) {
      var rows = STEP_ORDER.map(function (k) {
        var s = steps[k];
        var icon = !s ? '<span class="bv-ck bv-ck--pending">○</span>'
          : s.status === 'done' ? '<span class="bv-ck bv-ck--done">✓</span>'
            : '<span class="bv-ck bv-ck--run">◐</span>';
        var detail = s && s.detail ? ' <span class="text-muted">— ' + esc(s.detail) + '</span>' : '';
        var rowCls = !s ? 'bv-step bv-step--pending' : s.status === 'done' ? 'bv-step bv-step--done' : 'bv-step bv-step--run';
        return '<div class="' + rowCls + '">' + icon + '<span>' + esc(STEP_LABELS[k] || k) + detail + '</span></div>';
      }).join('');
      var grid = '';
      if (books.length) {
        grid = '<div class="bv-books">' + books.map(function (b) {
          var diff = (b.changed || 0) + (b.missing || 0);
          return '<span class="bv-book ' + (diff ? 'bv-book--diff' : 'bv-book--ok') + '" title="' + esc(b.name) + ' — ' + b.verses + ' verses, ' + (b.changed || 0) + ' changed">'
            + esc(b.name) + (diff ? ' <span class="bv-book-diff">' + diff + '</span>' : ' ✓') + '</span>';
        }).join('') + '</div>';
      }
      checklistEl.innerHTML = '<div class="admin-card bv-checklist-card">' + rows + grid + '</div>';
    }

    function tile(label, value, tone) {
      return '<div class="bv-tile bv-tile--' + (tone || 'neutral') + '"><div class="bv-tile-num">' + esc(value) + '</div><div class="bv-tile-label">' + esc(label) + '</div></div>';
    }

    // Word-level inline diff → { oldHtml, newHtml } with only the changed words
    // wrapped in <mark>. Whitespace is kept so text reflows naturally.
    function inlineDiff(oldText, newText) {
      var a = String(oldText == null ? '' : oldText).split(/(\s+)/);
      var b = String(newText == null ? '' : newText).split(/(\s+)/);
      var n = a.length, m = b.length, i, j;
      var dp = []; for (i = 0; i <= n; i++) { dp[i] = []; for (j = 0; j <= m; j++) dp[i][j] = 0; }
      for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--)
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      var aMark = [], bMark = []; i = 0; j = 0;
      while (i < n && j < m) {
        if (a[i] === b[j]) { aMark.push(false); bMark.push(false); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) { aMark.push(true); i++; }
        else { bMark.push(true); j++; }
      }
      while (i < n) { aMark.push(true); i++; }
      while (j < m) { bMark.push(true); j++; }
      function build(tokens, marks) {
        var out = '', run = '';
        for (var k = 0; k < tokens.length; k++) {
          if (marks[k]) { run += tokens[k]; }
          else { if (run) { out += '<mark>' + esc(run) + '</mark>'; run = ''; } out += esc(tokens[k]); }
        }
        if (run) out += '<mark>' + esc(run) + '</mark>';
        return out;
      }
      return { oldHtml: build(a, aMark), newHtml: build(b, bMark) };
    }

    // Two labelled, highlighted lines: Current (ours) vs BSB Site (official).
    function diffPair(oldText, newText) {
      var d = inlineDiff(oldText, newText);
      return '<div class="bv-diff-line"><span class="bv-side">Current</span> ' + d.oldHtml + '</div>'
        + '<div class="bv-diff-line"><span class="bv-side bv-side--new">BSB&nbsp;Site</span> ' + d.newHtml + '</div>';
    }

    // Popup showing the whole chapter a diff comes from, with the verse
    // highlighted — reuses the public /api/verses endpoint (same data the
    // on-site verse-citation popup uses).
    function openChapterPopup(ref, note) {
      var m = String(ref).match(/^(.+?)\s+(\d+)(?::(\d+))?/);
      if (!m) return;
      var book = m[1], chapter = m[2], target = m[3] ? parseInt(m[3], 10) : -1;
      var overlay = document.getElementById('bv-ctx-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'bv-ctx-overlay';
        overlay.className = 'bv-ctx-overlay';
        overlay.innerHTML = '<div class="bv-ctx-modal"><div class="bv-ctx-head"><h3 class="bv-ctx-title"></h3><button class="bv-ctx-close" aria-label="Close">&times;</button></div><div class="bv-ctx-body"></div></div>';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', function (e) { if (e.target === overlay || e.target.classList.contains('bv-ctx-close')) overlay.style.display = 'none'; });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') overlay.style.display = 'none'; });
      }
      overlay.querySelector('.bv-ctx-title').textContent = book + ' ' + chapter;
      var body = overlay.querySelector('.bv-ctx-body');
      body.innerHTML = '<p class="text-muted">Loading…</p>';
      overlay.style.display = 'flex';
      apiCall('GET', '/api/verses?translation=bsb&ref=' + encodeURIComponent(book + ' ' + chapter + ':1-200'))
        .then(function (d) {
          var html = (d.verses || []).map(function (vv) {
            if (vv.gap) return '';
            var head = vv.sectionHeading ? '<div class="bv-ctx-heading">' + esc(vv.sectionHeading) + '</div>' : '';
            var cls = vv.verse === target ? 'bv-ctx-verse bv-ctx-verse--hl' : 'bv-ctx-verse';
            // Show the diff's heading/footnote/cross-ref inline at the verse it applies to.
            var noteHtml = (note && note.text && vv.verse === target)
              ? '<div class="bv-ctx-note"><span class="bv-ctx-note-kind">' + esc(note.kind || 'Note') + '</span> ' + esc(note.text) + '</div>' : '';
            return head + '<p class="' + cls + '"><sup>' + esc(vv.verse) + '</sup> ' + esc(vv.text) + '</p>' + noteHtml;
          }).join('');
          body.innerHTML = html || '<p class="text-muted">No text found.</p>';
          if (note && note.text && target < 0) {
            body.innerHTML += '<div class="bv-ctx-note"><span class="bv-ctx-note-kind">' + esc(note.kind || 'Note') + '</span> ' + esc(note.text) + '</div>';
          }
          var hl = body.querySelector('.bv-ctx-verse--hl'); if (hl) hl.scrollIntoView({ block: 'center' });
        })
        .catch(function (e) { body.innerHTML = '<p class="admin-error">' + esc(e.message) + '</p>'; });
    }

    function changeCard(c) {
      var loc = c.type === 'verse-store'
        ? 'Verse text &mdash; <strong>' + esc(c.ref) + '</strong>'
        : 'Quotation of <strong>' + esc(c.ref) + '</strong> in <code>' + esc(c.file) + '</code>';
      return '<div class="admin-card bv-change" data-change-id="' + esc(c.id) + '">'
        + '<div class="bv-change-loc">' + loc + ' <a href="#" class="bv-context" data-ctx-ref="' + esc(c.ref) + '">See context</a></div>'
        + diffPair(c.oldText, c.newText)
        + '<div class="bv-change-actions"><button class="admin-btn admin-btn--primary admin-btn--sm bv-accept">Accept</button> '
        + '<button class="admin-btn admin-btn--sm bv-reject">Reject</button><span class="bv-change-status text-muted"></span></div></div>';
    }

    // Word-overlap similarity (0..1) — used to pair a reworded heading/footnote
    // with its counterpart even when their verse refs differ.
    function wordSim(a, b) {
      var aw = String(a).toLowerCase().split(/\s+/).filter(Boolean);
      var bw = String(b).toLowerCase().split(/\s+/).filter(Boolean);
      if (!aw.length || !bw.length) return 0;
      var cnt = {}; bw.forEach(function (w) { cnt[w] = (cnt[w] || 0) + 1; });
      var shared = 0; aw.forEach(function (w) { if (cnt[w] > 0) { shared++; cnt[w]--; } });
      return shared / Math.max(aw.length, bw.length);
    }
    function ctxLink(bookName, ref, noteKind, noteText) {
      var attrs = ' data-ctx-ref="' + esc(bookName + ' ' + ref) + '"';
      // Carry the diff's heading/footnote/cross-ref text so the scripture popup can show
      // it in place at the verse it applies to (we have no footnote viewer otherwise).
      if (noteText) attrs += ' data-ctx-note-kind="' + esc(noteKind || 'Note') + '" data-ctx-note="' + esc(noteText) + '"';
      return '<a href="#" class="bv-context"' + attrs + '>View context</a>';
    }
    var structSeq = 0;

    // Render heading/footnote differences for one book. Items are { text, ref }.
    // A reworded item (best word-similarity match on the other side) is shown as
    // ONE row: location + Current + BSB Site, highlighted — with Accept for
    // headings. Unmatched items are listed as present on only one side.
    function structRows(bookName, bookCode, translationId, label, ours, official) {
      ours = (ours || []).slice(); official = (official || []).slice();
      if (!ours.length && !official.length) return '';
      var isHeading = label === 'Heading';
      var isCrossRef = label === 'Cross-reference';
      var changeType = isHeading ? 'usfm-heading' : isCrossRef ? 'usfm-crossref' : 'usfm-footnote';
      var loc = function (ref, noteKind, noteText) { return '<span class="bv-loc">' + esc(bookName + ' ' + ref) + '</span> ' + ctxLink(bookName, ref, noteKind, noteText); };
      var rows = [], usedOff = {};

      ours.forEach(function (o) {
        var best = -1, bestScore = 0;
        for (var i = 0; i < official.length; i++) {
          if (usedOff[i]) continue;
          // Prefer a match at the same verse (big bonus), then word similarity.
          var sc = wordSim(o.text, official[i].text) + (official[i].ref === o.ref ? 1 : 0);
          if (sc > bestScore) { bestScore = sc; best = i; }
        }
        var paired = best >= 0 && (official[best].ref === o.ref || wordSim(o.text, official[best].text) >= 0.4);
        if (paired) {
          usedOff[best] = true;
          var sameRef = official[best].ref === o.ref;
          // The apply matches OUR footnote by our own ref + text, so it's safe as
          // long as the PAIRING is confident. Offer Accept for headings, same-verse
          // pairs, or high word-similarity pairs (e.g. superscription footnotes our
          // copy and the official put at slightly different verse numbers).
          var canAccept = isHeading || isCrossRef || sameRef || wordSim(o.text, official[best].text) >= 0.6;
          var actions = '', idAttr = '';
          if (canAccept) {
            var type = changeType;
            var id = type + ':' + bookCode + ':' + o.ref + ':' + (structSeq++);
            // newText = the official RAW form (real dashes/quotes preserved); oldText
            // stays normalized so the apply's ref+normalized match still finds our span.
            changesById[id] = { id: id, type: type, translationId: translationId, bookCode: bookCode, ref: o.ref, oldText: o.text, newText: (official[best].raw || official[best].text) };
            idAttr = ' data-change-id="' + esc(id) + '"';
            actions = '<div class="bv-change-actions"><button class="admin-btn admin-btn--primary admin-btn--sm bv-accept">Accept</button> '
              + '<button class="admin-btn admin-btn--sm bv-reject">Reject</button><span class="bv-change-status text-muted"></span></div>';
          }
          rows.push('<div class="admin-card bv-change bv-struct-card"' + idAttr + '><div class="bv-change-loc">' + loc(o.ref, label, official[best].raw || official[best].text) + '</div>'
            + diffPair(o.text, official[best].text) + actions + '</div>');
        } else {
          // Present only in our copy → Accept DELETES it so we match the BSB (which has none here).
          rows.push(unpairedCard(bookName, bookCode, translationId, changeType, label, o.ref, o.raw || o.text, '', o.text, ''));
        }
      });
      official.forEach(function (f, i) {
        if (usedOff[i]) return;
        // Present only on the BSB site → Accept ADDS it to our copy. For footnotes we also
        // pass the anchor (the BSB's words before the caller) so it lands at the exact spot.
        rows.push(unpairedCard(bookName, bookCode, translationId, changeType, label, f.ref, '', f.raw || f.text, '', f.raw || f.text, f.anchor));
      });
      return rows.join('');
    }

    // A one-sided (add/delete) structure difference rendered like the paired cards —
    // Current + BSB Site columns with "[none]" for the empty side — plus Accept/Reject.
    // Accept applies { oldText, newText } where one side is '' (empty = add or delete).
    function unpairedCard(bookName, bookCode, translationId, changeType, label, ref, curText, bsbText, oldText, newText, anchor) {
      var loc = '<span class="bv-loc">' + esc(bookName + ' ' + ref) + '</span> ' + ctxLink(bookName, ref, label, bsbText || curText);
      var id = changeType + ':' + bookCode + ':' + ref + ':' + (structSeq++);
      var change = { id: id, type: changeType, translationId: translationId, bookCode: bookCode, ref: ref, oldText: oldText, newText: newText };
      if (anchor) change.anchor = anchor;
      changesById[id] = change;
      var none = '<span class="text-muted">[none]</span>';
      return '<div class="admin-card bv-change bv-struct-card" data-change-id="' + esc(id) + '"><div class="bv-change-loc">' + loc + '</div>'
        + '<div class="bv-diff-line"><span class="bv-side">Current</span> ' + (curText ? esc(curText) : none) + '</div>'
        + '<div class="bv-diff-line"><span class="bv-side bv-side--new">BSB&nbsp;Site</span> ' + (bsbText ? esc(bsbText) : none) + '</div>'
        + '<div class="bv-change-actions"><button class="admin-btn admin-btn--primary admin-btn--sm bv-accept">Accept</button> '
        + '<button class="admin-btn admin-btn--sm bv-reject">Reject</button><span class="bv-change-status text-muted"></span></div></div>';
    }

    // Count accepted (applyable) changes of a given type currently in the registry.
    function countByType(t) {
      return Object.keys(changesById).filter(function (k) { return changesById[k].type === t; }).length;
    }
    // A per-type refresh button — enabled only when there are applyable changes.
    function refreshBtn(refreshType, refreshLabel) {
      var n = countByType(refreshType);
      return '<div class="bv-refresh"><button class="admin-btn admin-btn--primary admin-btn--sm bv-refresh-type" data-refresh-type="' + esc(refreshType) + '"' + (n ? '' : ' disabled') + '>' + esc(refreshLabel) + '</button> <span class="bv-refresh-status text-muted"></span></div>';
    }
    // A collapsible results section: title + count + its own refresh button + body.
    function bvSection(title, countLabel, open, refreshType, refreshLabel, bodyHtml) {
      return '<details class="bv-section"' + (open ? ' open' : '') + '><summary><strong>' + esc(title) + '</strong> <span class="bv-count">' + esc(countLabel) + '</span></summary>'
        + refreshBtn(refreshType, refreshLabel) + bodyHtml + '</details>';
    }
    // One structure section (heading | footnote | cross-reference), grouped by book.
    function structSection(r, label, field, refreshType, refreshLabel, bookCount) {
      var sBooks = (r.structure.books || []).filter(function (b) { var f = b[field] || {}; return (f.onlyInOurs && f.onlyInOurs.length) || (f.onlyInOfficial && f.onlyInOfficial.length); });
      var body = sBooks.map(function (b) {
        var bn = b.bookName || b.book, f = b[field] || { onlyInOurs: [], onlyInOfficial: [] };
        return '<div class="bv-struct-book"><div class="bv-struct-title">' + esc(bn) + '</div>'
          + structRows(bn, b.code, r.translationId, label, f.onlyInOurs, f.onlyInOfficial) + '</div>';
      }).join('') || '<p class="text-muted">No differences.</p>';
      var diffCount = (body.match(/bv-struct-card/g) || []).length; // one card per difference
      var countLabel = bookCount + ' book' + (bookCount === 1 ? '' : 's') + ', ' + diffCount + ' difference' + (diffCount === 1 ? '' : 's');
      return bvSection(label + ' differences', countLabel, bookCount > 0, refreshType, refreshLabel, body);
    }

    // Summary tiles for verse-text leg 2: repo → what the web reader renders.
    function readerGroup(rd) {
      rd = rd || { error: 'not run' };
      if (rd.error) {
        return '<div class="bv-group-label">Verse text: repo &rarr; web reader</div>'
          + '<p class="text-muted bv-math">Reader fidelity check unavailable: ' + esc(rd.error) + '</p>';
      }
      var bad = (rd.mismatched || 0) + (rd.missing || 0);
      return '<div class="bv-group-label">Verse text: repo &rarr; web reader &mdash; what the browser actually renders</div>'
        + '<div class="bv-tiles">'
        + tile('Identical', Number(rd.matched || 0).toLocaleString(), bad ? 'warn' : 'ok')
        + tile('Differs', rd.mismatched || 0, rd.mismatched ? 'err' : 'ok')
        + tile('Missing', rd.missing || 0, rd.missing ? 'err' : 'ok')
        + '</div>'
        + '<p class="text-muted bv-math">' + (bad
            ? 'The web reader serves a committed parsed snapshot (<code>.bible-cache</code>). <strong>' + bad + '</strong> verse(s) differ from the repo — it auto-rebuilds after an Accept and nightly; see the section below.'
            : 'The web reader serves exactly what is in the repo — the parsed snapshot is current.')
        + '</p>';
    }

    // Results section for verse-text leg 2 (repo → web reader). No refresh button — this
    // is a cache rebuild (automatic), not a BSB sync.
    function readerSection(rd) {
      rd = rd || {};
      var bad = (rd.mismatched || 0) + (rd.missing || 0);
      var body;
      if (rd.error) body = '<p class="text-muted">Reader check unavailable: ' + esc(rd.error) + '</p>';
      else if (!bad) body = '<p class="text-muted">The web reader serves exactly what is in the repo — nothing to sync.</p>';
      else {
        var samples = (rd.samples || []).map(function (s) {
          return '<div class="admin-card bv-change bv-struct-card"><div class="bv-change-loc"><span class="bv-loc">' + esc(s.ref) + '</span> <span class="text-muted">(' + esc(s.kind) + ')</span></div>'
            + '<div class="bv-diff-line"><span class="bv-side">Repo</span> ' + esc(s.repo || '') + '</div>'
            + '<div class="bv-diff-line"><span class="bv-side bv-side--new">Web&nbsp;reader</span> ' + esc(s.reader == null ? '(missing)' : s.reader) + '</div></div>';
        }).join('');
        body = '<p class="text-muted">The web reader serves a committed parsed snapshot (<code>.bible-cache</code>) that is behind the repo. It rebuilds automatically after an Accept and nightly, so this clears on its own. Showing up to ' + (rd.samples || []).length + ' example(s):</p>' + samples;
      }
      return '<details class="bv-section"' + (bad ? ' open' : '') + '><summary><strong>Verse text (repo &rarr; web reader)</strong> <span class="bv-count">' + bad + ' difference' + (bad === 1 ? '' : 's') + '</span></summary>' + body + '</details>';
    }

    function renderCompareResult(r) {
      changesById = {};
      var ch = r.changes || { verseChanges: [], libraryChanges: [], citationReview: [] };
      (ch.verseChanges || []).concat(ch.libraryChanges || []).forEach(function (c) { changesById[c.id] = c; });
      var v = r.verse, st = r.structure.totals;
      var structDiffs = st.booksWithHeadingDiffs + st.booksWithFootnoteDiffs + (st.booksWithCrossRefDiffs || 0) + st.missingBooks + st.extraBooks;
      var readerBad = (r.reader && !r.reader.error) ? ((r.reader.mismatched || 0) + (r.reader.missing || 0)) : 0;
      var clean = v.changed === 0 && v.missing === 0 && v.extra === 0 && structDiffs === 0 && readerBad === 0;

      var hdgBooks = st.booksWithHeadingDiffs || 0, ftBooks = st.booksWithFootnoteDiffs || 0, crBooks = st.booksWithCrossRefDiffs || 0;
      var structBooksDiff = st.booksChecked - st.booksMatched; // books differing in headings, footnotes and/or cross-references
      var html = '<div class="admin-card">'
        + '<div class="bv-result-head">'
        + (clean ? '<span class="admin-badge admin-badge--ok">Up to date</span>' : '<span class="admin-badge admin-badge--warn">Differences found</span>')
        + ' <span class="text-muted">source updated ' + esc((r.upstream && r.upstream.lastModified) || 'unknown') + ' · checked in ' + esc(r.durationMs) + ' ms</span></div>'
        // Verse text, leg 1: BSB site → repo
        + '<div class="bv-group-label">Verse text: BSB site &rarr; repo &mdash; ' + Number(v.total).toLocaleString() + ' verses</div>'
        + '<div class="bv-tiles">'
        + tile('Identical', Number(v.matched).toLocaleString(), 'ok')
        + tile('Changed', v.changed, v.changed ? 'warn' : 'ok')
        + tile('Missing', v.missing, v.missing ? 'err' : 'ok')
        + tile('Extra', v.extra, v.extra ? 'err' : 'ok')
        + '</div>'
        // Verse text, leg 2: repo → web reader (shown right next to leg 1)
        + readerGroup(r.reader)
        // Structure (headings + footnotes) — a separate axis, measured per book
        + '<div class="bv-group-label">Structure &mdash; ' + st.booksChecked + ' books (headings, footnotes &amp; cross-references)</div>'
        + '<div class="bv-tiles">'
        + tile('Books identical', st.booksMatched + '/' + st.booksChecked, structBooksDiff ? 'warn' : 'ok')
        + tile('Books w/ heading diffs', hdgBooks, hdgBooks ? 'warn' : 'ok')
        + tile('Books w/ footnote diffs', ftBooks, ftBooks ? 'warn' : 'ok')
        + tile('Books w/ cross-ref diffs', crBooks, crBooks ? 'warn' : 'ok')
        + '</div>'
        + '<p class="text-muted bv-math">' + (clean
          ? 'Our copy matches the current published BSB exactly.'
          : 'The <strong>' + v.changed + '</strong> verse change(s) and the <strong>' + structBooksDiff + '</strong> book(s) with heading/footnote/cross-reference differences are independent — a book counts as “identical” only when its headings, footnotes and cross-references all match, regardless of verse changes. Each type has its own section and refresh button below.')
        + '</p>';
      html += '</div>';

      if (!clean) {
        // Each difference type is its own collapsible section with its own refresh button.
        var vChanges = ch.verseChanges || [];
        var vBody = vChanges.length
          ? '<p class="text-muted">Accept to update our copy to the current BSB (one commit each). Reject to keep ours.</p>' + vChanges.map(changeCard).join('')
          : '<p class="text-muted">No verse-text differences.</p>';
        // The two verse-text legs sit next to each other: BSB site → repo, then repo → reader.
        html += bvSection('Verse text (BSB site → repo)', (v.changed || 0) + ' difference' + (v.changed === 1 ? '' : 's'), v.changed > 0, 'verse-store', 'Refresh all verses', vBody);
        html += readerSection(r.reader);

        html += structSection(r, 'Heading', 'headings', 'usfm-heading', 'Refresh all headings', hdgBooks);
        html += structSection(r, 'Footnote', 'footnotes', 'usfm-footnote', 'Refresh all footnotes', ftBooks);
        html += structSection(r, 'Cross-reference', 'crossRefs', 'usfm-crossref', 'Refresh all cross-references', crBooks);

        // Library quotations are reviewed individually (no batch refresh).
        var libChanges = ch.libraryChanges || [];
        if (libChanges.length) {
          html += '<details class="bv-section"><summary><strong>Affected library quotations</strong> <span class="bv-count">' + libChanges.length + '</span></summary>'
            + '<p class="text-muted">Places in our books that quote the old wording — reviewed individually.</p>'
            + libChanges.map(changeCard).join('') + '</details>';
        }
      }

      compareOut.innerHTML = html;
    }

    if (compareBtn) {
      // Minimum time each step visibly stays in the active "hover" state before
      // it checks off — so the setup steps feel deliberate/systematic even though
      // the server does them fast (and concurrently).
      var STEP_MIN_MS = {
        'download-verses': 3000, 'download-usfm': 3000, 'load-ours': 3000,
        'compare': 1000, 'structure': 1200, 'library': 1000, 'reader': 1000,
      };

      compareBtn.addEventListener('click', function () {
        var translationId = 'bsb';
        var origLabel = compareBtn.textContent;
        compareBtn.disabled = true;
        compareBtn.textContent = 'Comparing…';
        compareOut.innerHTML = '';

        // Server state (arrives whenever it arrives) is decoupled from the UI,
        // which is driven sequentially below.
        var srvStatus = {}, srvDetail = {}, bookQueue = [];
        var resultEvt = null, streamDone = false, failed = false;
        var uiSteps = {}, books = [];
        renderChecklist(uiSteps, books);

        function finish() { compareBtn.disabled = false; compareBtn.textContent = origLabel; }

        var es = new EventSource('/api/admin/bible-compare/stream?translationId=' + encodeURIComponent(translationId));
        es.onmessage = function (ev) {
          var e; try { e = JSON.parse(ev.data); } catch (_) { return; }
          if (e.type === 'step') { srvStatus[e.key] = e.status; if (e.detail) srvDetail[e.key] = e.detail; }
          else if (e.type === 'book') { bookQueue.push(e); }
          else if (e.type === 'result') { resultEvt = e; }
          else if (e.type === 'done') { streamDone = true; es.close(); }
          else if (e.type === 'error') { failed = true; streamDone = true; es.close(); compareOut.innerHTML = '<p class="admin-error">' + esc(e.error) + '</p>'; }
        };
        es.onerror = function () { es.close(); if (!resultEvt && !failed) { failed = true; streamDone = true; if (!compareOut.innerHTML) compareOut.innerHTML = '<p class="admin-error">Connection interrupted — please try again.</p>'; } };

        // Sequential UI driver: activate one step (hover) at a time; hold it for
        // at least STEP_MIN_MS AND until the server finished it; tick books during
        // the compare step; then check it off and advance.
        var idx = 0, stepStart = null, bookTimer = null;
        var driver = setInterval(function () {
          if (failed) { clearInterval(driver); if (bookTimer) { clearInterval(bookTimer); bookTimer = null; } finish(); return; }
          if (idx >= STEP_ORDER.length) {
            clearInterval(driver);
            if (resultEvt) renderCompareResult(resultEvt.result);
            finish();
            return;
          }
          var key = STEP_ORDER[idx];
          if (stepStart === null) {
            stepStart = Date.now();
            uiSteps[key] = { status: 'running', detail: srvDetail[key] };
            renderChecklist(uiSteps, books);
            if (key === 'compare' && !bookTimer) {
              bookTimer = setInterval(function () {
                if (bookQueue.length) { books.push(bookQueue.shift()); renderChecklist(uiSteps, books); }
              }, 24);
            }
          }
          if (uiSteps[key].detail !== srvDetail[key]) { uiSteps[key].detail = srvDetail[key]; renderChecklist(uiSteps, books); }

          var serverFinished = srvStatus[key] === 'done' || streamDone;
          var booksDrained = key !== 'compare' || bookQueue.length === 0;
          if (serverFinished && booksDrained && Date.now() - stepStart >= (STEP_MIN_MS[key] || 800)) {
            uiSteps[key] = { status: 'done', detail: srvDetail[key] };
            renderChecklist(uiSteps, books);
            if (key === 'compare' && bookTimer) { clearInterval(bookTimer); bookTimer = null; }
            idx++; stepStart = null;
          }
        }, 100);
      });

      // "See context" popup + per-type "Refresh all …" buttons.
      compareOut.addEventListener('click', function (e) {
        if (e.target.classList.contains('bv-context')) { e.preventDefault(); openChapterPopup(e.target.getAttribute('data-ctx-ref'), { kind: e.target.getAttribute('data-ctx-note-kind'), text: e.target.getAttribute('data-ctx-note') }); return; }
        if (e.target.classList.contains('bv-refresh-type')) {
          var btn = e.target, rtype = btn.getAttribute('data-refresh-type');
          var nouns = { 'verse-store': 'verse', 'usfm-heading': 'heading', 'usfm-footnote': 'footnote', 'usfm-crossref': 'cross-reference' };
          var noun = nouns[rtype] || 'change';
          var applicable = Object.keys(changesById).map(function (k) { return changesById[k]; })
            .filter(function (c) { return c.type === rtype; });
          if (!applicable.length) return;
          if (!window.confirm('Apply ' + applicable.length + ' ' + noun + ' update(s) to our Bible copy to match the BSB site? This commits to the content repository.')) return;
          var status = btn.parentElement.querySelector('.bv-refresh-status');
          btn.disabled = true; status.textContent = ' applying…';
          apiCall('POST', '/api/admin/bible-apply-batch', { changes: applicable })
            .then(function (r) {
              status.textContent = ' applied ' + r.applied + ' change(s) in ' + r.commits + ' commit(s) — re-checking…';
              setTimeout(function () { document.getElementById('bv-compare-btn').click(); }, 1800);
            })
            .catch(function (err) { btn.disabled = false; status.innerHTML = ' <span class="admin-error">' + esc(err.message) + '</span>'; });
        }
      });

      // Accept / Reject a single change.
      compareOut.addEventListener('click', function (e) {
        var card = e.target.closest('.bv-change'); if (!card) return;
        var statusEl = card.querySelector('.bv-change-status');
        if (e.target.classList.contains('bv-reject')) {
          card.classList.add('bv-change--done');
          card.querySelector('.bv-change-actions').innerHTML = '<span class="text-muted">Rejected</span>';
          return;
        }
        if (e.target.classList.contains('bv-accept')) {
          var change = changesById[card.getAttribute('data-change-id')]; if (!change) return;
          card.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
          statusEl.textContent = ' applying…';
          apiCall('POST', '/api/admin/bible-validation/apply-change', { change: change })
            .then(function (r) {
              card.classList.add('bv-change--done');
              card.querySelector('.bv-change-actions').innerHTML = '<span class="admin-badge admin-badge--ok">Applied</span> <span class="text-muted">' + esc((r.sha || '').slice(0, 7)) + '</span>';
            })
            .catch(function (err) {
              card.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
              statusEl.innerHTML = ' <span class="admin-error">' + esc(err.message) + '</span>';
            });
        }
      });
    }

    // ── Version & History ──
    var historyEl = document.getElementById('bv-history');

    // Is the publisher's BSB newer than what we last compared against? We don't track a
    // discrete "version" (edits land one accept at a time), so this is the honest signal:
    // a green check if bereanbible.com hasn't changed since your last compare, a yellow
    // warning if it has. Rendered into both the Compare banner and the Version tab.
    function freshnessHtml(d) {
      var live = d.live || {}, last = d.lastRun || null;
      var when = last && last.at ? new Date(last.at).toLocaleString() : null;
      if (d.status === 'current') {
        return '<div class="bv-fresh bv-fresh--ok"><span class="bv-fresh-icon">✅</span><div>'
          + '<strong>Up to date with the publisher.</strong>'
          + '<div class="bv-fresh-sub">bereanbible.com hasn’t changed since your last compare' + (when ? ' (' + esc(when) + ')' : '') + '. Publisher text dated ' + esc(live.lastModified || '—') + '.</div></div></div>';
      }
      if (d.status === 'newer') {
        return '<div class="bv-fresh bv-fresh--warn"><span class="bv-fresh-icon">⚠️</span><div>'
          + '<strong>A newer BSB is available.</strong>'
          + '<div class="bv-fresh-sub">The publisher updated their text to <strong>' + esc(live.lastModified || '—') + '</strong>; your last compare was against ' + esc((last && last.lastModified) || '—') + (when ? ' on ' + esc(when) : '') + '. Run a compare to review what changed.</div></div></div>';
      }
      if (d.status === 'no-runs') {
        return '<div class="bv-fresh"><span class="bv-fresh-icon">•</span><div>'
          + '<strong>No compare run yet.</strong>'
          + '<div class="bv-fresh-sub">Run a compare to set a baseline; after that this shows a ✅ until the publisher releases a newer text. Publisher text currently dated ' + esc(live.lastModified || '—') + '.</div></div></div>';
      }
      return '<div class="bv-fresh"><span class="bv-fresh-icon">•</span><div>'
        + '<strong>Couldn’t reach the publisher.</strong>'
        + '<div class="bv-fresh-sub">Unable to check bereanbible.com right now.</div></div></div>';
    }

    function loadFreshness() {
      var containers = [document.getElementById('bv-freshness'), document.getElementById('bv-version')].filter(Boolean);
      if (!containers.length) return;
      containers.forEach(function (c) { c.innerHTML = '<div class="bv-fresh"><span class="bv-fresh-icon">…</span><div><strong>Checking for a newer BSB…</strong></div></div>'; });
      apiCall('GET', '/api/admin/bible-freshness?translationId=bsb')
        .then(function (d) { var html = freshnessHtml(d); containers.forEach(function (c) { c.innerHTML = html; }); })
        .catch(function (e) { containers.forEach(function (c) { c.innerHTML = '<div class="bv-fresh bv-fresh--err"><span class="bv-fresh-icon">⚠️</span><div><strong>Freshness check failed.</strong><div class="bv-fresh-sub">' + esc(e.message) + '</div></div></div>'; }); });
    }

    function statusBadge(s) {
      return s === 'pass' ? '<span class="admin-badge admin-badge--ok">Up to date</span>'
        : s === 'error' ? '<span class="admin-badge admin-badge--err">Error</span>'
          : '<span class="admin-badge admin-badge--warn">Differences</span>';
    }

    var historyRuns = [], historyShown = 25;
    function renderHistory(runs) {
      if (runs) { historyRuns = runs; historyShown = 25; }
      runs = historyRuns;
      var clearBtn = '<div class="bv-history-actions"><button class="admin-btn admin-btn--sm" id="bv-clear-history">Clear history</button> <span class="bv-clear-status text-muted"></span></div>';
      if (!runs.length) { historyEl.innerHTML = '<p class="text-muted">No comparisons run yet.</p>' + clearBtn; wireClearHistory(); return; }
      // "—" for older runs saved before the per-type columns existed.
      var cell = function (val) { return '<td>' + (val == null ? '<span class="text-muted">—</span>' : esc(val)) + '</td>'; };
      var rows = runs.slice(0, historyShown).map(function (r) {
        var verses = r.verseChanged != null ? r.verseChanged : (r.verse ? r.verse.changed : null);
        return '<tr><td>' + esc(r.createdAt ? new Date(r.createdAt).toLocaleString() : '') + '</td>'
          + '<td>' + statusBadge(r.status) + '</td>'
          + '<td>' + esc((r.translationId || '').toUpperCase()) + '</td>'
          + cell(verses)
          + cell(r.headingDiffBooks)
          + cell(r.footnoteDiffBooks)
          + cell(r.crossRefDiffBooks)
          + '<td>' + esc(r.runBy || '') + '</td></tr>';
      }).join('');
      var more = runs.length > historyShown
        ? '<div class="bv-more"><button class="admin-btn admin-btn--sm bv-history-more">View more (' + (runs.length - historyShown) + ' older)</button></div>'
        : '';
      historyEl.innerHTML = '<table class="admin-table"><thead><tr>'
        + '<th>When</th><th>Result</th><th>Bible</th><th>Verse diffs</th><th>Heading diffs</th><th>Footnote diffs</th><th>Cross-ref diffs</th><th>By</th>'
        + '</tr></thead><tbody>' + rows + '</tbody></table>' + more
        + '<p class="text-muted" style="font-size:12px">Heading / footnote / cross-ref counts are the number of books differing; “—” marks older runs recorded before these columns existed.</p>'
        + clearBtn;
      var moreBtn = historyEl.querySelector('.bv-history-more');
      if (moreBtn) moreBtn.addEventListener('click', function () { historyShown += 25; renderHistory(); });
      wireClearHistory();
    }

    function wireClearHistory() {
      var btn = document.getElementById('bv-clear-history');
      if (!btn) return;
      btn.addEventListener('click', function () {
        if (!window.confirm('Clear the entire comparison run history? This cannot be undone.')) return;
        var status = btn.parentElement.querySelector('.bv-clear-status');
        btn.disabled = true; status.textContent = ' clearing…';
        apiCall('DELETE', '/api/admin/bible-validation/runs')
          .then(function (d) { status.textContent = ' cleared ' + (d.deleted || 0); loadHistory(); })
          .catch(function (e) { btn.disabled = false; status.innerHTML = ' <span class="admin-error">' + esc(e.message) + '</span>'; });
      });
    }

    function loadHistory() {
      apiCall('GET', '/api/admin/bible-validation/runs?limit=100')
        .then(function (d) { renderHistory(d.runs || []); })
        .catch(function (e) { historyEl.innerHTML = '<p class="admin-error">' + esc(e.message) + '</p>'; });
    }

    // ── Applied-changes sync log (per-commit, from the content repo history) ──
    var syncLogEl = document.getElementById('bv-synclog');

    function kindBadge(k) {
      var labels = { heading: 'Heading', footnote: 'Footnote', 'cross-reference': 'Cross-ref', verse: 'Verse', structure: 'Structure', quote: 'Quotation', restore: 'Restore', other: 'Change' };
      return '<span class="bv-log-kind bv-log-kind--' + esc(k || 'other') + '">' + esc(labels[k] || 'Change') + '</span>';
    }

    var syncLogEntries = [], syncLogShown = 25;
    function renderSyncLog() {
      if (!syncLogEl) return;
      var entries = syncLogEntries;
      if (!entries.length) { syncLogEl.innerHTML = '<p class="text-muted">No applied changes yet.</p>'; return; }
      var rows = entries.slice(0, syncLogShown).map(function (e) {
        return '<div class="bv-log-row" data-sha="' + esc(e.sha) + '" data-url="' + esc(e.url || '') + '">'
          + '<div class="bv-log-head">' + kindBadge(e.kind)
          + '<span class="bv-log-msg">' + esc(e.message) + '</span>'
          + '<span class="bv-log-meta text-muted">' + esc(e.date ? new Date(e.date).toLocaleString() : '') + ' · ' + esc(e.by) + ' · ' + esc(e.shortSha) + '</span>'
          + '<span class="bv-log-actions"><button class="admin-btn admin-btn--sm bv-log-view">View diff</button> <button class="admin-btn admin-btn--sm bv-log-restore">Restore</button> <span class="bv-log-status text-muted"></span></span>'
          + '</div><div class="bv-log-diff" style="display:none"></div></div>';
      }).join('');
      var more = entries.length > syncLogShown
        ? '<div class="bv-more"><button class="admin-btn admin-btn--sm bv-synclog-more">View more (' + (entries.length - syncLogShown) + ' older)</button></div>'
        : '';
      syncLogEl.innerHTML = rows + more;
    }

    function loadSyncLog() {
      if (!syncLogEl) return;
      syncLogShown = 25;
      syncLogEl.innerHTML = '<p class="text-muted">Loading applied changes…</p>';
      apiCall('GET', '/api/admin/bible-sync-log?limit=100')
        .then(function (d) { syncLogEntries = d.entries || []; renderSyncLog(); })
        .catch(function (e) { syncLogEl.innerHTML = '<p class="admin-error">' + esc(e.message) + '</p>'; });
    }

    if (syncLogEl) syncLogEl.addEventListener('click', function (e) {
      if (e.target.classList.contains('bv-synclog-more')) { syncLogShown += 25; renderSyncLog(); return; }
      var row = e.target.closest('.bv-log-row'); if (!row) return;
      var sha = row.getAttribute('data-sha'), url = row.getAttribute('data-url');
      if (e.target.classList.contains('bv-log-view')) {
        var diffEl = row.querySelector('.bv-log-diff');
        if (diffEl.style.display === 'block') { diffEl.style.display = 'none'; e.target.textContent = 'View diff'; return; }
        e.target.textContent = 'Hide diff'; diffEl.style.display = 'block'; diffEl.innerHTML = '<p class="text-muted">Loading…</p>';
        apiCall('GET', '/api/admin/bible-sync-log/' + encodeURIComponent(sha))
          .then(function (d) {
            var body = (d.files || []).map(function (f) {
              return '<div class="bv-log-file"><div class="text-muted" style="font-size:12px">' + esc(f.name) + '</div>'
                + (f.changes || []).map(function (c) {
                  return '<div class="bv-diff-line"><span class="bv-side">Before</span> ' + esc(c.old || '(none)') + '</div>'
                    + '<div class="bv-diff-line"><span class="bv-side bv-side--new">After</span> ' + esc(c.new || '(none)') + '</div>';
                }).join('') + '</div>';
            }).join('') || '<p class="text-muted">No line changes.</p>';
            var gh = url ? '<div class="bv-log-ghlink"><a href="' + esc(url) + '" target="_blank" rel="noopener">View this diff on GitHub &rarr;</a></div>' : '';
            diffEl.innerHTML = body + gh;
          })
          .catch(function (err) { diffEl.innerHTML = '<p class="admin-error">' + esc(err.message) + '</p>'; });
      }
      if (e.target.classList.contains('bv-log-restore')) {
        if (!window.confirm('Restore the original text for this change? This commits a revert to the content repository.')) return;
        var st = row.querySelector('.bv-log-status'), btn = e.target;
        btn.disabled = true; st.textContent = ' restoring…';
        apiCall('POST', '/api/admin/bible-sync-log/' + encodeURIComponent(sha) + '/restore', {})
          .then(function (r) { st.innerHTML = r.reverted ? ' <span class="admin-badge admin-badge--ok">Restored</span>' : ' <span class="text-muted">nothing to restore (changed since?)</span>'; setTimeout(loadSyncLog, 1500); })
          .catch(function (err) { btn.disabled = false; st.innerHTML = ' <span class="admin-error">' + esc(err.message) + '</span>'; });
      }
    });

    // --- Quotation Audit (streaming, grouped by book) ---
    var qaBtn = document.getElementById('qa-run-btn');
    var qaOutput = document.getElementById('qa-output');
    var qaFixes = {}, qaFixSeq = 0;

    function coverImg(coverPath) {
      return coverPath
        ? '<img class="qa-cover" src="/cover/' + esc(encodeURI(coverPath)) + '" alt="" loading="lazy">'
        : '<span class="qa-cover qa-cover--none">📖</span>';
    }
    function bookBadge(diffs) {
      return diffs ? '<span class="admin-badge admin-badge--warn">' + diffs + ' to review</span>'
        : '<span class="admin-badge admin-badge--ok">clean</span>';
    }
    // A live progress row while a book is being analyzed.
    function qaLiveRow(b) {
      return '<div class="qa-book-row">' + coverImg(b.coverPath)
        + '<div class="qa-book-meta"><div class="qa-book-title">' + esc(b.title) + '</div>'
        + '<div class="text-muted">' + esc(b.series || '') + ' · ' + esc(b.quotes) + ' quotes · ' + esc(b.exact) + ' exact</div></div>'
        + bookBadge(b.diffs) + '</div>';
    }
    function normWord(t) { return String(t).toLowerCase().replace(/[^a-z0-9]/g, ''); }
    function setOf(words) { var s = {}; (words || []).forEach(function (w) { var n = normWord(w); if (n) s[n] = true; }); return s; }
    // Bold the tokens whose normalized word is in `set`; escape everything.
    function boldBySet(text, set) {
      return String(text).split(/(\s+)/).map(function (tok) {
        if (!tok.trim()) return esc(tok);
        return set[normWord(tok)] ? '<strong>' + esc(tok) + '</strong>' : esc(tok);
      }).join('');
    }
    // Show the surrounding paragraph with the quote <mark>ed and differing words bold.
    function markQuoteInParagraph(paragraph, quote, diffSet) {
      var idx = paragraph.indexOf(quote);
      if (idx < 0) return boldBySet(paragraph, diffSet);
      return esc(paragraph.slice(0, idx)) + '<mark class="qa-q">' + boldBySet(quote, diffSet) + '</mark>' + esc(paragraph.slice(idx + quote.length));
    }
    // Show the full BSB verse with the quoted span <mark>ed and its differing (vs the quote) words bold.
    function markSpanInVerse(verse, span, quoteText) {
      var qset = setOf(String(quoteText).split(/\s+/));
      var bibleSet = {};
      String(span || '').split(/\s+/).forEach(function (w) { var n = normWord(w); if (n && !qset[n]) bibleSet[n] = true; });
      var idx = span ? verse.indexOf(span) : -1;
      if (idx < 0) return boldBySet(verse, bibleSet);
      return esc(verse.slice(0, idx)) + '<mark class="qa-q">' + boldBySet(span, bibleSet) + '</mark>' + esc(verse.slice(idx + span.length));
    }

    function findingRow(f) {
      var tierLbl = f.tier === 'review' ? 'Review' : f.tier === 'different-translation' ? 'Different translation' : 'Minor';
      var sessionHead = f.sessionTitle
        ? (f.sessionUrl ? '<a href="' + esc(f.sessionUrl) + '" target="_blank" rel="noopener">' + esc(f.sessionTitle) + '</a>' : esc(f.sessionTitle))
        : '<code>' + esc((f.file || '').split('/').pop()) + '</code>';
      var diffSet = setOf(f.onlyInQuote);
      var span = (f.fix && f.fix.ok) ? f.fix.preview : null;
      var fixBlock = '';
      if (f.fix && f.fix.ok) {
        var fid = 'fix:' + (qaFixSeq++);
        // Store only the pieces the apply needs; the replacement text comes from
        // the (editable) textarea at click time. kind decides blockquote prefixing.
        qaFixes[fid] = { file: f.file, ref: f.ref, oldText: f.fix.oldRaw, kind: f.kind };
        fixBlock = '<div class="qa-fix">'
          + '<div class="qa-fix-label text-muted">Fix will set the quote to (edit before applying if needed):</div>'
          + '<textarea class="qa-fix-text" rows="2" spellcheck="false">' + esc(f.fix.preview) + '</textarea>'
          + '<div class="qa-fix-actions"><button class="admin-btn admin-btn--primary admin-btn--sm bv-fix" data-fix-id="' + esc(fid) + '">Fix quote</button> <span class="bv-fix-status text-muted"></span></div></div>';
      }
      return '<div class="admin-card qa-finding">'
        + '<div class="qa-finding-session">' + sessionHead + '</div>'
        + '<div class="qa-finding-head"><span class="bv-loc">' + esc(f.ref) + '</span> <span class="admin-badge admin-badge--warn">' + esc(tierLbl) + '</span> <span class="text-muted">' + esc(f.coverage) + '% overlap</span> '
        + '<a href="#" class="bv-context" data-ctx-ref="' + esc(f.ref) + '">Show scripture</a></div>'
        + '<div class="qa-block"><div class="qa-block-label">In the session</div><div class="qa-para">' + markQuoteInParagraph(f.context || f.quote, f.quote, diffSet) + '</div></div>'
        + '<div class="qa-block"><div class="qa-block-label">BSB &mdash; ' + esc(f.ref) + '</div><div class="qa-para">' + markSpanInVerse(f.verse, span, f.quote) + '</div></div>'
        + fixBlock + '</div>';
    }
    // A collapsible result card per book, with cover + counts + findings.
    function qaResultBook(b) {
      var diffs = (b.review || 0) + (b.minor || 0) + (b.diffTransl || 0);
      var summary = '<summary class="qa-book-summary">' + coverImg(b.coverPath)
        + '<div class="qa-book-meta"><div class="qa-book-title">' + esc(b.title) + '</div>'
        + '<div class="text-muted">' + esc(b.quotes) + ' quotes · ' + esc(b.exact) + ' exact · ' + esc(b.caseOnly + b.formatOnly) + ' cosmetic · <strong>' + esc(b.review) + '</strong> to review</div></div>'
        + bookBadge(diffs) + '</summary>';
      var body = (b.findings && b.findings.length)
        ? b.findings.map(findingRow).join('')
        : '<p class="text-muted">No differences — all quotations match the current Bible.</p>';
      return '<details class="qa-book">' + summary + '<div class="qa-book-body">' + body + '</div></details>';
    }

    function renderQaResult(result) {
      qaFixes = {}; qaFixSeq = 0;
      var c = result.counts || {};
      var row = function (k, label) { return '<tr><td>' + esc(label) + '</td><td>' + esc(c[k] || 0) + '</td></tr>'; };
      var overview = '<div class="admin-card" style="margin:12px 0">'
        + '<p><strong>' + esc(result.checked) + '</strong> quotations checked across <strong>' + esc(result.books.length) + '</strong> books against the ' + esc(result.comparedAgainst || 'current Bible') + '.</p>'
        + '<table class="admin-table"><tbody>'
        + row('exact', '✅ Exact match') + row('case-only', 'Cosmetic — “Lord” vs “LORD”') + row('format-only', 'Cosmetic — punctuation/spacing')
        + row('word-difference', 'TIER 1 — review (small wording differences)')
        + row('footnote-artifact', 'TIER 2 — footnote-marker leak') + row('ellipsis-omission', 'TIER 2 — ellipsis omission') + row('editorial-bracket', 'TIER 2 — editorial [brackets]')
        + row('heavy-difference', 'TIER 3 — likely a different translation') + row('paraphrase', 'Paraphrase (ignored)')
        + '</tbody></table></div>';
      // Books with the most to review first, then the rest.
      var withDiffs = result.books.filter(function (b) { return (b.review + b.minor + b.diffTransl) > 0; }).sort(function (a, bb) { return (bb.review + bb.minor + bb.diffTransl) - (a.review + a.minor + a.diffTransl); });
      var clean = result.books.filter(function (b) { return (b.review + b.minor + b.diffTransl) === 0; });
      var html = '<h4>Books with differences (' + withDiffs.length + ')</h4>' + withDiffs.map(qaResultBook).join('');
      if (clean.length) html += '<h4 style="margin-top:16px">Clean books (' + clean.length + ')</h4>' + clean.map(qaResultBook).join('');
      html += '<h4 style="margin-top:20px">Summary</h4>' + overview;
      qaResults.innerHTML = html;
    }

    var qaChecklist, qaResults;
    if (qaBtn) {
      qaBtn.addEventListener('click', function () {
        var translationId = 'bsb';
        var orig = qaBtn.textContent;
        qaBtn.disabled = true; qaBtn.textContent = 'Auditing…';
        qaOutput.innerHTML = '<div id="qa-checklist"></div><div id="qa-results"></div>';
        qaChecklist = qaOutput.querySelector('#qa-checklist');
        qaResults = qaOutput.querySelector('#qa-results');
        var books = [], queue = [], loadDetail = '', scanning = false, resultEvt = null, streamDone = false, failed = false;

        function renderProgress() {
          if (streamDone) {
            // Results below replace the live list — keep only a compact done line.
            qaChecklist.innerHTML = '<div class="admin-card bv-checklist-card"><div class="bv-step bv-step--done"><span class="bv-ck bv-ck--done">✓</span><span>Audit complete</span></div></div>';
            return;
          }
          var head = '<div class="bv-step bv-step--run"><span class="bv-ck bv-ck--run">◐</span><span>' + (scanning ? 'Auditing quotations, book by book' : 'Loading the Bible and indexing the library') + (loadDetail ? ' — ' + esc(loadDetail) : '') + '</span></div>';
          qaChecklist.innerHTML = '<div class="admin-card bv-checklist-card">' + head + '<div class="qa-live-books">' + books.map(qaLiveRow).join('') + '</div></div>';
        }
        renderProgress();

        var timer = setInterval(function () {
          if (queue.length) { books.push(queue.shift()); renderProgress(); return; }
          if (streamDone) { clearInterval(timer); renderProgress(); if (!failed && resultEvt) renderQaResult(resultEvt.result); qaBtn.disabled = false; qaBtn.textContent = orig; }
        }, 40);

        var es = new EventSource('/api/admin/bible-quote-audit/stream?translationId=' + encodeURIComponent(translationId));
        es.onmessage = function (ev) {
          var e; try { e = JSON.parse(ev.data); } catch (_) { return; }
          if (e.type === 'book') { queue.push(e); }
          else if (e.type === 'step') { if (e.key === 'load' && e.detail) loadDetail = e.detail; if (e.key === 'scan' && e.status === 'running') scanning = true; }
          else if (e.type === 'result') { resultEvt = e; }
          else if (e.type === 'done') { streamDone = true; es.close(); }
          else if (e.type === 'error') { failed = true; streamDone = true; es.close(); qaResults.innerHTML = '<p class="admin-error">' + esc(e.error) + '</p>'; }
        };
        es.onerror = function () { es.close(); if (!resultEvt && !failed) { failed = true; streamDone = true; if (!qaResults.innerHTML) qaResults.innerHTML = '<p class="admin-error">Connection interrupted — please try again.</p>'; } };
      });

      // "Show scripture" popup + "Fix quote" apply inside audit results.
      qaOutput.addEventListener('click', function (e) {
        if (e.target.classList.contains('bv-context')) { e.preventDefault(); openChapterPopup(e.target.getAttribute('data-ctx-ref'), { kind: e.target.getAttribute('data-ctx-note-kind'), text: e.target.getAttribute('data-ctx-note') }); return; }
        if (e.target.classList.contains('bv-fix')) {
          var btn = e.target, meta = qaFixes[btn.getAttribute('data-fix-id')];
          if (!meta) return;
          var fixCard = btn.closest('.qa-fix');
          var ta = fixCard && fixCard.querySelector('.qa-fix-text');
          var edited = ta ? ta.value.trim() : '';
          if (!edited) { return; }
          var change = { type: 'library-fix', file: meta.file, ref: meta.ref, oldText: meta.oldText,
            newText: (meta.kind === 'attribution' ? '> ' : '') + edited };
          var actions = btn.parentElement, statusEl = actions.querySelector('.bv-fix-status');
          btn.disabled = true; statusEl.textContent = ' applying…';
          apiCall('POST', '/api/admin/bible-validation/apply-change', { change: change })
            .then(function (r) { actions.innerHTML = '<span class="admin-badge admin-badge--ok">Fixed</span> <span class="text-muted">' + esc((r.sha || '').slice(0, 7)) + '</span>'; })
            .catch(function (err) { btn.disabled = false; statusEl.innerHTML = ' <span class="admin-error">' + esc(err.message) + '</span>'; });
        }
      });
    }

  })();

})();
