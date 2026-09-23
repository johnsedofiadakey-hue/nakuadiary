// Public Firebase web config — safe to ship to the browser. Firebase web
// config is an app identifier, not a secret; real access control lives in
// firestore.rules, storage.rules and (once enabled) App Check.
//
// Fill this in from Firebase console → Project settings → General → Your apps
// → SDK setup and configuration, after creating a Firebase project and a
// Web app inside it. Until every REPLACE_ME is filled in, store.js falls
// back to its local mock adapter so the storefront keeps working.
export const firebaseConfig = {
  apiKey: 'AIzaSyBbAbiw0H4CtguKckSWIDXjqcCn-Z0N7lg',
  authDomain: 'nakuadiary.firebaseapp.com',
  projectId: 'nakuadiary',
  storageBucket: 'nakuadiary.firebasestorage.app',
  messagingSenderId: '250705335706',
  appId: '1:250705335706:web:e4eb740ad41cfbfdca5623',
};

export const isFirebaseConfigured = Object.values(firebaseConfig).every((value) => !value.includes('REPLACE_ME'));
