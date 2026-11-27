import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { BoslaLogo } from '../components/BoslaLogo';
import { MobileShell } from '../components/MobileShell';
import { OutlinedField } from '../components/OutlinedField';
import { backend, supabase } from '../lib/backend';
import { useApp } from '../context/AppContext';

const resetCodeExchangePromises = new Map<string, Promise<string | null>>();

export function ResetPasswordScreen() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { showToast } = useApp();
  const code = searchParams.get('code');

  const [exchangingCode, setExchangingCode] = useState<boolean>(Boolean(code && supabase));
  const [codeError, setCodeError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const client = supabase;
    if (!code || !client) return;
    let cancelled = false;

    const run = async () => {
      setExchangingCode(true);
      setCodeError(null);
      let promise = resetCodeExchangePromises.get(code);
      if (!promise) {
        promise = client.auth
          .exchangeCodeForSession(code)
          .then(({ error }) =>
            error
              ? 'تعذّر التحقق من رابط إعادة تعيين كلمة المرور — قد يكون منتهي الصلاحية أو مستخدماً من قبل.'
              : null,
          )
          .catch(() => 'حدث خطأ أثناء التحقق من الرابط — تحقق من الاتصال وحاول مجدداً.');
        resetCodeExchangePromises.set(code, promise);
      }
      const err = await promise;
      if (cancelled) return;
      setExchangingCode(false);
      if (err) {
        setCodeError(err);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [code]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextErr: { password?: string; confirm?: string } = {};
    if (password.length < 6) {
      nextErr.password = 'كلمة المرور يجب أن تكون 6 أحرف على الأقل';
    }
    if (password !== confirmPassword) {
      nextErr.confirm = 'كلمتا المرور غير متطابقتين';
    }
    setErrors(nextErr);
    if (Object.keys(nextErr).length > 0) return;

    setSubmitting(true);
    try {
      const res = await backend.updatePassword(password);
      if (!res.ok) {
        showToast(res.message, 'error');
        return;
      }
      setDone(true);
      showToast('تم تغيير كلمة المرور بنجاح', 'success');
      window.setTimeout(() => navigate('/login', { replace: true }), 1400);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MobileShell showBottomNav={false} bgTone="navy">
      <header className="shrink-0 bg-[#101D35] px-6 pt-8 pb-6 flex flex-col items-center text-center">
        <BoslaLogo size={52} variant="dark" />
        <h1 className="text-lg font-extrabold text-white mt-3">تعيين كلمة مرور جديدة</h1>
      </header>

      <div className="flex-1 bg-white rounded-t-[28px] px-5 pt-7 pb-8 text-[#101D35]">
        {exchangingCode ? (
          <div className="flex flex-col items-center text-center py-12">
            <Loader2 className="w-9 h-9 text-[#2878E8] animate-spin mb-3" />
            <h2 className="text-base font-bold mb-1">جاري التحقق من رابط الاستعادة…</h2>
            <p className="text-xs text-slate-500">يرجى الانتظار لحظة</p>
          </div>
        ) : codeError ? (
          <div className="flex flex-col items-center text-center py-10">
            <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mb-4">
              <AlertCircle className="w-9 h-9 text-red-600" />
            </div>
            <h2 className="text-lg font-bold mb-2">تعذّر فتح رابط الاستعادة</h2>
            <p className="text-xs text-slate-600 mb-6 max-w-[280px] leading-relaxed">{codeError}</p>
            <button
              type="button"
              onClick={() => navigate('/login', { replace: true })}
              className="w-full min-h-[48px] rounded-xl bg-[#2878E8] hover:bg-[#1E66CC] text-white font-bold text-sm"
            >
              العودة لتسجيل الدخول
            </button>
          </div>
        ) : done ? (
          <div className="flex flex-col items-center text-center py-10">
            <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-9 h-9 text-emerald-600" />
            </div>
            <h2 className="text-lg font-bold mb-1">تم تحديث كلمة المرور</h2>
            <p className="text-xs text-slate-500">جاري تحويلك لتسجيل الدخول…</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <OutlinedField
              id="newPass"
              label="كلمة المرور الجديدة"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="6 أحرف على الأقل"
              dir="ltr"
              error={errors.password}
              icon={<Lock className="w-4 h-4" />}
            />
            <OutlinedField
              id="confirmNewPass"
              label="تأكيد كلمة المرور الجديدة"
              type="password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              placeholder="أعد كتابة كلمة المرور"
              dir="ltr"
              error={errors.confirm}
              icon={<Lock className="w-4 h-4" />}
            />
            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[48px] rounded-xl bg-[#2878E8] hover:bg-[#1E66CC] disabled:opacity-65 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>جاري الحفظ…</span>
                </>
              ) : (
                <span>حفظ كلمة المرور</span>
              )}
            </button>
          </form>
        )}
      </div>
    </MobileShell>
  );
}
