import { App, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

let adminApp: App | null = null;

function readPrivateKey() {
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;

  if (!privateKey) {
    throw new Error("missing-admin-private-key");
  }

  return privateKey.replace(/\\n/g, "\n");
}

function createAdminApp() {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;

  if (!projectId) {
    throw new Error("missing-admin-project-id");
  }

  if (!clientEmail) {
    throw new Error("missing-admin-client-email");
  }

  return initializeApp({
    credential: cert({
      clientEmail,
      privateKey: readPrivateKey(),
      projectId,
    }),
    projectId,
  });
}

export function getFirebaseAdminApp() {
  if (adminApp) {
    return adminApp;
  }

  adminApp = getApps()[0] ?? createAdminApp();
  return adminApp;
}

export function getFirebaseAdminAuth() {
  return getAuth(getFirebaseAdminApp());
}

export function getFirebaseAdminDb() {
  return getFirestore(getFirebaseAdminApp());
}
