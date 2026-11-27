import React, { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { AppProvider, useApp } from './context/AppContext';
import { SplashScreen } from './screens/SplashScreen';
import { AuthScreen } from './screens/AuthScreen';
import { VerifyEmailScreen } from './screens/VerifyEmailScreen';
import { VerifiedScreen } from './screens/VerifiedScreen';
import { ResetPasswordScreen } from './screens/ResetPasswordScreen';
import { ChatScreen } from './screens/ChatScreen';
import { WalletScreen } from './screens/WalletScreen';
import { TopupScreen } from './screens/TopupScreen';
import { BuildsScreen } from './screens/BuildsScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { AdminPanel } from './admin/AdminPanel';
import { MobileShell } from './components/MobileShell';

function DeepLinkListener() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const handleUrl = (rawUrl?: string | null) => {
      if (!rawUrl) return;
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== 'boslaapp:') return;
        const target = parsed.hostname || parsed.pathname.replace(/^\/+/, '');
        if (target === 'verified' || target === 'reset-password') {
          navigate(`/${target}${parsed.search}${parsed.hash}`, { replace: true });
        }
      } catch {
        if (rawUrl.startsWith('boslaapp://verified')) {
          const idx = rawUrl.indexOf('?');
          navigate(`/verified${idx >= 0 ? rawUrl.slice(idx) : ''}`, { replace: true });
        } else if (rawUrl.startsWith('boslaapp://reset-password')) {
          const idx = rawUrl.indexOf('?');
          navigate(`/reset-password${idx >= 0 ? rawUrl.slice(idx) : ''}`, { replace: true });
        }
      }
    };

    const listenerPromise = CapacitorApp.addListener('appUrlOpen', ({ url }) => {
      handleUrl(url);
    });

    CapacitorApp.getLaunchUrl()
      .then((launch) => handleUrl(launch?.url))
      .catch(() => undefined);

    return () => {
      listenerPromise.then((handle) => handle.remove()).catch(() => undefined);
    };
  }, [navigate]);

  return null;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, unverifiedEmail, loadingAuth } = useApp();

  if (loadingAuth) {
    return (
      <MobileShell showBottomNav={false} bgTone="navy">
        <div className="flex-1 flex items-center justify-center">
          <span className="w-7 h-7 border-2 border-[#D5B45C] border-t-transparent rounded-full animate-spin" />
        </div>
      </MobileShell>
    );
  }

  if (!user) {
    if (unverifiedEmail) {
      return <Navigate to="/verify-email" replace state={{ email: unverifiedEmail }} />;
    }
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <DeepLinkListener />
        <Routes>
          <Route path="/" element={<SplashScreen />} />
          <Route path="/login" element={<AuthScreen />} />
          <Route path="/verify-email" element={<VerifyEmailScreen />} />
          <Route path="/verified" element={<VerifiedScreen />} />
          <Route path="/reset-password" element={<ResetPasswordScreen />} />

          <Route
            path="/chat"
            element={
              <ProtectedRoute>
                <ChatScreen />
              </ProtectedRoute>
            }
          />
          <Route
            path="/wallet"
            element={
              <ProtectedRoute>
                <WalletScreen />
              </ProtectedRoute>
            }
          />
          <Route
            path="/topup"
            element={
              <ProtectedRoute>
                <TopupScreen />
              </ProtectedRoute>
            }
          />
          <Route
            path="/builds"
            element={
              <ProtectedRoute>
                <BuildsScreen />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <ProfileScreen />
              </ProtectedRoute>
            }
          />

          <Route path="/admin/*" element={<AdminPanel />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}
