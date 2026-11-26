import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  SendHorizontal,
  Sparkles,
  Check,
  Loader2,
  AlertTriangle,
  Wallet as WalletIcon,
  ArrowUpLeft,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { BoslaLogo } from '../components/BoslaLogo';
import { MobileShell } from '../components/MobileShell';
import { backend } from '../lib/backend';
import { trackAppEvent } from '../lib/firebase';
import { useApp } from '../context/AppContext';
import type { ChatMessage, EstimatePayload } from '../types';

const SUGGESTIONS = [
  'آلة حاسبة بسيطة بأزرار كبيرة',
  'متجر إلكتروني صغير لبيع العطور',
  'تطبيق ملاحظات وتذكير بالمهام اليومية',
];

const MAX_CHARS = 2000;

export function ChatScreen() {
  const { user, settings, refreshProfile, showToast } = useApp();
  const navigate = useNavigate();

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'bot',
      text: 'أهلاً بك في بوصلة التطبيقات! صف لي فكرة تطبيقك بالعربية في رسالة واحدة، وسأحللها وأخبرك بالتقدير المناسب قبل البناء.',
      createdAt: new Date().toISOString(),
    },
  ]);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [thinkingStep, setThinkingStep] = useState<'analyzing' | 'estimating'>('analyzing');
  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [supabaseNoticeMsgId, setSupabaseNoticeMsgId] = useState<string | null>(null);

  const listEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  useEffect(() => {
    if (!thinking) return;
    setThinkingStep('analyzing');
    const t = window.setTimeout(() => setThinkingStep('estimating'), 1300);
    return () => window.clearTimeout(t);
  }, [thinking]);

  const sendMessage = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || thinking) return;

    setHasInteracted(true);
    setInput('');
    setSupabaseNoticeMsgId(null);

    const userMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      text,
      createdAt: new Date().toISOString(),
    };

    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setThinking(true);
    trackAppEvent('chat_prompt_sent', { length: text.length });

    try {
      const res = await backend.sendChatMessage({
        history: nextHistory
          .filter((m) => m.id !== 'welcome' && !m.isError)
          .map((m) => ({ role: m.role, text: m.text })),
        message: text,
      });

      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            id: `err_${Date.now()}`,
            role: 'bot',
            text: res.message,
            createdAt: new Date().toISOString(),
            isError: true,
          },
        ]);
        return;
      }

      const botMsg: ChatMessage = {
        id: `b_${Date.now()}`,
        role: 'bot',
        text: res.reply,
        createdAt: new Date().toISOString(),
        estimate: res.estimate,
        promptDescription: text,
      };
      setMessages((prev) => [...prev, botMsg]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          role: 'bot',
          text: 'تعذّر الوصول للذكاء الاصطناعي — حاول لاحقاً',
          createdAt: new Date().toISOString(),
          isError: true,
        },
      ]);
    } finally {
      setThinking(false);
    }
  };

  const handleBuildApp = async (msgId: string, description: string, estimate: EstimatePayload) => {
    if (buildingId) return;

    if (!backend.isSupabaseConfigured) {
      setSupabaseNoticeMsgId(msgId);
      showToast('البناء الحقيقي يحتاج ربط Supabase', 'info');
      return;
    }

    if (user && user.points_balance < estimate.points) {
      showToast('رصيد نقاطك غير كافٍ — اشحن محفظتك أولاً', 'error');
      navigate('/topup');
      return;
    }

    setBuildingId(msgId);
    try {
      const res = await backend.startBuild({
        description,
        complexity: estimate.complexity,
      });
      if (!res.ok) {
        if (res.requiresSupabase) {
          setSupabaseNoticeMsgId(msgId);
        }
        showToast(res.message, 'error');
        if (res.insufficientPoints) {
          navigate('/topup');
        }
        return;
      }

      await refreshProfile();
      trackAppEvent('build_started', { complexity: estimate.complexity, points: estimate.points });
      showToast('تم خصم النقاط وبدء بناء تطبيقك!', 'success');
      navigate('/builds');
    } finally {
      setBuildingId(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <MobileShell>
      {/* Top App Header */}
      <header className="shrink-0 bg-[#101D35] text-white px-4 py-3 flex items-center justify-between gap-2 shadow-sm">
        <div className="flex items-center gap-2.5 min-w-0">
          <BoslaLogo size={38} variant="white" />
          <div className="min-w-0">
            <h1 className="text-sm font-extrabold leading-tight truncate">بوصلة التطبيقات</h1>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-300 mt-0.5">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  isOnline ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
              <span className="truncate">{isOnline ? 'متصل الآن' : 'غير متصل'}</span>
              <span aria-hidden="true" className="text-slate-500">·</span>
              <span className="tabular-nums text-[#D5B45C] font-semibold truncate">
                1 نقطة = {settings.point_price_sdg} ج.س
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => navigate('/wallet')}
          className="shrink-0 min-h-[38px] px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 flex items-center gap-1.5 transition-colors"
        >
          <WalletIcon className="w-3.5 h-3.5 text-[#D5B45C]" />
          <span className="text-xs font-bold tabular-nums text-white">
            {user?.points_balance ?? 0}
          </span>
          <span className="text-[10px] text-slate-300">نقطة</span>
        </button>
      </header>

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5">
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className={`flex flex-col ${msg.role === 'user' ? 'items-start' : 'items-end'}`}
            >
              {msg.role === 'user' ? (
                <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-[#2878E8] text-white px-4 py-3 text-sm leading-relaxed shadow-sm">
                  {msg.text}
                </div>
              ) : (
                <div className="w-full flex items-start gap-2.5 justify-end">
                  <div className="flex-1 max-w-[92%] space-y-2.5">
                    <div
                      className={`rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed shadow-sm border ${
                        msg.isError
                          ? 'bg-red-50 border-red-200 text-red-900'
                          : 'bg-white border-slate-200/80 text-[#101D35]'
                      }`}
                    >
                      {msg.isError && (
                        <div className="flex items-center gap-1.5 text-red-700 font-bold text-xs mb-1">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>تنبيه</span>
                        </div>
                      )}
                      <p className="whitespace-pre-line">{msg.text}</p>
                    </div>

                    {/* Compact Estimate Card */}
                    {msg.estimate && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.25 }}
                        className="rounded-2xl bg-white border border-slate-200 shadow-sm p-4 space-y-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-[#D5B45C]/20 text-[#866611] text-xs font-extrabold">
                            المستوى: {msg.estimate.complexityLabel}
                          </span>
                          <span className="text-xs font-bold text-slate-500 tabular-nums">
                            {msg.estimate.points} نقطة
                          </span>
                        </div>

                        <div className="flex items-baseline justify-between border-y border-slate-100 py-2.5">
                          <span className="text-xs font-semibold text-slate-500">التكلفة الإجمالية</span>
                          <div className="text-left">
                            <span className="text-2xl font-extrabold text-[#101D35] tabular-nums">
                              {msg.estimate.priceSdg.toLocaleString('en-US')}
                            </span>
                            <span className="text-xs font-bold text-slate-600 mr-1">ج.س</span>
                          </div>
                        </div>

                        {msg.estimate.features.length > 0 && (
                          <ul className="space-y-1.5 text-xs text-[#101D35]">
                            {msg.estimate.features.map((feat, idx) => (
                              <li key={idx} className="flex items-start gap-2">
                                <Check className="w-3.5 h-3.5 text-[#2878E8] shrink-0 mt-0.5" />
                                <span className="leading-snug">{feat}</span>
                              </li>
                            ))}
                          </ul>
                        )}

                        {msg.estimate.reason && (
                          <p className="text-[11px] text-slate-500 leading-relaxed bg-slate-50 rounded-xl px-3 py-2">
                            {msg.estimate.reason}
                          </p>
                        )}

                        {supabaseNoticeMsgId === msg.id && (
                          <div className="rounded-xl bg-[#FFF9EB] border border-[#D5B45C]/50 px-3 py-2.5 text-xs font-semibold text-[#7B5D12]">
                            البناء الحقيقي يحتاج ربط Supabase (أضف مفاتيح المشروع في ملف .env لتشغيل خط بناء APK).
                          </div>
                        )}

                        <button
                          type="button"
                          disabled={buildingId === msg.id}
                          onClick={() =>
                            handleBuildApp(
                              msg.id,
                              msg.promptDescription || msg.text,
                              msg.estimate!,
                            )
                          }
                          className="w-full min-h-[46px] rounded-xl bg-[#2878E8] hover:bg-[#1E66CC] disabled:opacity-65 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-sm shadow-[#2878E8]/25 active:scale-[0.98] transition-all"
                        >
                          {buildingId === msg.id ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span>جاري بدء البناء…</span>
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-4 h-4" />
                              <span>ابنِ التطبيق</span>
                            </>
                          )}
                        </button>
                      </motion.div>
                    )}
                  </div>

                  <div className="shrink-0 mt-1">
                    <BoslaLogo size={30} variant="navy" />
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Initial Tappable Suggestion Chips (disappear after first message) */}
        {!hasInteracted && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="pt-2 space-y-2"
          >
            <p className="text-xs font-bold text-slate-500 px-1">أفكار سريعة للبدء:</p>
            <div className="flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => sendMessage(s)}
                  className="text-right min-h-[44px] px-4 py-2.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-xs font-bold text-[#101D35] flex items-center justify-between gap-2 transition-colors active:scale-[0.99]"
                >
                  <span>{s}</span>
                  <ArrowUpLeft className="w-4 h-4 text-[#2878E8] shrink-0" />
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {/* Animated Typing Indicator with Thinking Steps */}
        {thinking && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2.5 justify-end"
          >
            <div className="rounded-2xl rounded-tl-sm bg-white border border-slate-200 px-4 py-3 shadow-sm flex items-center gap-2.5">
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#2878E8] animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-[#2878E8] animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-[#2878E8] animate-bounce" />
              </div>
              <span className="text-xs font-semibold text-slate-600">
                {thinkingStep === 'analyzing' ? 'يحلل وصفك…' : 'يقدّر النقاط والسعر…'}
              </span>
            </div>
            <BoslaLogo size={30} variant="navy" />
          </motion.div>
        )}

        <div ref={listEndRef} />
      </div>

      {/* Chat Composer */}
      <form
        onSubmit={handleSubmit}
        className="shrink-0 bg-white border-t border-slate-200 p-3 space-y-1.5"
      >
        <div className="flex items-end gap-2">
          <textarea
            rows={1}
            maxLength={MAX_CHARS}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage(input);
              }
            }}
            placeholder="صف فكرة تطبيقك هنا…"
            className="flex-1 min-h-[46px] max-h-[110px] resize-none rounded-xl border border-slate-300 bg-[#F8FAFC] px-3.5 py-2.5 text-sm text-[#101D35] placeholder:text-slate-400 focus:outline-none focus:border-[#2878E8] focus:bg-white transition-colors"
          />
          <button
            type="submit"
            disabled={!input.trim() || thinking}
            aria-label="إرسال الوصف"
            className="min-w-[46px] min-h-[46px] rounded-xl bg-[#2878E8] hover:bg-[#1E66CC] disabled:bg-slate-200 disabled:text-slate-400 text-white flex items-center justify-center transition-all active:scale-95 shrink-0"
          >
            <SendHorizontal className="w-5 h-5 rotate-180" />
          </button>
        </div>
        {input.length > 1500 && (
          <div className="text-[11px] text-slate-400 tabular-nums px-1">
            {input.length} / {MAX_CHARS} حرف
          </div>
        )}
      </form>
    </MobileShell>
  );
}
