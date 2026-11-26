import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
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
