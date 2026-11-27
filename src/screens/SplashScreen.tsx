import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { BoslaLogo } from '../components/BoslaLogo';
import { MobileShell } from '../components/MobileShell';
import { useApp } from '../context/AppContext';

export function SplashScreen() {
  const { user, unverifiedEmail, loadingAuth } = useApp();
  const navigate = useNavigate();

  useEffect(() => {
    if (loadingAuth) return;
    const timer = window.setTimeout(() => {
      if (user) {
        navigate('/chat', { replace: true });
      } else if (unverifiedEmail) {
        navigate('/verify-email', { replace: true, state: { email: unverifiedEmail } });
      } else {
        navigate('/login', { replace: true });
      }
    }, 850);
    return () => window.clearTimeout(timer);
  }, [loadingAuth, user, unverifiedEmail, navigate]);

  return (
    <MobileShell showBottomNav={false} bgTone="navy">
      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center relative overflow-hidden">
        {/* Subtle radial glow */}
        <div
          className="absolute inset-0 pointer-events-none opacity-40"
          style={{
            background:
              'radial-gradient(circle at 50% 42%, rgba(40, 120, 232, 0.35), transparent 62%)',
          }}
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.88 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="relative z-10 flex flex-col items-center"
        >
          <div className="p-2 rounded-[26px] border border-[#D5B45C]/40 bg-white/5 shadow-2xl mb-6">
            <BoslaLogo size={84} variant="dark" />
          </div>

          <h1 className="text-3xl font-extrabold text-white tracking-tight mb-2">
            بوصلة التطبيقات
          </h1>
          <p className="text-sm font-medium text-[#D5B45C]">
            ابنِ تطبيقك بوصف واحد.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35 }}
          className="absolute bottom-12 flex items-center gap-2 text-xs text-slate-300"
        >
          <span className="w-4 h-4 border-2 border-[#D5B45C] border-t-transparent rounded-full animate-spin" />
          <span>جاري تجهيز مساحتك…</span>
        </motion.div>
      </div>
    </MobileShell>
  );
}
