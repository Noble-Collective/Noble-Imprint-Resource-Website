const admin = require('firebase-admin');
const crypto = require('crypto');
const cache = require('./cache');

const SUPER_ADMIN_EMAIL = 'steve@noblecollective.org';
const SESSION_EXPIRES_IN = 5 * 24 * 60 * 60 * 1000; // 5 days
const ADMIN_CACHE_TTL = 60 * 1000; // 60 seconds

// Initialize Firebase Admin SDK — uses ADC on Cloud Run, local credentials in dev.
// The DEFAULT app stays on the website's project (noble-imprint-website) and owns all
// Firestore/data access (users, roles, suggestions, notifications).
if (!admin.apps.length) {
  admin.initializeApp();
}

// Convergence Phase 1b: when AUTH_UNIFIED=1, end-user identity comes from the shared project
// noble-imprint-463519 instead of noble-imprint-website. Token verification + session-cookie
// mint/verify then run against a SECOND named admin app pinned to 463519. Data access is
// unchanged — it stays on the default app. Keyless signing: the named app is initialized with a
// serviceAccountId so createSessionCookie signs via the IAM Credentials signBlob API (no stored
// key), which requires the runtime SA to hold roles/iam.serviceAccountTokenCreator on that SA.
const AUTH_UNIFIED = process.env.AUTH_UNIFIED === '1';
const READER_PROJECT_ID = process.env.AUTH_UNIFIED_PROJECT_ID || 'noble-imprint-463519';
const READER_SIGNER_SA = process.env.AUTH_UNIFIED_SIGNER_SA
  || `firebase-adminsdk-fbsvc@${READER_PROJECT_ID}.iam.gserviceaccount.com`;

let _authApp = null;
function reader463519App() {
  if (!_authApp) {
    _authApp = admin.initializeApp(
      { projectId: READER_PROJECT_ID, serviceAccountId: READER_SIGNER_SA },
      'auth463519',
    );
  }
  return _authApp;
}
function authAuth() {
  if (!AUTH_UNIFIED) return admin.auth(); // default app = noble-imprint-website (today's behavior)
  return reader463519App().auth();
}
// Firestore handle for the shared converged store (collective-user-data on 463519). Used by admin
// aggregations (Reader Activity). Requires the runtime SA to have Firestore read on 463519.
function getReaderFirestore() {
  const { getFirestore } = require('firebase-admin/firestore');
  return getFirestore(reader463519App(), 'collective-user-data');
}

function isSuperAdmin(email) {
  return email && email.toLowerCase() === SUPER_ADMIN_EMAIL;
}

async function createSessionCookie(idToken) {
  return authAuth().createSessionCookie(idToken, { expiresIn: SESSION_EXPIRES_IN });
}

// Verify a Google ID token from whichever project owns identity under the current flag.
async function verifyIdToken(idToken) {
  return authAuth().verifyIdToken(idToken);
}

async function verifySessionCookie(cookie) {
  try {
    return await authAuth().verifySessionCookie(cookie, true);
  } catch {
    return null;
  }
}

// Middleware: attach user info to every request
function attachUser(req, res, next) {
  // Dev-only: bypass auth with __dev_auth cookie
  if (process.env.NODE_ENV !== 'production' && req.cookies && req.cookies.__dev_auth) {
    const email = req.cookies.__dev_auth;
    const user = {
      uid: email.replace(/[^a-zA-Z0-9]/g, '_'),
      email,
      displayName: email.split('@')[0],
      photoURL: null,
      isSuperAdmin: isSuperAdmin(email),
      isAdmin: false,
    };
    const firestoreMod = require('./firestore');
    return firestoreMod.getRoleFlags(email).then(flags => {
      user.isAdmin = flags.isAdmin || user.isSuperAdmin;
      user.isEditor = flags.isEditor || user.isSuperAdmin;
      req.user = user;
      res.locals.user = user;
      next();
    }).catch(() => { req.user = user; res.locals.user = user; next(); });
  }

  // API key auth: for bot/automation access (e.g., Claude AI)
  const apiKey = req.headers['x-api-key'];
  if (apiKey && process.env.CLAUDE_API_KEY && apiKey === process.env.CLAUDE_API_KEY) {
    const botEmail = process.env.CLAUDE_BOT_EMAIL || 'claude@noblecollective.org';
    const firestoreMod = require('./firestore');
    return firestoreMod.getUser(botEmail).then(async (botUser) => {
      const user = {
        uid: 'bot_' + botEmail.replace(/[^a-zA-Z0-9]/g, '_'),
        email: botEmail,
        displayName: (botUser && botUser.displayName) || 'Claude AI',
        photoURL: (botUser && botUser.photoURL) || null,
        isSuperAdmin: false,
        isAdmin: false,
        isBot: true,
      };
      const isAdm = await firestoreMod.isAdmin(botEmail);
      user.isAdmin = isAdm;
      user.isEditor = isAdm;
      req.user = user;
      res.locals.user = user;
      next();
    }).catch(() => {
      req.user = null;
      res.locals.user = null;
      next();
    });
  }

  const sessionCookie = req.cookies && req.cookies.__session;
  if (!sessionCookie) {
    req.user = null;
    res.locals.user = null;
    return next();
  }

  verifySessionCookie(sessionCookie).then(async (decoded) => {
    if (!decoded) {
      res.clearCookie('__session');
      req.user = null;
      res.locals.user = null;
      return next();
    }

    const email = decoded.email;
    const user = {
      uid: decoded.uid,
      email,
      displayName: decoded.name || email,
      photoURL: decoded.picture || null,
      isSuperAdmin: isSuperAdmin(email),
      isAdmin: false,
    };

    // Resolve admin + editor flags with caching (one Firestore read, cached 60s)
    const cacheKey = `roleflags:${email.toLowerCase()}`;
    let flags = cache.get(cacheKey);
    if (!flags) {
      const firestore = require('./firestore');
      flags = await firestore.getRoleFlags(email);
      cache.set(cacheKey, flags, ADMIN_CACHE_TTL);
    }
    user.isAdmin = flags.isAdmin || user.isSuperAdmin;
    user.isEditor = flags.isEditor || user.isSuperAdmin;
    // Session cookies don't always carry name/picture — fall back to the stored Google profile.
    user.displayName = decoded.name || flags.displayName || email;
    user.photoURL = decoded.picture || flags.photoURL || null;

    req.user = user;
    res.locals.user = user;
    next();
  }).catch(() => {
    req.user = null;
    res.locals.user = null;
    next();
  });
}

// Constant-time string comparison (avoids leaking secret length/prefix via timing).
function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length === 0 || b.length === 0) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Middleware: gate automation/destructive endpoints (refresh, refresh-audio) behind a
// shared secret. Accepts `Authorization: Bearer <REFRESH_SECRET>` or `x-refresh-key`.
// Admins pass too (so Steve can trigger from a signed-in session). In non-production
// it falls through so the local dev server + test suite keep working without a secret.
// Fails CLOSED in production: if REFRESH_SECRET is unset it rejects (500) rather than
// silently allowing anonymous access.
function requireRefreshSecret(req, res, next) {
  if (req.user && req.user.isAdmin) return next();
  const secret = process.env.REFRESH_SECRET;
  if (secret) {
    const authHeader = req.headers['authorization'] || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const provided = req.headers['x-refresh-key'] || bearer;
    if (timingSafeEqualStr(provided, secret)) return next();
  }
  if (process.env.NODE_ENV !== 'production') return next(); // local dev / tests
  if (!secret) return res.status(500).json({ error: 'Server misconfigured: REFRESH_SECRET is not set' });
  return res.status(403).json({ error: 'Unauthorized' });
}

// Middleware: require admin or super admin
function requireAdmin(req, res, next) {
  if (!req.user) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    return res.redirect('/');
  }
  if (!req.user.isAdmin) {
    if (req.path.startsWith('/api/')) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    return res.status(403).render('error', { title: 'Forbidden', message: 'You do not have permission to access this page.' });
  }
  next();
}

module.exports = {
  createSessionCookie,
  verifyIdToken,
  verifySessionCookie,
  getReaderFirestore,
  attachUser,
  AUTH_UNIFIED,
  requireAdmin,
  requireRefreshSecret,
  timingSafeEqualStr,
  isSuperAdmin,
  SESSION_EXPIRES_IN,
  SUPER_ADMIN_EMAIL,
};
