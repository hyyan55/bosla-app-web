import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Landmark, Smartphone, Wallet, ExternalLink, CheckCircle2, Loader2 } from 'lucide-react';
import { MobileShell } from '../components/MobileShell';
import { backend, TOPUP_METHOD_LABELS } from '../lib/backend';
import { useApp } from '../context/AppContext';
import type { TopupMethod } from '../types';

const PRESET_POINTS = [100, 400, 800, 1200];

const METHODS: Array<{ id: TopupMethod; label: string; hint: string; icon: React.ReactNode }> = [
  { id: 'bankak', label: 'بنكك', hint: 'تحويل بنك الخرطوم', icon: <Landmark className="w-5 h-5" /> },
  { id: 'sahil', label: 'ساهل', hint: 'محفظة ساهل', icon: <Wallet className="w-5 h-5" /> },
  { id: 'mycashy', label: 'ماي كاشي', hint: 'تطبيق ماي كاشي', icon: <Smartphone className="w-5 h-5" /> },
];

const METHOD_INSTRUCTIONS: Record<TopupMethod, string> = {
  bankak: 'حوّل عبر بنكك',
  sahil: 'عبر تطبيق ساهل',
  mycashy: 'عبر تطبيق ماي كاشي',
};

export function TopupScreen() {
  const { settings, showToast } = useApp();
  const navigate = useNavigate();

  const [method, setMethod] = useState<TopupMethod>('bankak');
  const [points, setPoints] = useState<number>(400);
  const [submitting, setSubmitting] = useState(false);
  const [whatsappUrl, setWhatsappUrl] = useState<string | null>(null);

  const totalSdg = Math.max(0, points) * settings.point_price_sdg;

  const handleConfirm = async () => {
    if (!points || points < 20) {
      showToast('أدخل 20 نقطة على الأقل للشحن', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const res = await backend.submitTopupRequest({ method, points });
      if (!res.ok) {
        showToast(res.message, 'error');
        return;
      }
      setWhatsappUrl(res.whatsappUrl);
      showToast('تم تجهيز رسالة الشحن عبر واتساب', 'success');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MobileShell>
      {/* Top Bar */}
      <header className="shrink-0 bg-[#101D35] text-white px-4 py-3.5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="رجوع"
          className="min-w-[40px] min-h-[40px] rounded-xl bg-white/10 hover:bg-white/15 flex items-center justify-center"
        >
          <ArrowRight className="w-5 h-5" />
        </button>
        <h1 className="text-base font-extrabold">شحن النقاط</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-6">
        {/* Step 1: Payment Method */}
        <section className="space-y-2.5">
          <h2 className="text-sm font-extrabold text-[#101D35]">1. اختر طريقة الدفع</h2>
          <div className="grid grid-cols-3 gap-2.5">
            {METHODS.map((m) => {
              const active = method === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setMethod(m.id);
                    setWhatsappUrl(null);
                  }}
                  className={`min-h-[86px] rounded-2xl p-3 border text-center flex flex-col items-center justify-center gap-1.5 transition-all ${
                    active
                      ? 'bg-[#101D35] text-white border-[#101D35] shadow-sm'
                      : 'bg-white text-[#101D35] border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className={active ? 'text-[#D5B45C]' : 'text-[#2878E8]'}>{m.icon}</div>
                  <span className="text-xs font-extrabold">{m.label}</span>
                  <span
                    className={`text-[10px] leading-tight ${
                      active ? 'text-slate-300' : 'text-slate-500'
                    }`}
                  >
                    {m.hint}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Step 2: Points Amount */}
        <section className="space-y-3">
          <h2 className="text-sm font-extrabold text-[#101D35]">2. حدد عدد النقاط المطلوبة</h2>

          <div className="grid grid-cols-4 gap-2">
            {PRESET_POINTS.map((amt) => {
              const selected = points === amt;
              return (
                <button
                  key={amt}
                  type="button"
                  onClick={() => {
                    setPoints(amt);
                    setWhatsappUrl(null);
                  }}
                  className={`min-h-[44px] rounded-xl border text-xs font-extrabold tabular-nums transition-colors ${
                    selected
                      ? 'bg-[#2878E8] text-white border-[#2878E8]'
                      : 'bg-white text-[#101D35] border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {amt}
                </button>
              );
            })}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
            <label htmlFor="customPoints" className="block text-xs font-bold text-slate-600">
              أو أدخل عدداً مخصصاً (نقطة)
            </label>
            <input
              id="customPoints"
              type="number"
              min={20}
              step={10}
              value={points || ''}
              onChange={(e) => {
                setPoints(Math.max(0, Number(e.target.value) || 0));
                setWhatsappUrl(null);
              }}
              dir="ltr"
              className="w-full min-h-[46px] rounded-xl border border-slate-300 px-3.5 text-base font-extrabold text-[#101D35] tabular-nums text-left focus:outline-none focus:border-[#2878E8]"
            />
          </div>
        </section>

        {/* Summary Card */}
        <section className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>الطريقة المختارة</span>
            <span className="font-bold text-[#101D35]">{TOPUP_METHOD_LABELS[method]}</span>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>سعر النقطة الحالي</span>
            <span className="font-bold text-[#101D35] tabular-nums">
              {settings.point_price_sdg} ج.س
            </span>
          </div>
          <div className="pt-3 border-t border-slate-100 flex items-baseline justify-between">
            <span className="text-sm font-bold text-[#101D35]">المبلغ المطلوب</span>
            <div>
              <span className="text-2xl font-extrabold text-[#2878E8] tabular-nums">
                {totalSdg.toLocaleString('en-US')}
              </span>
              <span className="text-xs font-bold text-slate-600 mr-1">ج.س</span>
            </div>
          </div>
        </section>

        {/* Method-specific Instructions */}
        <div className="rounded-2xl bg-[#FFF9EB] border border-[#D5B45C]/40 px-4 py-3.5 text-xs text-[#7B5D12] space-y-2 leading-relaxed">
          <p className="font-extrabold text-[#5E450A]">
            تعليمات الدفع ({TOPUP_METHOD_LABELS[method]} — {METHOD_INSTRUCTIONS[method]})
          </p>
          <ol className="list-decimal list-inside space-y-1 font-medium">
            <li>
              حوّل المبلغ ({totalSdg.toLocaleString('en-US')} ج.س){' '}
              {method === 'bankak' ? 'عبر بنكك' : METHOD_INSTRUCTIONS[method]}.
            </li>
            <li>
              اضغط «تأكيد طلب الشحن» وستُفتح واتساب لإرسال تفاصيل التحويل إلى الإدارة.
            </li>
          </ol>
        </div>

        {/* Confirm / WhatsApp Action */}
        {!whatsappUrl ? (
          <button
            type="button"
            disabled={submitting || points < 20}
            onClick={handleConfirm}
            className="w-full min-h-[50px] rounded-xl bg-[#2878E8] hover:bg-[#1E66CC] disabled:opacity-60 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-sm active:scale-[0.98] transition-all"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>جاري تسجيل الطلب…</span>
              </>
            ) : (
              <span>تأكيد طلب الشحن</span>
            )}
          </button>
        ) : (
          <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 space-y-3">
            <div className="flex items-center gap-2 text-emerald-900 font-bold text-xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                تم تسجيل طلبك عبر {TOPUP_METHOD_LABELS[method]}! اضغط الزر أدناه لإرسال التفاصيل عبر واتساب:
              </span>
            </div>
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full min-h-[48px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors"
            >
              <span>إرسال رسالة واتساب للإدارة</span>
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        )}
      </div>
    </MobileShell>
  );
}
