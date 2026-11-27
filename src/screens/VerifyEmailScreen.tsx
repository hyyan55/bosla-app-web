import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MailCheck, RefreshCw, ArrowRight, CheckCircle } from 'lucide-react';
import { MobileShell } from '../components/MobileShell';
import { BoslaLogo } from '../components/BoslaLogo';
import { backend } from '../lib/backend';
import { useApp } from '../context/AppContext';

export function VerifyEmailScreen() {
  const location = useLocation();
  const navigate = useNavigate();
  const { unverifiedEmail, showToast } = useApp();

  const stateEmail = (location.state as { email?: string } | null)?.email;
  const email = stateEmail || unverifiedEmail || backend.getPendingVerificationEmail() || '';

  const [countdown, setCountdown] = useState(60);
  const [resending, setResending] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    if (countdown <= 0) return;
    const id = window.setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, [countdown]);

  const handleResend = async () => {
    if (!email || countdown > 0 || resending) return;
    setResending(true);
    try {
      const res = await backend.resendVerification(email);
      showToast(res.message, res.ok ? 'success' : 'error');
      if (res.ok) setCountdown(60);
    } finally {
      setResending(false);
    }
  };

  const handleDemoVerify = async () => {
    if (!email) return;
    const ok = await backend.completeDemoVerification(email);
    if (ok) {
      navigate('/verified', { replace: true });
    } else {
      showToast('تعذّر إكمال التفعيل التجريبي', 'error');
    }
  };

  return (
    <MobileShell showBottomNav={false}>
      <div className="flex-1 flex flex-col justify-between px-6 py-8 overflow-y-auto bg-white">
        <div className="flex flex-col items-center text-center pt-2">
          <div className="mb-4">
            <BoslaLogo size={52} variant="light" />
          </div>
          {!imgFailed ? (
            <img
              src="/src/assets/images/verify_email_envelope_1795719417861.jpg"
              alt="التحقق من البريد الإلكتروني"
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
              className="w-40 h-40 object-contain rounded-3xl mb-5"
            />
          ) : (
            <div className="w-24 h-24 rounded-3xl bg-[#101D35] text-[#D5B45C] flex items-center justify-center mb-6">
              <MailCheck className="w-12 h-12" />
            </div>
          )}

          <h1 className="text-2xl font-extrabold text-[#101D35] mb-2">
            فعّل بريدك الإلكتروني
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed max-w-[300px]">
            أرسلنا رابط التفعيل إلى بريدك:
          </p>
          <p
            dir="ltr"
            className="mt-2 px-4 py-2 rounded-xl bg-slate-100 text-sm font-bold text-[#101D35] break-all"
          >
            {email || 'بريدك الإلكتروني'}
          </p>

          <div className="mt-5 w-full rounded-2xl bg-[#FFF9EB] border border-[#D5B45C]/40 px-4 py-3 text-xs text-[#7B5D12] leading-relaxed">
            افحص مجلد الرسائل غير المرغوب فيها (Spam) إذا لم تجد الرسالة في البريد الوارد.
          </div>
        </div>

        <div className="space-y-3 pt-6">
          <button
            type="button"
            onClick={handleResend}
            disabled={countdown > 0 || resending || !email}
            className="w-full min-h-[48px] rounded-xl bg-[#2878E8] hover:bg-[#1E66CC] disabled:bg-slate-200 disabled:text-slate-500 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
          >
            <RefreshCw className={`w-4 h-4 ${resending ? 'animate-spin' : ''}`} />
            <span>
              {countdown > 0
                ? `أعد إرسال رابط التفعيل (${countdown} ث)`
                : 'أعد إرسال رابط التفعيل'}
            </span>
          </button>

          {backend.isDemoMode && email && (
            <button
              type="button"
              onClick={handleDemoVerify}
              className="w-full min-h-[46px] rounded-xl border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 font-bold text-xs flex items-center justify-center gap-2 transition-colors"
            >
              <CheckCircle className="w-4 h-4 text-emerald-700" />
              <span>تفعيل البريد الآن (متابعة في وضع العرض)</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => navigate('/login', { replace: true })}
            className="w-full min-h-[46px] rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-[#101D35] font-bold text-sm flex items-center justify-center gap-2 transition-colors"
          >
            <ArrowRight className="w-4 h-4" />
            <span>رجوع لتسجيل الدخول</span>
          </button>
        </div>
      </div>
    </MobileShell>
  );
}
