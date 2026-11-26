import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { backend, onSessionExpired } from '../lib/backend';
import { initFirebaseServices, subscribeForegroundNotifications } from '../lib/firebase';
import type { AppSettings, UserProfile } from '../types';

export interface ToastMessage {
  id: number;
  text: string;
  tone: 'info' | 'success' | 'error';
}

interface AppContextValue {
  user: UserProfile | null;
  unverifiedEmail: string | null;
  settings: AppSettings;
  loadingAuth: boolean;
  toast: ToastMessage | null;
  showToast: (text: string, tone?: ToastMessage['tone']) => void;
  refreshProfile: () => Promise<UserProfile | null>;
  refreshSettings: () => Promise<AppSettings>;
  setUnverifiedEmail: (email: string | null) => void;
  clearSession: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

const DEFAULT_SETTINGS: AppSettings = {
  point_price_sdg: 50,
  gift_points: 20,
  admin_whatsapp: '249912345678',
};

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const showToast = useCallback((text: string, tone: ToastMessage['tone'] = 'info') => {
    const id = Date.now();
    setToast({ id, text, tone });
    window.setTimeout(() => {
      setToast((prev) => (prev?.id === id ? null : prev));
    }, 3800);
  }, []);

  const refreshSettings = useCallback(async () => {
    const next = await backend.getSettings();
    setSettings(next);
    return next;
  }, []);

  const refreshProfile = useCallback(async () => {
    try {
      const res = await backend.getCurrentProfile();
      setUser(res.user);
      setUnverifiedEmail(res.unverifiedEmail || null);
      return res.user;
    } catch (err) {
      setUser(null);
      if (err instanceof Error && err.message) {
        showToast(err.message, 'error');
      }
      return null;
    }
  }, [showToast]);

  const clearSession = useCallback(async () => {
    await backend.logout();
    setUser(null);
    setUnverifiedEmail(null);
  }, []);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      await initFirebaseServices();
      await Promise.all([refreshSettings(), refreshProfile()]);
      if (active) setLoadingAuth(false);
    }

    bootstrap();

    const unsubExpired = onSessionExpired((msg) => {
      setUser(null);
      showToast(msg, 'error');
    });

    const unsubFcm = subscribeForegroundNotifications(({ title, body }) => {
      showToast(body ? `${title}: ${body}` : title, 'success');
    });

    return () => {
      active = false;
      unsubExpired();
      unsubFcm();
    };
  }, [refreshProfile, refreshSettings, showToast]);

  return (
    <AppContext.Provider
      value={{
        user,
        unverifiedEmail,
        settings,
        loadingAuth,
        toast,
        showToast,
        refreshProfile,
        refreshSettings,
        setUnverifiedEmail,
        clearSession,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
