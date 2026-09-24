// Deploy-time configuration. Secrets live in Cloud Secret Manager and are
// only readable inside the functions that declare them; everything else is
// a non-secret param (functions/.env, prompted on first deploy if missing).
const fs = require('fs');
const path = require('path');
const { defineSecret, defineString, defineBoolean } = require('firebase-functions/params');

// Payments (checkout, Paystack webhook, hold expiry) need the PAYSTACK_SECRET_KEY
// secret, and the CLI refuses to deploy ANY function while a declared secret has
// no value. Until it's set, create an empty functions/PAYMENTS_DISABLED file
// (git-ignored) to deploy everything else; delete it to deploy payments.
const PAYMENTS_ENABLED = !fs.existsSync(path.join(__dirname, '..', 'PAYMENTS_DISABLED'));

// Secrets — never log, return, or persist these.
const PAYSTACK_SECRET_KEY = PAYMENTS_ENABLED ? defineSecret('PAYSTACK_SECRET_KEY') : null;
const MNOTIFY_API_KEY = defineSecret('MNOTIFY_API_KEY');

// Non-secret params.
const MNOTIFY_SENDER_ID = defineString('MNOTIFY_SENDER_ID', {
  default: '',
  description: 'Approved MNotify/BMS sender ID (max 11 characters). Empty disables SMS.',
});
const SMS_ENABLED = defineBoolean('SMS_ENABLED', {
  default: false,
  description: 'Send order SMS through MNotify. Keep false until the sender ID is approved.',
});
const CHECKOUT_ALLOWED_ORIGINS = defineString('CHECKOUT_ALLOWED_ORIGINS', {
  default: 'https://nakuadiary.com,https://www.nakuadiary.com,https://nakuadiary.web.app,https://nakuadiary.firebaseapp.com',
  description: 'Comma-separated origins Paystack may redirect customers back to.',
});
const ENFORCE_APP_CHECK = defineBoolean('ENFORCE_APP_CHECK', {
  default: false,
  description: 'Reject public callables without a valid App Check token. Enable after the storefront sends tokens.',
});

const REGION = 'us-central1'; // must match FUNCTIONS_REGION in dist/js/store.js and dist/admin/js/admin-store.js
const CURRENCY = 'GHS';
const PAYSTACK_BASE_URL = 'https://api.paystack.co';
const MNOTIFY_BASE_URL = 'https://api.mnotify.com/api';
const PAYSTACK_EMAIL_DOMAIN = 'guest.nakuadiary.app'; // synthetic buyer email; Paystack requires one

const STOCK_HOLD_MINUTES = 60;
const MAX_LINES = 50;
const MAX_QUANTITY = 20;

module.exports = {
  PAYMENTS_ENABLED,
  PAYSTACK_SECRET_KEY,
  MNOTIFY_API_KEY,
  MNOTIFY_SENDER_ID,
  SMS_ENABLED,
  CHECKOUT_ALLOWED_ORIGINS,
  ENFORCE_APP_CHECK,
  REGION,
  CURRENCY,
  PAYSTACK_BASE_URL,
  MNOTIFY_BASE_URL,
  PAYSTACK_EMAIL_DOMAIN,
  STOCK_HOLD_MINUTES,
  MAX_LINES,
  MAX_QUANTITY,
};
