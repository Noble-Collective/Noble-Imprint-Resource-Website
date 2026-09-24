// Does a Firebase uid have any Noble Collective Institute data? Used by the account merge
// (POST /api/account/merge) to refuse — rather than orphan — Institute records keyed by the account
// being removed (memberships, progress, assignments, cohorts, reflections, artifacts). Re-keying them is
// a later step (Collective-Shared/plans/2026-09-24-account-merge.md §5).
//
// Institute data: project `noble-collective-institute`, Firestore database `institute-data`, all
// top-level collections, each with a `uid` field (cohorts: `facilitatorUid`) — single-field equality
// queries, covered by automatic indexes. Requires this service's runtime SA to hold
// roles/datastore.viewer on that project. FAILS CLOSED: if the check can't run, report 'institute' so the
// merge is refused instead of risking orphaned data.

const INSTITUTE_PROJECT_ID = process.env.INSTITUTE_PROJECT_ID || 'noble-collective-institute';
const INSTITUTE_DB = process.env.INSTITUTE_DB || 'institute-data';

const BY_UID = ['memberships', 'assignments', 'progress', 'cohortMemberships', 'sharedReflections', 'artifacts'];

let _db = null;
function instituteDb() {
  if (!_db) {
    const admin = require('firebase-admin');
    const { getFirestore } = require('firebase-admin/firestore');
    const app = admin.apps.find((a) => a && a.name === 'institute') || admin.initializeApp({ projectId: INSTITUTE_PROJECT_ID }, 'institute');
    _db = getFirestore(app, INSTITUTE_DB);
  }
  return _db;
}

/** 'institute' when `uid` has Institute records (or the check failed), else null. */
async function hasInstituteData(uid, db = instituteDb()) {
  try {
    const checks = [
      ...BY_UID.map((c) => db.collection(c).where('uid', '==', uid).limit(1).get()),
      db.collection('cohorts').where('facilitatorUid', '==', uid).limit(1).get(),
    ];
    const snaps = await Promise.all(checks);
    return snaps.some((s) => !s.empty) ? 'institute' : null;
  } catch (e) {
    console.error('[institute-data] check failed — refusing merge:', e.message);
    return 'institute';
  }
}

module.exports = { hasInstituteData, BY_UID };
