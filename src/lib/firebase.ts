import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;
let storageInstance: FirebaseStorage | null = null;

function assertFirebaseConfig() {
  const missingKeys = Object.entries(firebaseConfig)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missingKeys.length > 0) {
    throw new Error(`Missing Firebase config: ${missingKeys.join(", ")}`);
  }
}

export function getFirebaseApp() {
  if (appInstance) {
    return appInstance;
  }

  assertFirebaseConfig();
  appInstance = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  return appInstance;
}

export function getFirebaseAuth() {
  if (authInstance) {
    return authInstance;
  }

  authInstance = getAuth(getFirebaseApp());
  return authInstance;
}

export function getFirestoreDb() {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = getFirestore(getFirebaseApp());
  return dbInstance;
}

export function getFirebaseStorage() {
  if (storageInstance) {
    return storageInstance;
  }

  storageInstance = getStorage(getFirebaseApp());
  return storageInstance;
}
