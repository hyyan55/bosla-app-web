import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Wallet,
  CreditCard,
  History,
  Settings as SettingsIcon,
  Check,
  X,
  Plus,
  Minus,
  LogOut,
  Loader2,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react';
import { BoslaLogo } from '../components/BoslaLogo';
import { OutlinedField } from '../components/OutlinedField';
import { backend, TOPUP_METHOD_LABELS } from '../lib/backend';
import { useApp } from '../context/AppContext';
import type { AppSettings, PointsTransaction, TopupRequest, UserProfile } from '../types';

type AdminTab = 'wallets' | 'topups' | 'transactions' | 'settings';

const TX_LABELS: Record<string, string> = {
  gift: 'هدية ترحيبية',
  topup: 'شحن رصيد',
  build_debit: 'خصم بناء',
  refund: 'استرداد تلقائي',
  admin_credit: 'شحن إداري',
  admin_debit: 'خصم إداري',
};

const ADMIN_SESSION_KEY = 'bosla_admin_session_active';

export function AdminPanel() {
  const { settings, refreshProfile, refreshSettings, showToast } = useApp();
  const navigate = useNavigate();

  // Admin gate state
  const [adminAuthed, setAdminAuthed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(ADMIN_SESSION_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  // Change admin password state
  const [currentAdminPass, setCurrentAdminPass] = useState('');
  const [newAdminPass, setNewAdminPass] = useState('');
  const [confirmAdminPass, setConfirmAdminPass] = useState('');
  const [adminPassError, setAdminPassError] = useState<string | null>(null);
  const [adminPassSuccess, setAdminPassSuccess] = useState<string | null>(null);
  const [changingAdminPass, setChangingAdminPass] = useState(false);

  // Dashboard tabs
  const [tab, setTab] = useState<AdminTab>('wallets');
  const [loadingData, setLoadingData] = useState(false);

  // Wallets
  const [searchQuery, setSearchQuery] = useState('');
  const [wallets, setWallets] = useState<UserProfile[]>([]);
  const [adjustTarget, setAdjustTarget] = useState<UserProfile | null>(null);
  const [adjustMode, setAdjustMode] = useState<'credit' | 'debit'>('credit');
  const [adjustPoints, setAdjustPoints] = useState<number>(100);
  const [adjustReason, setAdjustReason] = useState('');
  const [adjusting, setAdjusting] = useState(false);

  // Top-ups
  const [topups, setTopups] = useState<TopupRequest[]>([]);
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  // Transactions
  const [transactions, setTransactions] = useState<PointsTransaction[]>([]);

  // Settings form
  const [settingsForm, setSettingsForm] = useState<AppSettings>(settings);
  const [savingSettings, setSavingSettings] = useState(false);

  const isAuthorizedAdmin = adminAuthed;

  useEffect(() => {
    setSettingsForm(settings);
  }, [settings]);

  const loadTabData = useCallback(async () => {
    if (!isAuthorizedAdmin) return;
    setLoadingData(true);
    try {
      if (tab === 'wallets') {
        const res = await backend.adminSearchWallets(searchQuery);
        setWallets(res);
      } else if (tab === 'topups') {
        const res = await backend.adminListTopupRequests();
        setTopups(res);
      } else if (tab === 'transactions') {
        const res = await backend.adminListAllTransactions();
        setTransactions(res);
      } else if (tab === 'settings') {
        const s = await refreshSettings();
        setSettingsForm(s);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذّر تحميل البيانات', 'error');
    } finally {
      setLoadingData(false);
    }
  }, [isAuthorizedAdmin, tab, searchQuery, refreshSettings, showToast]);

  useEffect(() => {
    loadTabData();
  }, [loadTabData]);

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setLoggingIn(true);
    try {
      const res = await backend.adminLoginWithCredentials(adminUsername, adminPassword);
      if (!res.ok) {
        setAuthError('بيانات الدخول غير صحيحة');
        return;
      }
      try {
        sessionStorage.setItem(ADMIN_SESSION_KEY, '1');
      } catch {
        // ignore storage restrictions
      }
      setAdminAuthed(true);
      setAdminPassword('');
      showToast('مرحباً بك في لوحة الإدارة', 'success');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleAdminLogout = () => {
    backend.adminLogout();
    try {
      sessionStorage.removeItem(ADMIN_SESSION_KEY);
    } catch {
      // ignore
    }
    setAdminAuthed(false);
    setAdminUsername('');
    setAdminPassword('');
    showToast('تم تسجيل خروج المسؤول', 'info');
    navigate('/login', { replace: true });
  };

  const handleChangeAdminPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminPassError(null);
    setAdminPassSuccess(null);

    if (!currentAdminPass) {
      setAdminPassError('أدخل كلمة السر الحالية');
      return;
    }
    if (newAdminPass.length < 6) {
      setAdminPassError('كلمة السر الجديدة يجب أن تكون 6 أحرف على الأقل');
      return;
    }
    if (newAdminPass !== confirmAdminPass) {
      setAdminPassError('كلمتا السر غير متطابقتين');
      return;
    }

    setChangingAdminPass(true);
    try {
      const res = await backend.adminChangePassword({
        currentPassword: currentAdminPass,
        newPassword: newAdminPass,
      });
      if (!res.ok) {
        setAdminPassError(res.message);
        return;
      }
      setAdminPassSuccess(res.message);
      setCurrentAdminPass('');
      setNewAdminPass('');
      setConfirmAdminPass('');
      showToast(res.message, 'success');
    } finally {
      setChangingAdminPass(false);
    }
  };

  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustTarget || adjustPoints <= 0) return;

    setAdjusting(true);
    try {
      const delta = adjustMode === 'credit' ? adjustPoints : -adjustPoints;
      const res = await backend.adminAdjustPoints({
        userId: adjustTarget.id,
        delta,
        reason: adjustReason,
      });
      showToast(res.message, res.ok ? 'success' : 'error');
      if (res.ok) {
        setAdjustTarget(null);
        setAdjustReason('');
        await Promise.all([loadTabData(), refreshProfile()]);
      }
    } finally {
      setAdjusting(false);
    }
  };

  const handleReviewTopup = async (requestId: string, approve: boolean) => {
    setReviewingId(requestId);
    try {
      const res = await backend.adminReviewTopup({
        requestId,
        approve,
        note: noteById[requestId],
      });
      showToast(res.message, res.ok ? 'success' : 'error');
      if (res.ok) {
        await Promise.all([loadTabData(), refreshProfile()]);
      }
    } finally {
      setReviewingId(null);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (settingsForm.point_price_sdg <= 0) {
      showToast('سعر النقطة يجب أن يكون أكبر من صفر', 'error');
      return;
    }
    setSavingSettings(true);
    try {
      const res = await backend.adminUpdateSettings(settingsForm);
      showToast(res.message, res.ok ? 'success' : 'error');
      if (res.ok) await refreshSettings();
    } finally {
      setSavingSettings(false);
    }
  };

  // Admin Login Gate
  if (!isAuthorizedAdmin) {
    return (
      <div className="min-h-dvh bg-[#F5F7FB] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-lg overflow-hidden">
          <div className="bg-[#101D35] px-6 py-6 text-center text-white">
            <div className="inline-flex p-1.5 rounded-2xl border border-[#D5B45C]/40 bg-white/5 mb-3">
              <BoslaLogo size={48} variant="dark" />
            </div>
            <h1 className="text-lg font-extrabold">دخول المسؤول</h1>
            <p className="text-xs text-[#D5B45C] mt-1">لوحة إدارة بوصلة التطبيقات</p>
          </div>

          <form onSubmit={handleAdminLogin} className="p-6 space-y-4">
            {authError && (
              <div
                role="alert"
                className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs font-bold text-red-800"
              >
                {authError}
              </div>
            )}

            <OutlinedField
              id="adminUsername"
              label="اسم المستخدم"
              type="text"
              value={adminUsername}
              onChange={(v) => {
                setAdminUsername(v);
                if (authError) setAuthError(null);
              }}
              dir="ltr"
              placeholder="admin"
              autoComplete="username"
            />
            <OutlinedField
              id="adminPassword"
              label="كلمة السر"
              type="password"
              value={adminPassword}
              onChange={(v) => {
                setAdminPassword(v);
                if (authError) setAuthError(null);
              }}
              dir="ltr"
              placeholder="••••••"
              autoComplete="current-password"
            />

            <button
              type="submit"
              disabled={loggingIn}
              className="w-full min-h-[48px] rounded-xl bg-[#2878E8] hover:bg-[#1E66CC] text-white font-bold text-sm flex items-center justify-center gap-2"
            >
              {loggingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              <span>دخول</span>
            </button>

            <button
              type="button"
              onClick={() => navigate('/login')}
              className="w-full min-h-[42px] rounded-xl border border-slate-200 text-xs font-bold text-[#101D35] hover:bg-slate-50"
            >
              رجوع لتسجيل الدخول
            </button>
          </form>
        </div>
      </div>
    );
  }

  const navItems: Array<{ id: AdminTab; label: string; icon: React.ReactNode }> = [
    { id: 'wallets', label: 'المحافظ والمستخدمون', icon: <Wallet className="w-4 h-4" /> },
    { id: 'topups', label: 'طلبات الشحن', icon: <CreditCard className="w-4 h-4" /> },
    { id: 'transactions', label: 'سجل المعاملات', icon: <History className="w-4 h-4" /> },
    { id: 'settings', label: 'إعدادات النظام', icon: <SettingsIcon className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-dvh bg-[#F5F7FB] text-[#101D35] flex flex-col lg:flex-row">
      {/* Sidebar */}
      <aside className="lg:w-64 shrink-0 bg-[#101D35] text-white flex flex-col justify-between p-4">
        <div className="space-y-6">
          <div className="flex items-center gap-3 px-2 pt-1">
            <BoslaLogo size={40} variant="dark" />
            <div>
              <h1 className="text-sm font-extrabold">بوصلة التطبيقات</h1>
              <p className="text-[11px] text-[#D5B45C]">لوحة الإدارة</p>
            </div>
          </div>

          <nav className="grid grid-cols-2 lg:grid-cols-1 gap-1.5">
            {navItems.map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`min-h-[44px] px-3.5 rounded-xl text-xs font-bold flex items-center gap-2.5 transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[#2878E8] text-white'
                      : 'text-slate-300 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="pt-4 mt-4 border-t border-white/10 flex lg:flex-col gap-2">
          <button
            type="button"
            onClick={handleAdminLogout}
            className="flex-1 min-h-[44px] px-3 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-100 text-xs font-bold flex items-center justify-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            <span>تسجيل خروج المسؤول</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 space-y-6">
        {backend.isDemoMode && (
          <div className="rounded-xl bg-[#FFF9EB] border border-[#D5B45C]/40 px-4 py-2.5 text-xs font-semibold text-[#7B5D12]">
            وضع العرض — البيانات المعروضة محلية من المتصفح، اربط Supabase لمزامنة بيانات التطبيق الحقيقية.
          </div>
        )}

        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-xl font-extrabold text-[#101D35]">
              {navItems.find((n) => n.id === tab)?.label}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              إدارة موحدة لنقاط المستخدمين وطلبات الشحن وإعدادات التسعير
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadTabData}
              className="min-h-[40px] px-4 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-xs font-bold flex items-center gap-2"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingData ? 'animate-spin' : ''}`} />
              <span>تحديث</span>
            </button>
            <button
              type="button"
              onClick={handleAdminLogout}
              className="min-h-[40px] px-4 rounded-xl bg-red-50 border border-red-200 hover:bg-red-100 text-red-700 text-xs font-bold flex items-center gap-2"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>تسجيل خروج المسؤول</span>
            </button>
          </div>
        </header>

        {/* TAB 1: Wallets */}
        {tab === 'wallets' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3.5 max-w-md">
              <Search className="w-4 h-4 text-slate-400 shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث برقم المحفظة (BOS-...) أو الاسم أو الهاتف"
                className="w-full min-h-[44px] bg-transparent text-xs focus:outline-none"
              />
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
                  <tr>
                    <th className="py-3 px-4">رقم المحفظة</th>
                    <th className="py-3 px-4">الاسم</th>
                    <th className="py-3 px-4">البريد</th>
                    <th className="py-3 px-4">الرصيد</th>
                    <th className="py-3 px-4">إجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {wallets.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500">
                        لا توجد محافظ مطابقة للبحث.
                      </td>
                    </tr>
                  ) : (
                    wallets.map((w) => (
                      <tr key={w.id} className="hover:bg-slate-50/60">
                        <td dir="ltr" className="py-3 px-4 font-extrabold text-[#2878E8] tabular-nums text-right">
                          {w.wallet_number}
                        </td>
                        <td className="py-3 px-4 font-bold">{w.full_name}</td>
                        <td dir="ltr" className="py-3 px-4 text-slate-600 text-right">
                          {w.email}
                        </td>
                        <td className="py-3 px-4 font-extrabold tabular-nums">
                          {w.points_balance} نقطة
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setAdjustTarget(w);
                                setAdjustMode('credit');
                                setAdjustPoints(100);
                              }}
                              className="min-h-[34px] px-2.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold inline-flex items-center gap-1"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>شحن</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setAdjustTarget(w);
                                setAdjustMode('debit');
                                setAdjustPoints(50);
                              }}
                              className="min-h-[34px] px-2.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-800 font-bold inline-flex items-center gap-1"
                            >
                              <Minus className="w-3.5 h-3.5" />
                              <span>خصم</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 2: Topup Requests */}
        {tab === 'topups' && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
                <tr>
                  <th className="py-3 px-4">المستخدم</th>
                  <th className="py-3 px-4">المحفظة</th>
                  <th className="py-3 px-4">الوسيلة</th>
                  <th className="py-3 px-4">النقاط</th>
                  <th className="py-3 px-4">السعر (ج.س)</th>
                  <th className="py-3 px-4">الحالة</th>
                  <th className="py-3 px-4">القرار</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {topups.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      لا توجد طلبات شحن حالياً.
                    </td>
                  </tr>
                ) : (
                  topups.map((req) => (
                    <tr key={req.id}>
                      <td className="py-3 px-4 font-bold">{req.user_name}</td>
                      <td dir="ltr" className="py-3 px-4 font-bold text-[#2878E8] tabular-nums text-right">
                        {req.wallet_number}
                      </td>
                      <td className="py-3 px-4">{TOPUP_METHOD_LABELS[req.method]}</td>
                      <td className="py-3 px-4 font-extrabold tabular-nums">{req.points}</td>
                      <td className="py-3 px-4 tabular-nums">
                        {req.price_sdg.toLocaleString('en-US')}
                      </td>
                      <td className="py-3 px-4 font-bold">
                        {req.status === 'pending'
                          ? 'بانتظار التأكيد'
                          : req.status === 'approved'
                            ? 'تمت الموافقة'
                            : 'مرفوض'}
                      </td>
                      <td className="py-3 px-4">
                        {req.status === 'pending' ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <input
                              type="text"
                              placeholder="ملاحظة (اختياري)"
                              value={noteById[req.id] || ''}
                              onChange={(e) =>
                                setNoteById((p) => ({ ...p, [req.id]: e.target.value }))
                              }
                              className="min-h-[34px] w-32 rounded-lg border border-slate-200 px-2 text-[11px]"
                            />
                            <button
                              type="button"
                              disabled={reviewingId === req.id}
                              onClick={() => handleReviewTopup(req.id, true)}
                              className="min-h-[34px] px-2.5 rounded-lg bg-emerald-600 text-white font-bold inline-flex items-center gap-1"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>اعتماد</span>
                            </button>
                            <button
                              type="button"
                              disabled={reviewingId === req.id}
                              onClick={() => handleReviewTopup(req.id, false)}
                              className="min-h-[34px] px-2.5 rounded-lg bg-red-600 text-white font-bold inline-flex items-center gap-1"
                            >
                              <X className="w-3.5 h-3.5" />
                              <span>رفض</span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate-400">{req.admin_note || '—'}</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 3: Immutable Transactions Log */}
        {tab === 'transactions' && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
                <tr>
                  <th className="py-3 px-4">التاريخ</th>
                  <th className="py-3 px-4">المحفظة</th>
                  <th className="py-3 px-4">النوع</th>
                  <th className="py-3 px-4">البيان</th>
                  <th className="py-3 px-4">التغيير</th>
                  <th className="py-3 px-4">الرصيد بعد</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      لا توجد معاملات مسجّلة.
                    </td>
                  </tr>
                ) : (
                  transactions.map((tx) => (
                    <tr key={tx.id}>
                      <td className="py-3 px-4 tabular-nums text-slate-500">
                        {new Date(tx.created_at).toLocaleString('ar-SD')}
                      </td>
                      <td dir="ltr" className="py-3 px-4 font-bold text-[#2878E8] tabular-nums text-right">
                        {tx.wallet_number || '—'}
                      </td>
                      <td className="py-3 px-4">{TX_LABELS[tx.type] || tx.type}</td>
                      <td className="py-3 px-4">{tx.description}</td>
                      <td
                        className={`py-3 px-4 font-extrabold tabular-nums ${
                          tx.amount >= 0 ? 'text-emerald-600' : 'text-red-700'
                        }`}
                      >
                        {tx.amount >= 0 ? `+${tx.amount}` : tx.amount}
                      </td>
                      <td className="py-3 px-4 font-bold tabular-nums">{tx.balance_after}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 4: System Settings & Change Admin Password */}
        {tab === 'settings' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <form
              onSubmit={handleSaveSettings}
              className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4"
            >
              <h3 className="text-sm font-extrabold text-[#101D35]">إعدادات التسعير والتواصل</h3>
              <div>
                <label className="block text-xs font-bold mb-1.5">سعر النقطة الواحدة (ج.س)</label>
                <input
                  type="number"
                  min={1}
                  value={settingsForm.point_price_sdg}
                  onChange={(e) =>
                    setSettingsForm((s) => ({
                      ...s,
                      point_price_sdg: Math.max(1, Number(e.target.value) || 50),
                    }))
                  }
                  dir="ltr"
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm font-bold tabular-nums text-left"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1.5">نقاط الهدية عند أول دخول</label>
                <input
                  type="number"
                  min={0}
                  value={settingsForm.gift_points}
                  onChange={(e) =>
                    setSettingsForm((s) => ({
                      ...s,
                      gift_points: Math.max(0, Number(e.target.value) || 0),
                    }))
                  }
                  dir="ltr"
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm font-bold tabular-nums text-left"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1.5">رقم واتساب الإدارة (مع رمز الدولة)</label>
                <input
                  type="text"
                  value={settingsForm.admin_whatsapp}
                  onChange={(e) =>
                    setSettingsForm((s) => ({ ...s, admin_whatsapp: e.target.value }))
                  }
                  dir="ltr"
                  placeholder="249912345678"
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm font-bold tabular-nums text-left"
                />
              </div>
              <button
                type="submit"
                disabled={savingSettings}
                className="min-h-[46px] px-6 rounded-xl bg-[#2878E8] hover:bg-[#1E66CC] text-white font-bold text-sm flex items-center gap-2"
              >
                {savingSettings && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>حفظ الإعدادات</span>
              </button>
            </form>

            <form
              onSubmit={handleChangeAdminPassword}
              className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4"
            >
              <h3 className="text-sm font-extrabold text-[#101D35]">تغيير كلمة سر الإدارة</h3>

              {adminPassError && (
                <div
                  role="alert"
                  className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs font-bold text-red-800"
                >
                  {adminPassError}
                </div>
              )}

              {adminPassSuccess && (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 text-xs font-bold text-emerald-800">
                  {adminPassSuccess}
                </div>
              )}

              <OutlinedField
                id="currentAdminPass"
                label="كلمة السر الحالية"
                type="password"
                value={currentAdminPass}
                onChange={setCurrentAdminPass}
                dir="ltr"
                placeholder="••••••"
              />
              <OutlinedField
                id="newAdminPass"
                label="كلمة السر الجديدة"
                type="password"
                value={newAdminPass}
                onChange={setNewAdminPass}
                dir="ltr"
                placeholder="6 أحرف على الأقل"
              />
              <OutlinedField
                id="confirmAdminPass"
                label="تأكيد كلمة السر الجديدة"
                type="password"
                value={confirmAdminPass}
                onChange={setConfirmAdminPass}
                dir="ltr"
                placeholder="أعد كتابة كلمة السر"
              />

              <button
                type="submit"
                disabled={changingAdminPass}
                className="min-h-[46px] px-6 rounded-xl bg-[#101D35] hover:bg-[#1B2C4D] text-white font-bold text-sm flex items-center gap-2"
              >
                {changingAdminPass && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>تغيير كلمة سر الإدارة</span>
              </button>
            </form>
          </div>
        )}

        {/* Adjust Points Modal */}
        {adjustTarget && (
          <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
            <form
              onSubmit={handleAdjustSubmit}
              className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-xl"
            >
              <h3 className="text-base font-extrabold">
                {adjustMode === 'credit' ? 'شحن نقاط' : 'خصم نقاط'} — {adjustTarget.wallet_number}
              </h3>
              <p className="text-xs text-slate-500">
                الرصيد الحالي: <strong className="tabular-nums">{adjustTarget.points_balance} نقطة</strong>
              </p>

              <div>
                <label className="block text-xs font-bold mb-1">عدد النقاط</label>
                <input
                  type="number"
                  min={1}
                  value={adjustPoints}
                  onChange={(e) => setAdjustPoints(Math.max(1, Number(e.target.value) || 0))}
                  dir="ltr"
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm font-bold tabular-nums text-left"
                />
              </div>

              <div>
                <label className="block text-xs font-bold mb-1">السبب</label>
                <input
                  type="text"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="مثال: تأكيد تحويل بنكك"
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-xs"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="submit"
                  disabled={adjusting}
                  className={`flex-1 min-h-[44px] rounded-xl text-white font-bold text-xs ${
                    adjustMode === 'credit' ? 'bg-emerald-600' : 'bg-red-600'
                  }`}
                >
                  {adjusting ? 'جاري التنفيذ…' : 'تأكيد'}
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustTarget(null)}
                  className="min-h-[44px] px-4 rounded-xl border border-slate-200 text-xs font-bold"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
