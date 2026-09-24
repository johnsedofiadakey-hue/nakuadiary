const crypto = require('crypto');
const logger = require('firebase-functions/logger');
const { HttpsError } = require('firebase-functions/v2/https');

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maxLength) : '';
}

/** Ghana-shaped normalization to international digits: 024 123 4567 → 233241234567. */
function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 10) return `233${digits.slice(1)}`;
  return digits;
}

/** 233241234567 → 024****567, for logs and stored SMS metadata. */
function maskPhone(phone) {
  const digits = normalizePhone(phone);
  const local = digits.startsWith('233') && digits.length === 12 ? `0${digits.slice(3)}` : digits;
  return local.length > 6 ? `${local.slice(0, 3)}****${local.slice(-3)}` : '****';
}

/** Human-friendly order reference shown to customers and in SMS, e.g. NKD-7F3K9Q. */
function makeOrderReference() {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I
  const bytes = crypto.randomBytes(6);
  return `NKD-${[...bytes].map((byte) => alphabet[byte % alphabet.length]).join('')}`;
}

function requireAuth(request) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Please sign in and try again.');
  return request.auth.uid;
}

function requireAdmin(request) {
  const uid = requireAuth(request);
  if (request.auth.token?.admin !== true) throw new HttpsError('permission-denied', 'Admin access required.');
  return uid;
}

function requireAppCheck(request, enforce) {
  if (enforce && !request.app) throw new HttpsError('unauthenticated', 'This request could not be verified. Refresh the page and try again.');
}

/** Structured log that never includes customer names, phones, addresses, or secrets. */
const log = {
  info: (message, fields = {}) => logger.info(message, fields),
  warn: (message, fields = {}) => logger.warn(message, fields),
  error: (message, error, fields = {}) => logger.error(message, { ...fields, error: error?.message || String(error) }),
};

module.exports = { cleanText, normalizePhone, maskPhone, makeOrderReference, requireAuth, requireAdmin, requireAppCheck, log };
