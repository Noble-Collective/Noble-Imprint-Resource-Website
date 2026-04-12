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

})();
