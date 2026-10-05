// VENDORED — do not edit. @noble-collective/userdata/session-identity 0.6.0 (from vendor/ tarball).
// Regenerate with: bash scripts/vendor-session-identity.sh
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/session-identity.ts
var session_identity_exports = {};
__export(session_identity_exports, {
  MAX_DISPLAY_NAME: () => MAX_DISPLAY_NAME,
  cleanDisplayName: () => cleanDisplayName,
  isRelayEmail: () => isRelayEmail,
  sessionIdentity: () => sessionIdentity,
  trustedEmail: () => trustedEmail
});
module.exports = __toCommonJS(session_identity_exports);

// src/core/auth-contract.ts
var isRelayEmail = (email) => !!email && /@privaterelay\.appleid\.com$/i.test(email.trim());
function trustedEmail(claims) {
  if (!claims || claims.email_verified !== true) return null;
  if (typeof claims.email !== "string") return null;
  const e = claims.email.trim().toLowerCase();
  return e.length > 0 ? e : null;
}

// src/core/session-identity.ts
var MAX_DISPLAY_NAME = 100;
var MAX_PHOTO_URL = 2048;
var INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
function cleanDisplayName(v) {
  if (typeof v !== "string") return null;
  const s = v.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  return [...s].slice(0, MAX_DISPLAY_NAME).join("").trim() || null;
}
function cleanPhoto(v) {
  if (typeof v !== "string" || v.length > MAX_PHOTO_URL) return null;
  try {
    return new URL(v).protocol === "https:" ? v : null;
  } catch {
    return null;
  }
}
function sessionIdentity(claims, clientProfile) {
  const uid = [claims.uid, claims.sub, claims.user_id].find((x) => typeof x === "string" && x.length > 0);
  if (!uid) throw new Error("sessionIdentity: claims carry no uid");
  const client = clientProfile && typeof clientProfile === "object" ? clientProfile : {};
  return {
    uid,
    trustedEmail: trustedEmail(claims),
    displayName: cleanDisplayName(claims.name) ?? cleanDisplayName(client.displayName),
    photoURL: cleanPhoto(claims.picture) ?? cleanPhoto(client.photoURL)
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MAX_DISPLAY_NAME,
  cleanDisplayName,
  isRelayEmail,
  sessionIdentity,
  trustedEmail
});
