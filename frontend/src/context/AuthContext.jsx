import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  getMe,
  login as loginRequest,
  logout as logoutRequest,
  register as registerRequest,
  resetPassword as resetRequest,
} from '../api/userService';
import { setUnauthorizedHandler, TOKEN_KEY } from '../api/client';

// Sign-in is email + password. The backend returns a session token per browser, kept here
// so the user stays signed in until they log out. Users never need to see or save it.
const USER_KEY = 'mom_user';
const AuthContext = createContext(null);

function readStoredUser() {
  try {
    return localStorage.getItem(TOKEN_KEY) ? JSON.parse(localStorage.getItem(USER_KEY)) : null;
  } catch {
    return null;
  }
}

const normEmail = (email) => email.trim().toLowerCase();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readStoredUser);

  const saveSession = useCallback((token, u) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(u));
    setUser(u);
  }, []);

  const clearSession = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }, []);

  /** Ends this browser's session on the server (best effort), then locally. */
  const logout = useCallback(async () => {
    if (localStorage.getItem(TOKEN_KEY)) {
      try {
        await logoutRequest();
      } catch {
        // Already invalid or offline: signing out locally is what matters.
      }
    }
    clearSession();
  }, [clearSession]);

  const register = useCallback(
    async (name, email, password) => {
      const { user: u, token } = await registerRequest(name.trim(), normEmail(email), password);
      saveSession(token, u);
      return u;
    },
    [saveSession],
  );

  const login = useCallback(
    async (email, password) => {
      const { user: u, token } = await loginRequest(normEmail(email), password);
      saveSession(token, u);
      return u;
    },
    [saveSession],
  );

  const resetPassword = useCallback(
    async (email, code, newPassword) => {
      const { user: u, token } = await resetRequest(normEmail(email), code.trim(), newPassword);
      saveSession(token, u);
      return u;
    },
    [saveSession],
  );

  /** Refresh the stored profile (e.g. after setting a password). */
  const updateUser = useCallback((u) => {
    localStorage.setItem(USER_KEY, JSON.stringify(u));
    setUser(u);
  }, []);

  // Accounts from before passwords existed: learn whether a password is set.
  useEffect(() => {
    if (user && user.hasPassword === undefined) getMe().then(updateUser).catch(() => {});
  }, [user, updateUser]);

  /** After POST /users/me/rotate-token the stored token must be replaced. */
  const replaceToken = useCallback((token) => localStorage.setItem(TOKEN_KEY, token), []);

  const getToken = useCallback(() => localStorage.getItem(TOKEN_KEY), []);

  // An invalid or revoked token (e.g. password reset elsewhere) ends the session locally.
  useEffect(() => {
    setUnauthorizedHandler(clearSession);
    return () => setUnauthorizedHandler(null);
  }, [clearSession]);

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: !!user,
      register,
      login,
      resetPassword,
      logout,
      updateUser,
      replaceToken,
      getToken,
    }),
    [user, register, login, resetPassword, logout, updateUser, replaceToken, getToken],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
