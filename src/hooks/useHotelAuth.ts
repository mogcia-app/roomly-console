"use client";

import { useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
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

const LOCAL_MANUAL_LOGIN_KEY = "roomly-console:local-manual-login";

export function useHotelAuth() {
  const [state, setState] = useState<AuthState>(initialState);

  useEffect(() => {
    const auth = getFirebaseAuth();
    const isLocalhost = typeof window !== "undefined" && window.location.hostname === "localhost";
    let forceLogoutPending = false;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        forceLogoutPending = false;
        setState({
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
          void fetch("/api/auth/sync-user", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token.token}`,
            },
          });
        }

        setState({
          user,
          claims: {
            hotel_id: hotelId,
            role,
          },
          isLoading: false,
          error: null,
        });
      } catch (error) {
        setState({
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
    await signInWithEmailAndPassword(auth, email, password);
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
