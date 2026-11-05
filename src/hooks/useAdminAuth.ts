import { useState, useCallback } from 'react';

const STORAGE_KEY = 'admin_session_token';

export function useAdminAuth() {
  const [adminToken, setAdminToken] = useState<string>(
    () => localStorage.getItem(STORAGE_KEY) || ''
  );
  const [isPassConfigured, setIsPassConfigured] = useState(false);

  const setToken = useCallback((token: string) => {
    setAdminToken(token);
    if (token) {
      localStorage.setItem(STORAGE_KEY, token);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const logout = useCallback(() => {
    setAdminToken('');
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const isAdmin = !!adminToken;

  return {
    adminToken,
    isAdmin,
    isPassConfigured,
    setIsPassConfigured,
    setToken,
    logout,
  };
}
