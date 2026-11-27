import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LogOut,
  KeyRound,
  Bell,
  ExternalLink,
  Loader2,
  ChevronLeft,
} from 'lucide-react';
import { MobileShell } from '../components/MobileShell';
import { BoslaLogo } from '../components/BoslaLogo';
import { OutlinedField } from '../components/OutlinedField';
import { backend } from '../lib/backend';
import { requestPushPermission } from '../lib/firebase';
import { useApp } from '../context/AppContext';

export function ProfileScreen() {
  const { user, clearSession, showToast } = useApp();
  const navigate = useNavigate();

  // Password change drawer
  const [showPassForm, setShowPassForm] = useState(false);
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [passErr, setPassErr] = useState<string | undefined>();
  const [savingPass, setSavingPass] = useState(false);

  const [enablingPush, setEnablingPush] = useState(false);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPass.length < 6) {
      setPassErr('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return;
    }
    if (newPass !== confirmPass) {
      setPassErr('كلمتا المرور غير متطابقتين');
      return;
    }
    setPassErr(undefined);
    setSavingPass(true);
    try {
      const res = await backend.updatePassword(newPass);
      showToast(res.message, res.ok ? 'success' : 'error');
      if (res.ok) {
        setShowPassForm(false);
        setNewPass('');
        setConfirmPass('');
      }
    } finally {
      setSavingPass(false);
    }
  };

  const handleEnablePush = async () => {
    setEnablingPush(true);
    try {
      const res = await requestPushPermission();
      if (res.granted) {
        showToast('تم تفعيل إشعارات التطبيق بنجاح', 'success');
      } else {
        showToast(res.reason || 'تعذّر تفعيل الإشعارات', 'error');
      }
    } finally {
      setEnablingPush(false);
    }
  };

  const handleLogout = async () => {
    await clearSession();
    showToast('تم تسجيل الخروج', 'info');
    navigate('/login', { replace: true });
  };

  return (
    <MobileShell>
      {/* Header */}
      <header className="shrink-0 bg-[#101D35] text-white px-5 py-3.5 flex items-center gap-2.5">
        <BoslaLogo size={32} variant="dark" />
        <h1 className="text-base font-extrabold">حسابي والإعدادات</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* User Summary Card */}
        <section className="rounded-3xl bg-white border border-slate-200 p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#101D35] text-[#D5B45C] flex items-center justify-center text-lg font-extrabold shrink-0">
              {(user?.full_name || 'م').charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-extrabold text-[#101D35] truncate">
                {user?.full_name || 'مستخدم بوصلة'}
              </h2>
              <p dir="ltr" className="text-xs text-slate-500 truncate text-right">
                @{user?.username || 'user'}
              </p>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500">البريد الإلكتروني</span>
              <span dir="ltr" className="font-bold text-[#101D35] truncate">
                {user?.email || '—'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500">رقم المحفظة</span>
              <span dir="ltr" className="font-extrabold text-[#2878E8] tabular-nums">
                {user?.wallet_number || 'BOS-—'}
              </span>
            </div>
          </div>
        </section>

        {/* Actions Card */}
        <section className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100 overflow-hidden">
          {/* Change Password */}
          <div>
            <button
              type="button"
              onClick={() => setShowPassForm((p) => !p)}
              className="w-full min-h-[52px] px-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <KeyRound className="w-4 h-4 text-[#2878E8]" />
                <span className="text-sm font-bold text-[#101D35]">تغيير كلمة المرور</span>
              </div>
              <ChevronLeft
                className={`w-4 h-4 text-slate-400 transition-transform ${
                  showPassForm ? '-rotate-90' : ''
                }`}
              />
            </button>
            {showPassForm && (
              <form
                onSubmit={handlePasswordChange}
                className="px-4 pb-4 pt-2 bg-slate-50 space-y-3 border-t border-slate-100"
              >
                <OutlinedField
                  id="profileNewPass"
                  label="كلمة المرور الجديدة"
                  type="password"
                  value={newPass}
                  onChange={setNewPass}
                  dir="ltr"
                  placeholder="6 أحرف على الأقل"
                />
                <OutlinedField
                  id="profileConfirmPass"
                  label="تأكيد كلمة المرور"
                  type="password"
                  value={confirmPass}
                  onChange={setConfirmPass}
                  dir="ltr"
                  error={passErr}
                  placeholder="أعد كتابة كلمة المرور"
                />
                <button
                  type="submit"
                  disabled={savingPass}
                  className="w-full min-h-[44px] rounded-xl bg-[#2878E8] text-white font-bold text-xs flex items-center justify-center gap-2"
                >
                  {savingPass && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>حفظ كلمة المرور الجديدة</span>
                </button>
              </form>
            )}
          </div>

          {/* Push Notifications */}
          <button
            type="button"
            onClick={handleEnablePush}
            disabled={enablingPush}
            className="w-full min-h-[52px] px-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Bell className="w-4 h-4 text-[#2878E8]" />
              <span className="text-sm font-bold text-[#101D35]">تفعيل إشعارات الجاهزية</span>
            </div>
            <ChevronLeft className="w-4 h-4 text-slate-400" />
          </button>

          {/* Academy Link */}
          <a
            href="https://boslaacademy.com"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full min-h-[52px] px-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <ExternalLink className="w-4 h-4 text-[#2878E8]" />
              <span className="text-sm font-bold text-[#101D35]">موقع أكاديمية بوصلة</span>
            </div>
            <span dir="ltr" className="text-xs text-slate-400">
              boslaacademy.com
            </span>
          </a>
        </section>

        {/* Logout */}
        <button
          type="button"
          onClick={handleLogout}
          className="w-full min-h-[48px] rounded-2xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 font-bold text-sm flex items-center justify-center gap-2 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          <span>تسجيل الخروج</span>
        </button>

        <p className="text-center text-[11px] text-slate-400 pt-1">
          بوصلة التطبيقات · الإصدار 1.0.0
        </p>
      </div>
    </MobileShell>
  );
}
