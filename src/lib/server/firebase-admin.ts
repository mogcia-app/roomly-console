import { App, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

let adminApp: App | null = null;

type ServiceAccountConfig = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

function readServiceAccountJson(): ServiceAccountConfig | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as ServiceAccountConfig;
  } catch {
    throw new Error("invalid-service-account-json");
  }
}

function readPrivateKey() {
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? readServiceAccountJson()?.private_key;

  if (!privateKey) {
    throw new Error("missing-admin-private-key");
  }

  return privateKey.replace(/\\n/g, "\n");
}

function createAdminApp() {
  const serviceAccount = readServiceAccountJson();
  const projectId =
    process.env.FIREBASE_ADMIN_PROJECT_ID ?? serviceAccount?.project_id ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL ?? serviceAccount?.client_email;

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

export function getFirebaseAdminMessaging() {
  return getMessaging(getFirebaseAdminApp());
}
