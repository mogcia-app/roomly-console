"use client";

import { useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type AuthError,
  type User,
} from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase";

export type HotelAuthClaims = {
  hotel_id?: string;
  role?: string;
};

type AuthState = {
  user: User | null;
  claims: HotelAuthClaims | null;
  isLoading: boolean;
  error: string | null;
};

const initialState: AuthState = {
  user: null,
  claims: null,
  isLoading: true,
  error: null,
};

let authStateCache: AuthState = initialState;

const LOCAL_MANUAL_LOGIN_KEY = "roomly-console:local-manual-login";

function getLoginErrorMessage(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? (error as AuthError).code : "";

  switch (code) {
    case "auth/invalid-credential":
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-email":
      return "メールアドレスまたはパスワードが違います";
    case "auth/too-many-requests":
      return "ログイン試行回数が多すぎます。しばらくしてから再試行してください";
    default:
      return error instanceof Error ? error.message : "login-failed";
  }
}

export function useHotelAuth() {
  const [state, setState] = useState<AuthState>(authStateCache);

  function updateState(nextState: AuthState) {
    authStateCache = nextState;
    setState(nextState);
  }

  useEffect(() => {
    const auth = getFirebaseAuth();
    const isLocalhost = typeof window !== "undefined" && window.location.hostname === "localhost";
    let forceLogoutPending = false;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        forceLogoutPending = false;
        updateState({
          user: null,
          claims: null,
          isLoading: false,
          error: null,
        });
        return;
      }

      if (isLocalhost && window.sessionStorage.getItem(LOCAL_MANUAL_LOGIN_KEY) !== "allowed") {
        forceLogoutPending = true;
        await signOut(auth);
        return;
      }

      if (forceLogoutPending) {
        return;
      }

      try {
        const token = await user.getIdTokenResult(true);
        const role = typeof token.claims.role === "string" ? token.claims.role : undefined;
        const hotelId = typeof token.claims.hotel_id === "string" ? token.claims.hotel_id : undefined;

        if (role && hotelId && (role === "hotel_admin" || role === "hotel_front")) {
          const syncUserProfile = async () => {
            try {
              const response = await fetch("/api/auth/sync-user", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token.token}`,
                },
              });

              if (!response.ok && !isLocalhost) {
                throw new Error(`sync-user-failed:${response.status}`);
              }
            } catch (error) {
              if (!isLocalhost) {
                throw error;
              }

              console.debug("sync-user skipped on localhost", error);
            }
          };

          void syncUserProfile();
        }

        updateState({
          user,
          claims: {
            hotel_id: hotelId,
            role,
          },
          isLoading: false,
          error: null,
        });
      } catch (error) {
        updateState({
          user,
          claims: null,
          isLoading: false,
          error: error instanceof Error ? error.message : "failed-to-load-claims",
        });
      }
    });

    return unsubscribe;
  }, []);

  async function login(email: string, password: string) {
    const auth = getFirebaseAuth();
    if (typeof window !== "undefined" && window.location.hostname === "localhost") {
      window.sessionStorage.setItem(LOCAL_MANUAL_LOGIN_KEY, "allowed");
    }
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      throw new Error(getLoginErrorMessage(error));
    }
  }

  async function logout() {
    const auth = getFirebaseAuth();
    if (typeof window !== "undefined" && window.location.hostname === "localhost") {
      window.sessionStorage.removeItem(LOCAL_MANUAL_LOGIN_KEY);
    }
    await signOut(auth);
  }

  return {
    ...state,
    login,
    logout,
  };
}
