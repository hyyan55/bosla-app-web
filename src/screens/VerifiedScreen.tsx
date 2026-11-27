import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { MobileShell } from '../components/MobileShell';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/backend';

const codeExchangePromises = new Map<string, Promise<string | null>>();

export function VerifiedScreen() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { refreshProfile, user } = useApp();
  const code = searchParams.get('code');

  const [verifying, setVerifying] = useState<boolean>(Boolean(code && supabase));
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (code && supabase) {
        setVerifying(true);
        setErrorMsg(null);
        let promise = codeExchangePromises.get(code);
        if (!promise) {
          promise = supabase.auth
            .exchangeCodeForSession(code)
            .then(({ error }) =>
              error
                ? 'تعذّر إتمام تفعيل البريد الإلكتروني — قد يكون الرابط منتهي الصلاحية أو مستخدماً من قبل.'
                : null,
            )
            .catch(() => 'حدث خطأ أثناء تأكيد التفعيل — تحقق من الاتصال وحاول مجدداً.');
          codeExchangePromises.set(code, promise);
        }
        const err = await promise;
        if (cancelled) return;
        setVerifying(false);
        if (err) {
          setErrorMsg(err);
          return;
        }
      }

      await refreshProfile();
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [code, refreshProfile]);

  return (
    <MobileShell showBottomNav={false}>
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center bg-white">
        {verifying ? (
          <div className="flex flex-col items-center">
            <Loader2 className="w-10 h-10 text-[#2878E8] animate-spin mb-4" />
            <h1 className="text-lg font-extrabold text-[#101D35] mb-1">
              جاري تأكيد تفعيل حسابك…
            </h1>
            <p className="text-xs text-slate-500">يرجى الانتظار لحظة</p>
          </div>
        ) : errorMsg ? (
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col items-center"
          >
            <div className="w-20 h-20 rounded-full bg-red-50 border border-red-200 flex items-center justify-center mb-5">
              <AlertCircle className="w-11 h-11 text-red-600" />
            </div>
            <h1 className="text-xl font-extrabold text-[#101D35] mb-2">
              تعذّر تفعيل الحساب
            </h1>
            <p className="text-sm text-slate-600 mb-7 max-w-[290px] leading-relaxed">
              {errorMsg}
            </p>
            <button
              type="button"
              onClick={() => navigate('/login', { replace: true })}
              className="w-full min-w-[240px] min-h-[48px] rounded-xl bg-[#2878E8] hover:bg-[#1E66CC] text-white font-bold text-sm px-6 active:scale-[0.98] transition-all"
            >
              الانتقال لتسجيل الدخول
            </button>
          </motion.div>
        ) : (
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
        )}
      </div>
    </MobileShell>
  );
}
