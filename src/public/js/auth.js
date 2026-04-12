// Noble Imprint — Client-side Firebase Authentication
(function () {
  'use strict';

  // Firebase is initialized in footer.ejs via compat SDK

  var provider = new firebase.auth.GoogleAuthProvider();

  window.loginWithGoogle = function () {
    firebase.auth().signInWithPopup(provider)
      .then(function (result) {
        return result.user.getIdToken();
      })
      .then(function (idToken) {
        return fetch('/api/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: idToken }),
        });
      })
      .then(function (res) {
        if (!res.ok) throw new Error('Session creation failed');
        window.location.reload();
      })
      .catch(function (err) {
        console.error('Login error:', err);
        // User closed popup or error occurred — fail silently
      });
  };

  window.logout = function () {
    fetch('/api/auth/logout', { method: 'POST' })
      .then(function () {
        return firebase.auth().signOut();
      })
      .then(function () {
        window.location.reload();
      })
      .catch(function (err) {
        console.error('Logout error:', err);
        window.location.reload();
      });
  };
})();
