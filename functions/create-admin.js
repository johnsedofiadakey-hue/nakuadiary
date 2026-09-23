/**
 * One-off bootstrap: creates (or promotes) a single Firebase Auth user to
 * admin by setting the `admin` custom claim. There is no self-serve way to
 * become an admin, so run this once, locally, for the very first account —
 * after that, admins are managed by hand in the Firebase console (or a
 * future admin-portal "staff" screen).
 *
 * Usage:
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... node create-admin.js
 * (needs `gcloud auth application-default login` once, or
 * GOOGLE_APPLICATION_CREDENTIALS pointing at a service account key — same
 * as seed.js)
 */
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

initializeApp({ credential: applicationDefault() });
const auth = getAuth();

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD environment variables and re-run.');
    process.exit(1);
  }

  let user;
  try {
    user = await auth.getUserByEmail(email);
    console.log(`Found existing user ${user.uid} for ${email}.`);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    user = await auth.createUser({ email, password, emailVerified: true });
    console.log(`Created user ${user.uid} for ${email}.`);
  }

  await auth.setCustomUserClaims(user.uid, { admin: true });
  console.log(`Granted the admin claim to ${email}. Sign out and back in for it to take effect.`);
}

main().catch((err) => {
  console.error('Failed to create admin:', err);
  process.exit(1);
});
