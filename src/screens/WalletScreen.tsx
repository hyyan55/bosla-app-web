import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Copy,
  Check,
  PlusCircle,
  ArrowDownLeft,
  ArrowUpRight,
  Gift,
  RotateCcw,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import { MobileShell } from '../components/MobileShell';
import { BoslaLogo } from '../components/BoslaLogo';
import { backend } from '../lib/backend';
import { useApp } from '../context/AppContext';
import type { PointsTransaction, TransactionType } from '../types';

const TX_LABELS: Record<TransactionType, string> = {
  gift: 'هدية ترحيبية',
  topup: 'شحن رصيد',
  build_debit: 'بناء تطبيق',
  refund: 'استرداد تلقائي',
  admin_credit: 'شحن إداري',
  admin_debit: 'خصم إداري',
};

export function WalletScreen() {
  const { user, settings, refreshProfile, showToast } = useApp();
  const navigate = useNavigate();

  const [transactions, setTransactions] = useState<PointsTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadWalletData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await refreshProfile();
      const rows = await backend.getTransactions();
      setTransactions(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر تحميل بيانات المحفظة');
    } finally {
      setLoading(false);
    }
  }, [refreshProfile]);

  useEffect(() => {
    loadWalletData();
  }, [loadWalletData]);

  const handleCopyWallet = async () => {
    if (!user?.wallet_number) return;
    try {
      await navigator.clipboard.writeText(user.wallet_number);
      setCopied(true);
      showToast('تم نسخ رقم المحفظة', 'success');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      showToast('تعذّر النسخ تلقائياً', 'error');
    }
  };

  const balancePoints = user?.points_balance ?? 0;
  const balanceSdg = balancePoints * settings.point_price_sdg;

  const renderTxIcon = (type: TransactionType, amount: number) => {
    if (type === 'gift') return <Gift className="w-4 h-4 text-[#B8922E]" />;
    if (type === 'refund') return <RotateCcw className="w-4 h-4 text-emerald-600" />;
    if (amount >= 0) return <ArrowDownLeft className="w-4 h-4 text-emerald-600" />;
    return <ArrowUpRight className="w-4 h-4 text-slate-600" />;
  };

  return (
    <MobileShell>
      {/* Top Bar */}
      <header className="shrink-0 bg-[#101D35] text-white px-5 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <BoslaLogo size={32} variant="dark" />
          <h1 className="text-base font-extrabold">محفظتي</h1>
        </div>
        <button
          type="button"
          onClick={loadWalletData}
          aria-label="تحديث المحفظة"
          className="min-w-[40px] min-h-[40px] rounded-xl bg-white/10 hover:bg-white/15 flex items-center justify-center"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {/* Navy Balance Card */}
        <section className="rounded-3xl bg-[#101D35] text-white p-5 shadow-md space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs text-slate-300">الرصيد المتاح</p>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-3xl font-extrabold tabular-nums">
                  {balancePoints.toLocaleString('en-US')}
                </span>
                <span className="text-sm font-bold text-[#D5B45C]">نقطة</span>
              </div>
              <p className="text-xs text-slate-300 mt-1 tabular-nums">
                يعادل {balanceSdg.toLocaleString('en-US')} جنيه سوداني
              </p>
            </div>

            <button
              type="button"
              onClick={() => navigate('/topup')}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-[#2878E8] hover:bg-[#1E66CC] text-white font-bold text-xs flex items-center gap-1.5 shadow-sm active:scale-[0.98] transition-all shrink-0"
            >
              <PlusCircle className="w-4 h-4" />
              <span>شحن النقاط</span>
            </button>
          </div>

          <div className="pt-3 border-t border-white/10 flex items-center justify-between gap-2">
            <div>
              <p className="text-[11px] text-slate-400">رقم المحفظة</p>
              <p dir="ltr" className="text-sm font-extrabold tracking-wider text-white tabular-nums">
                {user?.wallet_number || 'BOS-—'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleCopyWallet}
              className="min-h-[38px] px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-bold flex items-center gap-1.5 transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>تم النسخ</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-[#D5B45C]" />
                  <span>نسخ الرقم</span>
                </>
              )}
            </button>
          </div>
        </section>

        {/* Transactions History */}
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-sm font-extrabold text-[#101D35]">سجل المعاملات</h2>
            <span className="text-xs text-slate-500 tabular-nums">
              {transactions.length} عملية
            </span>
          </div>

          {loading ? (
            <div className="space-y-2.5">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-16 rounded-2xl bg-white border border-slate-200 animate-pulse"
                />
              ))}
            </div>
          ) : error ? (
            <div className="rounded-2xl bg-red-50 border border-red-200 p-4 text-center space-y-2">
              <AlertCircle className="w-6 h-6 text-red-600 mx-auto" />
              <p className="text-xs font-semibold text-red-800">{error}</p>
              <button
                type="button"
                onClick={loadWalletData}
                className="text-xs font-bold text-[#2878E8] underline"
              >
                إعادة المحاولة
              </button>
            </div>
          ) : transactions.length === 0 ? (
            <div className="rounded-2xl bg-white border border-slate-200 p-6 text-center text-xs text-slate-500">
              لا توجد معاملات مسجّلة حتى الآن.
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
              {transactions.map((tx) => {
                const positive = tx.amount >= 0;
                return (
                  <div
                    key={tx.id}
                    className="px-4 py-3.5 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                        {renderTxIcon(tx.type, tx.amount)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-[#101D35] truncate">
                          {tx.description || TX_LABELS[tx.type]}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1.5">
                          <span>{TX_LABELS[tx.type]}</span>
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums">
                            {new Date(tx.created_at).toLocaleDateString('ar-SD', {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </span>
                        </p>
                      </div>
                    </div>

                    <div className="text-left shrink-0">
                      <p
                        className={`text-sm font-extrabold tabular-nums ${
                          positive ? 'text-emerald-600' : 'text-[#101D35]'
                        }`}
                      >
                        {positive ? `+${tx.amount}` : tx.amount} نقطة
                      </p>
                      <p className="text-[11px] text-slate-400 tabular-nums mt-0.5">
                        الرصيد: {tx.balance_after}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </MobileShell>
  );
}
