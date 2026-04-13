const admin = require('firebase-admin');
const cache = require('./cache');

const SUPER_ADMIN_EMAIL = 'steve@noblecollective.org';
const SESSION_EXPIRES_IN = 5 * 24 * 60 * 60 * 1000; // 5 days
const ADMIN_CACHE_TTL = 60 * 1000; // 60 seconds

// Initialize Firebase Admin SDK — uses ADC on Cloud Run, local credentials in dev
if (!admin.apps.length) {
  admin.initializeApp();
}

function isSuperAdmin(email) {
  return email && email.toLowerCase() === SUPER_ADMIN_EMAIL;
}

async function createSessionCookie(idToken) {
  return admin.auth().createSessionCookie(idToken, { expiresIn: SESSION_EXPIRES_IN });
}

async function verifySessionCookie(cookie) {
  try {
    return await admin.auth().verifySessionCookie(cookie, true);
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
    return firestoreMod.isAdmin(email).then(isAdm => {
      user.isAdmin = isAdm || user.isSuperAdmin;
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

    // Check admin status with caching
    const cacheKey = `admin-check:${email.toLowerCase()}`;
    let isAdmin = cache.get(cacheKey);
    if (isAdmin === undefined || isAdmin === null) {
      const firestore = require('./firestore');
      isAdmin = await firestore.isAdmin(email);
      cache.set(cacheKey, isAdmin, ADMIN_CACHE_TTL);
    }
    user.isAdmin = isAdmin || user.isSuperAdmin;

    req.user = user;
    res.locals.user = user;
    next();
  }).catch(() => {
    req.user = null;
    res.locals.user = null;
    next();
  });
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
  verifySessionCookie,
  attachUser,
  requireAdmin,
  isSuperAdmin,
  SESSION_EXPIRES_IN,
  SUPER_ADMIN_EMAIL,
};
