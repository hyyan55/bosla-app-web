import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';
import { MobileShell } from '../components/MobileShell';
import { useApp } from '../context/AppContext';

export function VerifiedScreen() {
  const navigate = useNavigate();
  const { refreshProfile, user } = useApp();

  useEffect(() => {
    refreshProfile();
  }, [refreshProfile]);

  return (
    <MobileShell showBottomNav={false}>
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center bg-white">
        <motion.div
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col items-center"
        >
          <div className="w-20 h-20 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mb-5">
            <CheckCircle2 className="w-11 h-11 text-emerald-600" />
          </div>
          <h1 className="text-2xl font-extrabold text-[#101D35] mb-2">
            تم تفعيل حسابك بنجاح
          </h1>
          <p className="text-sm text-slate-600 mb-7 max-w-[280px] leading-relaxed">
            أصبح بريدك الإلكتروني مفعّلاً الآن. يمكنك تسجيل الدخول والبدء ببناء تطبيقك الأول مع 20 نقطة هدية.
          </p>

          <button
            type="button"
            onClick={() => navigate(user ? '/chat' : '/login', { replace: true })}
            className="w-full min-w-[240px] min-h-[48px] rounded-xl bg-[#2878E8] hover:bg-[#1E66CC] text-white font-bold text-sm px-6 active:scale-[0.98] transition-all"
          >
            {user ? 'الدخول إلى البوت' : 'الانتقال لتسجيل الدخول'}
          </button>
        </motion.div>
      </div>
    </MobileShell>
  );
}
