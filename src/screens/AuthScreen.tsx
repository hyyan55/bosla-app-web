import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, User, AtSign, ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { BoslaLogo } from '../components/BoslaLogo';
import { MobileShell } from '../components/MobileShell';
import { OutlinedField } from '../components/OutlinedField';
import { backend } from '../lib/backend';
import { useApp } from '../context/AppContext';

type AuthMode = 'login' | 'signup';

interface FieldErrors {
  fullName?: string;
  username?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_REGEX = /^[a-zA-Z0-9._-]{3,}$/;

export function AuthScreen() {
  const { user, refreshProfile, setUnverifiedEmail, showToast } = useApp();
  const navigate = useNavigate();

  const [mode, setMode] = useState<AuthMode>('login');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Forgot password inline view
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotSuccess, setForgotSuccess] = useState<string | null>(null);
  const [sendingReset, setSendingReset] = useState(false);

  useEffect(() => {
    if (user) {
      navigate('/chat', { replace: true });
    }
  }, [user, navigate]);

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setFieldErrors({});
    setFormError(null);
  };

  const validate = (): boolean => {
    const errors: FieldErrors = {};

    if (mode === 'signup') {
      if (fullName.trim().length < 2) {
        errors.fullName = 'أدخل الاسم الكامل (حرفان على الأقل)';
      }
      if (!USERNAME_REGEX.test(username.trim())) {
        errors.username = 'اسم المستخدم 3 أحرف على الأقل (حروف إنجليزية أو أرقام أو . _ -)';
      }
    }

    if (!EMAIL_REGEX.test(email.trim())) {
      errors.email = 'أدخل بريداً إلكترونياً صحيحاً';
    }

    if (password.length < 6) {
      errors.password = 'كلمة المرور يجب أن تكون 6 أحرف على الأقل';
    }

    if (mode === 'signup' && password !== confirmPassword) {
      errors.confirmPassword = 'كلمتا المرور غير متطابقتين';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!validate()) return;

    setSubmitting(true);
    try {
      if (mode === 'login') {
        const res = await backend.login(email, password);
        if (!res.ok) {
          if (res.unverified) {
            setUnverifiedEmail(res.email || email.trim());
            setFormError('فعّل بريدك أولاً');
            showToast('فعّل بريدك أولاً', 'error');
            window.setTimeout(() => {
              navigate('/verify-email', { state: { email: res.email || email.trim() } });
            }, 900);
          } else {
            setFormError(res.message);
          }
          return;
        }
        await refreshProfile();
        showToast('أهلاً بك في بوصلة التطبيقات!', 'success');
        navigate('/chat', { replace: true });
      } else {
        const res = await backend.signup({
          fullName,
          username,
          email,
          password,
        });
        if (!res.ok) {
          if (res.message.includes('مسجّل بالفعل')) {
            setFieldErrors((prev) => ({ ...prev, email: res.message }));
          } else {
            setFormError(res.message);
          }
          return;
        }
        setUnverifiedEmail(res.email);
        showToast('تم إنشاء الحساب! فعّل بريدك الإلكتروني للمتابعة', 'success');
        navigate('/verify-email', { state: { email: res.email } });
      }
    } catch {
      setFormError('حدث خطأ في الاتصال — تأكد من الإنترنت وحاول مجدداً');
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError(null);
    setForgotSuccess(null);
    if (!EMAIL_REGEX.test(forgotEmail.trim())) {
      setForgotError('أدخل بريداً إلكترونياً صحيحاً');
      return;
    }
    setSendingReset(true);
    try {
      const res = await backend.requestPasswordReset(forgotEmail);
      if (!res.ok) {
        setForgotError(res.message);
      } else {
        setForgotSuccess(res.message);
      }
    } catch {
      setForgotError('تعذّر إرسال الرابط — حاول مرة أخرى');
    } finally {
      setSendingReset(false);
    }
  };

  return (
    <MobileShell showBottomNav={false} bgTone="navy">
      {/* Fixed Navy Header (NOT inside scroll view) */}
      <header className="shrink-0 bg-[#101D35] px-6 pt-7 pb-6 flex flex-col items-center text-center">
        <div className="p-1.5 rounded-2xl border border-[#D5B45C]/40 bg-white/5 mb-3">
          <BoslaLogo size={54} variant="white" />
        </div>
        <h1 className="text-xl font-extrabold text-white">بوصلة التطبيقات</h1>
        <p className="text-xs font-medium text-[#D5B45C] mt-1">
          ابنِ تطبيقك بوصف واحد.
        </p>
      </header>

      {/* Scrollable White Card */}
      <div className="flex-1 bg-white rounded-t-[28px] overflow-y-auto px-5 pt-6 pb-8 text-[#101D35] shadow-inner">
        {!forgotMode ? (
          <>
            {/* Mode Switcher */}
            <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-2xl mb-6">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className={`min-h-[44px] rounded-xl text-sm font-bold transition-all ${
                  mode === 'login'
                    ? 'bg-white text-[#101D35] shadow-sm'
                    : 'text-slate-500 hover:text-[#101D35]'
                }`}
              >
                تسجيل الدخول
              </button>
              <button
                type="button"
                onClick={() => switchMode('signup')}
                className={`min-h-[44px] rounded-xl text-sm font-bold transition-all ${
                  mode === 'signup'
                    ? 'bg-white text-[#101D35] shadow-sm'
                    : 'text-slate-500 hover:text-[#101D35]'
                }`}
              >
                حساب جديد
              </button>
            </div>

            {formError && (
              <div
                role="alert"
                className="mb-4 flex items-center gap-2.5 rounded-xl bg-red-50 border border-red-200 px-3.5 py-3 text-xs font-semibold text-red-800"
              >
                <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              <AnimatePresence initial={false}>
                {mode === 'signup' && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.18 }}
                    className="space-y-4"
                  >
                    <OutlinedField
                      id="fullName"
                      label="الاسم الكامل"
                      value={fullName}
                      onChange={(v) => {
                        setFullName(v);
                        if (fieldErrors.fullName) setFieldErrors((p) => ({ ...p, fullName: undefined }));
                      }}
                      placeholder="مثال: أحمد محمد علي"
                      error={fieldErrors.fullName}
                      icon={<User className="w-4 h-4" />}
                      autoComplete="name"
                    />
                    <OutlinedField
                      id="username"
                      label="اسم المستخدم"
                      value={username}
                      onChange={(v) => {
                        setUsername(v);
                        if (fieldErrors.username) setFieldErrors((p) => ({ ...p, username: undefined }));
                      }}
                      placeholder="ahmed_sd"
                      dir="ltr"
                      error={fieldErrors.username}
                      icon={<AtSign className="w-4 h-4" />}
                      autoComplete="username"
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              <OutlinedField
                id="email"
                label="البريد الإلكتروني"
                type="email"
                value={email}
                onChange={(v) => {
                  setEmail(v);
                  if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: undefined }));
                }}
                placeholder="name@example.com"
                dir="ltr"
                error={fieldErrors.email}
                icon={<Mail className="w-4 h-4" />}
                autoComplete="email"
              />

              <OutlinedField
                id="password"
                label="كلمة المرور"
                type="password"
                value={password}
                onChange={(v) => {
                  setPassword(v);
                  if (fieldErrors.password) setFieldErrors((p) => ({ ...p, password: undefined }));
                }}
                placeholder="6 أحرف على الأقل"
                dir="ltr"
                error={fieldErrors.password}
                icon={<Lock className="w-4 h-4" />}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />

              {mode === 'signup' && (
                <OutlinedField
                  id="confirmPassword"
                  label="تأكيد كلمة المرور"
                  type="password"
                  value={confirmPassword}
                  onChange={(v) => {
                    setConfirmPassword(v);
                    if (fieldErrors.confirmPassword) {
                      setFieldErrors((p) => ({ ...p, confirmPassword: undefined }));
                    }
                  }}
                  placeholder="أعد كتابة كلمة المرور"
                  dir="ltr"
                  error={fieldErrors.confirmPassword}
                  icon={<Lock className="w-4 h-4" />}
                  autoComplete="new-password"
                />
              )}

              {mode === 'login' && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setForgotMode(true);
                      setForgotEmail(email);
                      setForgotError(null);
                      setForgotSuccess(null);
                    }}
                    className="text-xs font-bold text-[#2878E8] hover:underline py-1"
                  >
                    نسيت كلمة المرور؟
                  </button>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[50px] rounded-xl bg-[#2878E8] hover:bg-[#1E66CC] disabled:opacity-65 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-sm shadow-[#2878E8]/25 active:scale-[0.98] transition-all mt-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{mode === 'login' ? 'جاري الدخول…' : 'جاري إنشاء الحساب…'}</span>
                  </>
                ) : (
                  <span>{mode === 'login' ? 'دخول' : 'إنشاء حساب مجاني'}</span>
                )}
              </button>
            </form>

            {mode === 'signup' && (
              <p className="mt-4 text-center text-xs text-slate-500 leading-relaxed">
                عند تفعيل حسابك تحصل تلقائياً على محفظة برقم خاص و{' '}
                <span className="font-bold text-[#101D35]">20 نقطة هدية</span> للبدء.
              </p>
            )}
          </>
        ) : (
          <div>
            <button
              type="button"
              onClick={() => setForgotMode(false)}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-[#101D35] mb-4 min-h-[36px]"
            >
              <ArrowRight className="w-4 h-4" />
              <span>رجوع لتسجيل الدخول</span>
            </button>

            <h2 className="text-lg font-extrabold text-[#101D35] mb-1">
              استعادة كلمة المرور
            </h2>
            <p className="text-xs text-slate-500 mb-5 leading-relaxed">
              أدخل بريدك الإلكتروني المسجّل وسنرسل لك رابطاً لتعيين كلمة مرور جديدة.
            </p>

            {forgotError && (
              <div className="mb-4 rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs font-semibold text-red-700">
                {forgotError}
              </div>
            )}
            {forgotSuccess && (
              <div className="mb-4 rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-3 text-xs font-semibold text-emerald-800 space-y-2">
                <p>{forgotSuccess}</p>
                {backend.isDemoMode && (
                  <button
                    type="button"
                    onClick={() => navigate('/reset-password')}
                    className="inline-block font-bold text-[#2878E8] underline"
                  >
                    فتح صفحة إعادة التعيين الآن
                  </button>
                )}
              </div>
            )}

            <form onSubmit={handleForgotSubmit} noValidate className="space-y-4">
              <OutlinedField
                id="forgotEmail"
                label="البريد الإلكتروني"
                type="email"
                value={forgotEmail}
                onChange={setForgotEmail}
                placeholder="name@example.com"
                dir="ltr"
                icon={<Mail className="w-4 h-4" />}
              />
              <button
                type="submit"
                disabled={sendingReset}
                className="w-full min-h-[48px] rounded-xl bg-[#2878E8] hover:bg-[#1E66CC] disabled:opacity-65 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
              >
                {sendingReset ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>جاري الإرسال…</span>
                  </>
                ) : (
                  <span>إرسال رابط الاستعادة</span>
                )}
              </button>
            </form>
          </div>
        )}

        <div className="mt-8 pt-4 border-t border-slate-100 flex justify-center">
          <button
            type="button"
            onClick={() => navigate('/admin')}
            className="text-[11px] font-medium text-slate-400 hover:text-[#101D35] transition-colors py-1 px-2"
          >
            دخول المسؤول
          </button>
        </div>
      </div>
    </MobileShell>
  );
}
