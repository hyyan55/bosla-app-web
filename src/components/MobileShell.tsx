import React from 'react';
import { NavLink } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { MessageSquareText, Wallet, Smartphone, UserRound, AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { backend } from '../lib/backend';
import { useApp } from '../context/AppContext';

interface MobileShellProps {
  children: React.ReactNode;
  showBottomNav?: boolean;
  bgTone?: 'canvas' | 'navy';
}

const NAV_ITEMS = [
  { to: '/chat', label: 'البوت', icon: MessageSquareText },
  { to: '/wallet', label: 'المحفظة', icon: Wallet },
  { to: '/builds', label: 'تطبيقاتي', icon: Smartphone },
  { to: '/profile', label: 'حسابي', icon: UserRound },
];

export function MobileShell({
  children,
  showBottomNav = true,
  bgTone = 'canvas',
}: MobileShellProps) {
  const { toast } = useApp();
  const isNative = Capacitor.isNativePlatform();

  return (
    <div className="min-h-dvh w-full bg-[#E6ECF5] flex justify-center items-stretch sm:py-4 sm:px-4">
      <div
        className={`relative w-full max-w-[430px] min-h-dvh sm:min-h-[calc(100dvh-2rem)] sm:max-h-[900px] sm:rounded-[34px] sm:shadow-[0_24px_70px_-15px_rgba(16,29,53,0.28)] sm:border sm:border-slate-300/80 overflow-hidden flex flex-col ${
          bgTone === 'navy' ? 'bg-[#101D35] text-white' : 'bg-[#F5F7FB] text-[#101D35]'
        }`}
      >
        {/* Safe-area top inset so app headers never overlap the Android status bar */}
        <div
          aria-hidden="true"
          className={`shrink-0 bg-[#101D35] ${
            isNative
              ? 'pt-[max(env(safe-area-inset-top),28px)]'
              : 'pt-[max(env(safe-area-inset-top),24px)] sm:pt-0'
          }`}
        />

        {/* Honest Demo Banner when Supabase is not configured */}
        {backend.isDemoMode && bgTone === 'canvas' && (
          <div className="bg-[#FFF9EB] border-b border-[#D5B45C]/40 px-3 py-1.5 text-[11px] font-medium text-[#7B5D12] flex items-center justify-center gap-1.5 text-center shrink-0">
            <Info className="w-3.5 h-3.5 shrink-0 text-[#B8922E]" />
            <span>وضع العرض — اربط Supabase من الإعدادات لتفعيل البيانات الحقيقية</span>
          </div>
        )}

        {/* Toast Notification Overlay */}
        <AnimatePresence>
          {toast && (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: -16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.2 }}
              className={`absolute left-3 right-3 z-50 pointer-events-none flex justify-center ${
                isNative
                  ? 'top-[calc(max(env(safe-area-inset-top),28px)+0.5rem)]'
                  : 'top-[calc(max(env(safe-area-inset-top),24px)+0.5rem)] sm:top-3'
              }`}
            >
              <div
                className={`pointer-events-auto flex items-center gap-2 px-4 py-2.5 rounded-2xl shadow-lg text-xs font-semibold border max-w-full ${
                  toast.tone === 'error'
                    ? 'bg-red-50 text-red-900 border-red-200'
                    : toast.tone === 'success'
                      ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                      : 'bg-[#101D35] text-white border-[#101D35]'
                }`}
              >
                {toast.tone === 'error' ? (
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                ) : toast.tone === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                ) : (
                  <Info className="w-4 h-4 shrink-0 text-[#D5B45C]" />
                )}
                <span className="leading-snug">{toast.text}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Screen Body */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">{children}</div>

        {/* Native Bottom Navigation */}
        {showBottomNav && (
          <nav
            aria-label="التنقل الرئيسي"
            className="shrink-0 bg-white border-t border-slate-200/90 px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] z-30"
          >
            <div className="grid grid-cols-4 gap-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      `min-h-[48px] flex flex-col items-center justify-center rounded-xl transition-colors ${
                        isActive
                          ? 'text-[#2878E8] bg-[#2878E8]/8 font-bold'
                          : 'text-slate-500 hover:text-[#101D35] font-medium'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon
                          className={`w-[21px] h-[21px] transition-transform ${
                            isActive ? 'scale-105 stroke-[2.3]' : 'stroke-[1.9]'
                          }`}
                        />
                        <span className="text-[11px] mt-0.5 leading-none whitespace-nowrap">
                          {item.label}
                        </span>
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </nav>
        )}
      </div>
    </div>
  );
}
