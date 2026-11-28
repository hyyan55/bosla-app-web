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
  ImagePlus,
  X,
  RotateCcw,
  BellOff,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { BoslaLogo } from '../components/BoslaLogo';
import { MobileShell } from '../components/MobileShell';
import { backend, uploadAppImage } from '../lib/backend';
import { trackAppEvent } from '../lib/firebase';
import {
  getBuildNotificationStatus,
  requestAndRegisterBuildNotifications,
} from '../lib/pushRegistration';
import { useApp } from '../context/AppContext';
import type { ChatMessage, EstimatePayload } from '../types';

const SUGGESTIONS = [
  'آلة حاسبة بسيطة بأزرار كبيرة',
  'متجر إلكتروني صغير لبيع العطور',
  'تطبيق ملاحظات وتذكير بالمهام اليومية',
];

const MAX_CHARS = 2000;
const MAX_ATTACHED_IMAGES = 5;
const CHAT_STORAGE_KEY = 'bosla-chat-messages';
const PENDING_RETRY_STORAGE_KEY = 'bosla-chat-pending-retry';
const STARTED_BUILDS_STORAGE_KEY = 'bosla-started-builds';

// بناء بدأ من بطاقة تقدير: يُحفَظ حتى لا يعرض الزر «ابنِ التطبيق» مرة ثانية
// فيخصم مرتين، ويُمسح عندما يخرج البناء من حالة «building».
interface StartedBuild {
  buildId: string;
  startedAt: number;
}

function readStartedBuilds(): Record<string, StartedBuild> {
  try {
    const raw = localStorage.getItem(STARTED_BUILDS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, StartedBuild> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const v = value as Partial<StartedBuild> | null;
      if (v && typeof v.buildId === 'string' && v.buildId && typeof v.startedAt === 'number') {
        out[key] = { buildId: v.buildId, startedAt: v.startedAt };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeStartedBuilds(map: Record<string, StartedBuild>): void {
  try {
    localStorage.setItem(STARTED_BUILDS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage quota errors
  }
}

interface PersistedAttachedImage {
  publicUrl: string;
  status: 'ready' | 'uploading' | 'error';
}

type LocalChatMessage = ChatMessage & {
  images?: string[];
  attachedImages?: PersistedAttachedImage[];
  isRetryStatus?: boolean;
};

interface AttachedImage {
  id: string;
  previewUrl: string;
  publicUrl?: string;
  status: 'uploading' | 'ready' | 'error';
  errorMessage?: string;
  file?: File;
  index: number;
  isObjectUrl?: boolean;
}

interface PendingChatRetry {
  userMessageId: string;
  messageText: string;
  attempt: number;
  dueAt: number;
  history: Array<{ role: 'user' | 'bot'; text: string }>;
  images: string[];
  attemptToken: number;
}

function isHttpUrl(raw: unknown): raw is string {
  return typeof raw === 'string' && /^https?:\/\//i.test(raw.trim());
}

function createRetryStatusMessage(token: number): LocalChatMessage {
  return {
    id: `retry_${token}`,
    role: 'bot',
    text: 'الذكاء الاصطناعي مشغول — بحاول تاني…',
    createdAt: new Date().toISOString(),
    isRetryStatus: true,
  };
}

function syncMessagesToStorage(
  msgs: LocalChatMessage[],
  atts?: AttachedImage[],
): void {
  try {
    const latestEstId = [...msgs]
      .reverse()
      .find((m) => m.role === 'bot' && Boolean(m.estimate))?.id;

    const persistedReadyImages: PersistedAttachedImage[] | null = atts
      ? atts
          .filter((a) => a.status === 'ready' && isHttpUrl(a.publicUrl))
          .map((a) => ({
            publicUrl: a.publicUrl as string,
            status: 'ready' as const,
          }))
      : null;

    const serialized: LocalChatMessage[] = msgs
      .filter((m) => !m.isRetryStatus)
      .map((m) => {
        const { attachedImages, isRetryStatus: _retry, ...rest } = m;
        if (persistedReadyImages !== null) {
          if (m.id === latestEstId && persistedReadyImages.length > 0) {
            return {
              ...rest,
              attachedImages: persistedReadyImages,
            };
          }
          return rest;
        }
        return attachedImages ? { ...rest, attachedImages } : rest;
      });

    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(serialized));
  } catch {
    // ignore storage quota errors
  }
}

function createDefaultMessages(): LocalChatMessage[] {
  return [
    {
      id: 'welcome',
      role: 'bot',
      text: 'أهلاً بك في بوصلة التطبيقات! صف لي فكرة تطبيقك بالعربية في رسالة واحدة، وسأحللها وأخبرك بالتقدير المناسب قبل البناء.',
      createdAt: new Date().toISOString(),
    },
  ];
}

function readStoredMessages(): LocalChatMessage[] {
  try {
    const saved = localStorage.getItem(CHAT_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as LocalChatMessage[];
      }
    }
  } catch {
    // ignore corrupted storage
  }
  return createDefaultMessages();
}

function readPendingRetry(): PendingChatRetry | null {
  try {
    const raw = localStorage.getItem(PENDING_RETRY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingChatRetry>;
    if (
      typeof parsed.messageText === 'string' &&
      parsed.messageText.trim() &&
      typeof parsed.attempt === 'number' &&
      parsed.attempt >= 2 &&
      parsed.attempt <= 3 &&
      typeof parsed.dueAt === 'number' &&
      Number.isFinite(parsed.dueAt)
    ) {
      return {
        userMessageId: typeof parsed.userMessageId === 'string' ? parsed.userMessageId : '',
        messageText: parsed.messageText,
        attempt: parsed.attempt,
        dueAt: parsed.dueAt,
        history: Array.isArray(parsed.history) ? parsed.history : [],
        images: Array.isArray(parsed.images) ? parsed.images : [],
        attemptToken: typeof parsed.attemptToken === 'number' ? parsed.attemptToken : 0,
      };
    }
  } catch {
    // ignore corrupted retry state
  }
  return null;
}

function writePendingRetry(pending: PendingChatRetry | null): void {
  try {
    if (pending) {
      localStorage.setItem(PENDING_RETRY_STORAGE_KEY, JSON.stringify(pending));
    } else {
      localStorage.removeItem(PENDING_RETRY_STORAGE_KEY);
    }
  } catch {
    // ignore storage quota errors
  }
}

// Module-level retry state so tab switches never cancel scheduled retries or invalidate in-flight replies
let activeRetryTimerId: number | null = null;
let activeAttemptToken = 0;
let activeInFlightUserMsgId: string | null = null;

type ChatSyncEvent =
  | { type: 'attempt_started'; userMessageId: string }
  | {
      type: 'messages_updated';
      messages: LocalChatMessage[];
      clearInput?: boolean;
      markAttachmentsSent?: boolean;
    }
  | { type: 'retry_scheduled'; messages: LocalChatMessage[] };

const chatListeners = new Set<(event: ChatSyncEvent) => void>();

function emitChatEvent(event: ChatSyncEvent): void {
  chatListeners.forEach((fn) => fn(event));
}

function cancelActiveRetry(): void {
  if (activeRetryTimerId !== null) {
    window.clearTimeout(activeRetryTimerId);
    activeRetryTimerId = null;
  }
  activeAttemptToken += 1;
  activeInFlightUserMsgId = null;
  writePendingRetry(null);
}

function scheduleModuleRetry(pending: PendingChatRetry, delayMs: number): void {
  if (activeRetryTimerId !== null) {
    window.clearTimeout(activeRetryTimerId);
  }
  writePendingRetry(pending);
  activeRetryTimerId = window.setTimeout(() => {
    activeRetryTimerId = null;
    void executeChatAttempt({
      attemptToken: pending.attemptToken,
      attempt: pending.attempt,
      userMessageId: pending.userMessageId,
      messageText: pending.messageText,
      history: pending.history,
      images: pending.images,
    });
  }, Math.max(0, delayMs));
}

async function executeChatAttempt(params: {
  attemptToken: number;
  attempt: number;
  userMessageId: string;
  messageText: string;
  history: Array<{ role: 'user' | 'bot'; text: string }>;
  images: string[];
}): Promise<void> {
  const { attemptToken, attempt, userMessageId, messageText, history, images } = params;
  if (activeAttemptToken !== attemptToken) return;

  activeInFlightUserMsgId = userMessageId;
  emitChatEvent({ type: 'attempt_started', userMessageId });

  let succeeded = false;
  let botReply: { reply: string; estimate?: EstimatePayload } | null = null;
  let failureMessage = 'تعذّر الوصول للذكاء الاصطناعي — حاول لاحقاً';
  let timeoutHandle: number | undefined;

  try {
    const res = await Promise.race([
      backend.sendChatMessage({
        history,
        message: messageText.slice(0, MAX_CHARS),
        images,
      }),
      new Promise<{ ok: false; message: string }>((resolve) => {
        timeoutHandle = window.setTimeout(
          () =>
            resolve({
              ok: false,
              message: 'استغرق الاتصال بالذكاء الاصطناعي وقتاً طويلاً — حاول لاحقاً',
            }),
          62000,
        );
      }),
    ]);

    if (res.ok) {
      succeeded = true;
      botReply = { reply: res.reply, estimate: res.estimate };
    } else if (res.message) {
      failureMessage = res.message;
    }
  } catch {
    succeeded = false;
  } finally {
    if (timeoutHandle !== undefined) {
      window.clearTimeout(timeoutHandle);
    }
  }

  if (activeAttemptToken !== attemptToken) return;
  activeInFlightUserMsgId = null;

  const baseMessages = readStoredMessages().filter((m) => !m.isRetryStatus);

  if (succeeded && botReply) {
    writePendingRetry(null);
    const botMsg: LocalChatMessage = {
      id: `b_${Date.now()}`,
      role: 'bot',
      text: botReply.reply,
      createdAt: new Date().toISOString(),
      estimate: botReply.estimate,
      promptDescription: messageText,
    };
    const nextMsgs = [...baseMessages, botMsg];
    const restoredAtts: AttachedImage[] | undefined =
      images.length > 0 && botReply.estimate
        ? images.map((url, idx) => ({
            id: `sent_${botMsg.id}_${idx}`,
            previewUrl: url,
            publicUrl: url,
            status: 'ready' as const,
            index: idx,
            isObjectUrl: false,
          }))
        : undefined;
    syncMessagesToStorage(nextMsgs, restoredAtts);
    emitChatEvent({
      type: 'messages_updated',
      messages: nextMsgs,
      clearInput: true,
      markAttachmentsSent: images.length > 0,
    });
    return;
  }

  if (attempt < 3) {
    const nextAttempt = attempt + 1;
    const delayMs = attempt === 1 ? 30000 : 60000;
    const pending: PendingChatRetry = {
      userMessageId,
      messageText,
      attempt: nextAttempt,
      dueAt: Date.now() + delayMs,
      history,
      images,
      attemptToken,
    };
    scheduleModuleRetry(pending, delayMs);
    const withRetryBubble: LocalChatMessage[] = [
      ...baseMessages,
      createRetryStatusMessage(attemptToken),
    ];
    emitChatEvent({ type: 'retry_scheduled', messages: withRetryBubble });
    return;
  }

  writePendingRetry(null);
  const errMsg: LocalChatMessage = {
    id: `err_${Date.now()}`,
    role: 'bot',
    text: failureMessage,
    createdAt: new Date().toISOString(),
    isError: true,
  };
  const nextMsgs = [...baseMessages, errMsg];
  syncMessagesToStorage(nextMsgs);
  emitChatEvent({
    type: 'messages_updated',
    messages: nextMsgs,
  });
}

export function ChatScreen() {
  const { user, settings, refreshProfile, showToast } = useApp();
  const navigate = useNavigate();

  const [messages, setMessages] = useState<LocalChatMessage[]>(() => {
    const stored = readStoredMessages();
    const lastNonRetry = [...stored].reverse().find((m) => !m.isRetryStatus);
    const pending = readPendingRetry();
    if (
      pending &&
      lastNonRetry?.role === 'user' &&
      (pending.userMessageId === lastNonRetry.id || pending.messageText === lastNonRetry.text) &&
      activeInFlightUserMsgId !== lastNonRetry.id
    ) {
      return [...stored, createRetryStatusMessage(pending.attemptToken || activeAttemptToken)];
    }
    return stored;
  });
  const [hasInteracted, setHasInteracted] = useState(() =>
    messages.some((m) => m.role === 'user'),
  );

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<AttachedImage[]>(() => {
    const latestEst = [...messages]
      .reverse()
      .find((m) => m.role === 'bot' && Boolean(m.estimate));
    if (!latestEst?.attachedImages?.length) return [];
    return latestEst.attachedImages
      .filter((item) => item && item.status === 'ready' && isHttpUrl(item.publicUrl))
      .map((item, idx) => ({
        id: `restored_${latestEst.id}_${idx}`,
        previewUrl: item.publicUrl,
        publicUrl: item.publicUrl,
        status: 'ready' as const,
        index: idx,
        isObjectUrl: false,
      }));
  });
  const [attachmentsSent, setAttachmentsSent] = useState<boolean>(() => {
    const latestEst = [...messages]
      .reverse()
      .find((m) => m.role === 'bot' && Boolean(m.estimate));
    return Boolean(
      latestEst?.attachedImages?.some(
        (item) => item && item.status === 'ready' && isHttpUrl(item.publicUrl),
      ),
    );
  });
  const [thinking, setThinking] = useState(() => {
    const stored = readStoredMessages();
    const lastMsg = stored[stored.length - 1];
    return Boolean(lastMsg?.role === 'user' && activeInFlightUserMsgId === lastMsg.id);
  });
  const [isWaitingRetry, setIsWaitingRetry] = useState(() => {
    const stored = readStoredMessages();
    const lastMsg = stored[stored.length - 1];
    const pending = readPendingRetry();
    return Boolean(
      pending &&
        lastMsg?.role === 'user' &&
        (pending.userMessageId === lastMsg.id || pending.messageText === lastMsg.text) &&
        activeInFlightUserMsgId !== lastMsg.id,
    );
  });
  const [thinkingStep, setThinkingStep] = useState<'analyzing' | 'estimating'>('analyzing');
  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [startedBuilds, setStartedBuilds] = useState<Record<string, StartedBuild>>(() =>
    readStartedBuilds(),
  );
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [supabaseNoticeMsgId, setSupabaseNoticeMsgId] = useState<string | null>(null);
  const [notifDeniedBanner, setNotifDeniedBanner] = useState(false);

  const listEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadCounterRef = useRef(0);
  const attachmentsRef = useRef<AttachedImage[]>([]);
  const messagesRef = useRef<LocalChatMessage[]>(messages);

  messagesRef.current = messages;

  useEffect(() => {
    syncMessagesToStorage(messages, attachments);
  }, [messages, attachments]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    let active = true;
    void getBuildNotificationStatus().then(({ status, rememberedDenied }) => {
      if (!active) return;
      if (status === 'granted') {
        setNotifDeniedBanner(false);
      } else if (rememberedDenied) {
        setNotifDeniedBanner(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  // مصالحة حالة «بدأ البناء» المحفوظة مع السيرفر: إن لم يعد البناء «building»
  // (نجح أو فشل واستُردت النقاط)، اسمح بإعادة البناء من البطاقة نفسها.
  useEffect(() => {
    let active = true;
    void (async () => {
      const stored = readStartedBuilds();
      if (Object.keys(stored).length === 0) return;
      try {
        const builds = await backend.getBuilds();
        if (!active) return;
        const next = { ...stored };
        let changed = false;
        for (const msgId of Object.keys(stored)) {
          const b = builds.find((x) => x.id === stored[msgId].buildId);
          if (!b || b.status !== 'building') {
            delete next[msgId];
            changed = true;
          }
        }
        if (changed) {
          writeStartedBuilds(next);
          setStartedBuilds(next);
        }
      } catch {
        // أبقِ الحالة المحفوظة؛ تُصالَح في الزيارة التالية
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const listener = (event: ChatSyncEvent) => {
      if (event.type === 'attempt_started') {
        setThinking(true);
        setIsWaitingRetry(false);
        setMessages((prev) => prev.filter((m) => !m.isRetryStatus));
        return;
      }
      if (event.type === 'retry_scheduled') {
        setMessages(event.messages);
        setThinking(false);
        setIsWaitingRetry(true);
        return;
      }
      if (event.type === 'messages_updated') {
        setMessages(event.messages);
        setThinking(false);
        setIsWaitingRetry(false);
        if (event.clearInput) setInput('');
        if (event.markAttachmentsSent) setAttachmentsSent(true);
      }
    };
    chatListeners.add(listener);

    // Check pending retry or unanswered latest user message on mount
    const stored = readStoredMessages();
    const lastNonRetry = [...stored].reverse().find((m) => !m.isRetryStatus);
    const pending = readPendingRetry();

    if (
      lastNonRetry?.role === 'user' &&
      pending &&
      (pending.userMessageId === lastNonRetry.id || pending.messageText === lastNonRetry.text)
    ) {
      if (activeInFlightUserMsgId === lastNonRetry.id) {
        setThinking(true);
        setIsWaitingRetry(false);
      } else {
        setIsWaitingRetry(true);
        setThinking(false);
        setMessages((prev) =>
          prev.some((m) => m.isRetryStatus)
            ? prev
            : [...stored, createRetryStatusMessage(pending.attemptToken || activeAttemptToken)],
        );

        // Resume scheduled retry if page reloaded (so module timer isn't running yet)
        if (activeRetryTimerId === null) {
          const resumedToken = Math.max(activeAttemptToken + 1, pending.attemptToken + 1);
          activeAttemptToken = resumedToken;
          const resumedPending: PendingChatRetry = {
            ...pending,
            userMessageId: lastNonRetry.id,
            attemptToken: resumedToken,
          };
          const remainingMs = Math.max(0, pending.dueAt - Date.now());
          scheduleModuleRetry(resumedPending, remainingMs);
        }
      }
    } else if (lastNonRetry?.role === 'user' && activeInFlightUserMsgId !== lastNonRetry.id) {
      // Unanswered user message at end of stored chat -> resume sending automatically
      writePendingRetry(null);
      const token = ++activeAttemptToken;
      const history = stored
        .filter((m) => m.id !== 'welcome' && !m.isError && !m.isRetryStatus)
        .map((m) => ({ role: m.role, text: m.text }));
      setThinking(true);
      setIsWaitingRetry(false);
      void executeChatAttempt({
        attemptToken: token,
        attempt: 1,
        userMessageId: lastNonRetry.id,
        messageText: lastNonRetry.text,
        history,
        images: lastNonRetry.images || [],
      });
    }

    return () => {
      chatListeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach((item) => {
        if (item.isObjectUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
    };
  }, []);

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

  const startFileUpload = async (attachmentId: string, file: File, index: number) => {
    try {
      const publicUrl = await uploadAppImage(file, index);
      setAttachments((prev) =>
        prev.map((item) =>
          item.id === attachmentId
            ? { ...item, status: 'ready', publicUrl, errorMessage: undefined }
            : item,
        ),
      );
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : 'فشل الرفع';
      setAttachments((prev) =>
        prev.map((item) =>
          item.id === attachmentId
            ? { ...item, status: 'error', errorMessage: msg }
            : item,
        ),
      );
    }
  };

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    e.target.value = '';
    if (selected.length === 0) return;

    const shouldReplace = attachmentsSent;
    const remaining = shouldReplace
      ? MAX_ATTACHED_IMAGES
      : MAX_ATTACHED_IMAGES - attachments.length;

    if (remaining <= 0) {
      showToast('الحد الأقصى 5 صور مرفقة في المحادثة', 'info');
      return;
    }

    let accepted = selected;
    if (selected.length > remaining) {
      accepted = selected.slice(0, remaining);
      showToast('الحد الأقصى 5 صور مرفقة — تم اختيار ما يتسع فقط', 'info');
    }

    const baseIndex = shouldReplace ? 0 : attachments.length;
    const newItems: AttachedImage[] = accepted.map((file, i) => ({
      id: `att_${Date.now()}_${uploadCounterRef.current++}`,
      previewUrl: URL.createObjectURL(file),
      status: 'uploading',
      file,
      index: baseIndex + i,
      isObjectUrl: true,
    }));

    if (shouldReplace) {
      setAttachments((prev) => {
        prev.forEach((item) => {
          if (item.isObjectUrl) {
            URL.revokeObjectURL(item.previewUrl);
          }
        });
        return newItems;
      });
      setAttachmentsSent(false);
    } else {
      setAttachments((prev) => [...prev, ...newItems]);
    }

    newItems.forEach((item) => {
      if (item.file) {
        void startFileUpload(item.id, item.file, item.index);
      }
    });
  };

  const handleRetryUpload = (att: AttachedImage) => {
    if (!att.file || att.status === 'uploading') return;
    setAttachments((prev) =>
      prev.map((item) =>
        item.id === att.id
          ? { ...item, status: 'uploading', errorMessage: undefined }
          : item,
      ),
    );
    void startFileUpload(att.id, att.file, att.index);
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target?.isObjectUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      const next = prev.filter((item) => item.id !== id);
      if (next.length === 0) {
        setAttachmentsSent(false);
      }
      syncMessagesToStorage(messagesRef.current, next);
      return next;
    });
  };

  const clearAttachments = () => {
    setAttachments((prev) => {
      prev.forEach((item) => {
        if (item.isObjectUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
      syncMessagesToStorage(messagesRef.current, []);
      return [];
    });
    setAttachmentsSent(false);
  };

  const sendMessage = async (rawText: string) => {
    const text = rawText.trim();
    if (!text) return;

    const hadPendingRetry =
      activeRetryTimerId !== null || readPendingRetry() !== null || isWaitingRetry;
    if (hadPendingRetry) {
      cancelActiveRetry();
      setIsWaitingRetry(false);
      setMessages((prev) => prev.filter((m) => !m.isRetryStatus));
    }

    if ((thinking || activeInFlightUserMsgId !== null) && !hadPendingRetry) return;

    if (attachments.some((a) => a.status === 'uploading')) {
      if (hadPendingRetry) {
        setThinking(false);
      }
      showToast('انتظر اكتمال رفع الصور', 'info');
      return;
    }

    const readyImages = attachments
      .filter((a) => a.status === 'ready' && a.publicUrl)
      .map((a) => a.publicUrl as string);

    setHasInteracted(true);
    setSupabaseNoticeMsgId(null);

    const userMsg: LocalChatMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      text,
      createdAt: new Date().toISOString(),
      images: readyImages.length > 0 ? readyImages : undefined,
    };

    const nextHistory = [
      ...messagesRef.current.filter((m) => !m.isRetryStatus),
      userMsg,
    ];
    syncMessagesToStorage(nextHistory, attachments);
    setMessages(nextHistory);
    setThinking(true);
    trackAppEvent('chat_prompt_sent', { length: text.length });

    const attemptToken = ++activeAttemptToken;
    const historyPayload = nextHistory
      .filter((m) => m.id !== 'welcome' && !m.isError && !m.isRetryStatus)
      .map((m) => ({ role: m.role, text: m.text }));

    await executeChatAttempt({
      attemptToken,
      attempt: 1,
      userMessageId: userMsg.id,
      messageText: text,
      history: historyPayload,
      images: readyImages,
    });
  };

  const handleEnableNotificationsInline = async () => {
    const res = await requestAndRegisterBuildNotifications();
    if (res.granted) {
      setNotifDeniedBanner(false);
      showToast('تم تفعيل إشعارات جاهزية التطبيق بنجاح', 'success');
    } else {
      setNotifDeniedBanner(res.supported);
      showToast(
        res.status === 'denied'
          ? 'تم رفض الإذن — يمكنك تفعيل الإشعارات لاحقاً من الإعدادات أو شاشة حسابي'
          : res.reason || 'تعذّر تفعيل الإشعارات',
        'info',
      );
    }
  };

  const markBuildStarted = (msgId: string, buildId: string) => {
    setStartedBuilds((prev) => {
      const next = { ...prev, [msgId]: { buildId, startedAt: Date.now() } };
      writeStartedBuilds(next);
      return next;
    });
  };

  // بعد انتهاء مهلة الانتظار قد يكون السيرفر بدأ البناء فعلاً — ابحث عن بناء «building»
  // حديث بنفس الوصف قبل إظهار خطأ، حتى لا يضغط المستخدم «ابنِ التطبيق» مرة ثانية.
  const findJustStartedBuild = async (description: string) => {
    try {
      const builds = await backend.getBuilds();
      const wanted = description.trim();
      const recent = builds
        .filter((b) => b.status === 'building')
        .filter((b) => Date.now() - new Date(b.created_at).getTime() < 3 * 60 * 1000)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      return recent.find((b) => b.description.trim() === wanted) ?? recent[0] ?? null;
    } catch {
      return null;
    }
  };

  const handleBuildApp = async (msgId: string, description: string, estimate: EstimatePayload) => {
    if (buildingId) return;

    // إن كان لهذا التقدير بناء شغال بالفعل، لا تخصم مرة ثانية — خذه إلى تطبيقاتي
    if (startedBuilds[msgId]) {
      showToast('هذا البناء بدأ بالفعل — تابعه في تطبيقاتي', 'info');
      navigate('/builds');
      return;
    }

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

    const readyImages = attachments
      .filter((a) => a.status === 'ready' && a.publicUrl)
      .map((a) => a.publicUrl as string);

    setBuildingId(msgId);
    try {
      const notifRes = await requestAndRegisterBuildNotifications();
      if (!notifRes.granted && notifRes.supported) {
        setNotifDeniedBanner(true);
        showToast('تم رفض إذن الإشعارات — سيستمر بناء التطبيق ويمكنك تفعيلها لاحقاً', 'info');
      } else if (notifRes.granted) {
        setNotifDeniedBanner(false);
      }

      let res: Awaited<ReturnType<typeof backend.startBuild>>;
      try {
        res = await backend.startBuild({
          description,
          complexity: estimate.complexity,
          images: readyImages,
        });
      } catch (invokeErr) {
        // انتهت مهلة الانتظار أو انقطع الاتصال — قد يكون البناء بدأ في السيرفر فعلاً
        const started = await findJustStartedBuild(description);
        if (started) {
          markBuildStarted(msgId, started.id);
          await refreshProfile();
          showToast('البناء بدأ بالفعل — تابع حالته في تطبيقاتي', 'success');
          navigate('/builds');
          return;
        }
        throw invokeErr;
      }
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

      if (res.deduped) {
        markBuildStarted(msgId, res.build.id);
        await refreshProfile();
        showToast('هذا البناء شغال بالفعل — تابعه في تطبيقاتي', 'info');
        navigate('/builds');
        return;
      }

      markBuildStarted(msgId, res.build.id);
      clearAttachments();
      await refreshProfile();
      trackAppEvent('build_started', { complexity: estimate.complexity, points: estimate.points });
      showToast('تم خصم النقاط وبدء بناء تطبيقك!', 'success');
      navigate('/builds');
    } catch {
      showToast('تعذّر بدء البناء حالياً — حاول لاحقاً', 'error');
    } finally {
      setBuildingId(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const readyAttachments = attachments.filter(
    (a) => a.status === 'ready' && Boolean(a.publicUrl),
  );
  const latestEstimateMsgId = [...messages]
    .reverse()
    .find((m) => m.role === 'bot' && Boolean(m.estimate))?.id;

  return (
    <MobileShell>
      {/* Top App Header */}
      <header className="shrink-0 bg-[#101D35] text-white px-4 py-3 flex items-center justify-between gap-2 shadow-sm">
        <div className="flex items-center gap-2.5 min-w-0">
          <BoslaLogo size={38} variant="dark" />
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
                  {msg.images && msg.images.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {msg.images.map((url, idx) => (
                        <a
                          key={`${msg.id}_img_${idx}`}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block w-14 h-14 rounded-lg overflow-hidden border border-white/25 bg-white/10 shrink-0 hover:opacity-90 transition-opacity"
                        >
                          <img
                            src={url}
                            alt={`صورة مرفقة ${idx + 1}`}
                            className="w-full h-full object-cover"
                          />
                        </a>
                      ))}
                    </div>
                  )}
                  <p className="whitespace-pre-line">{msg.text}</p>
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
                      {msg.isRetryStatus ? (
                        <div className="flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin text-[#2878E8] shrink-0" />
                          <p className="whitespace-pre-line">{msg.text}</p>
                        </div>
                      ) : (
                        <p className="whitespace-pre-line">{msg.text}</p>
                      )}
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

                        {msg.id === latestEstimateMsgId && readyAttachments.length > 0 && (
                          <div className="space-y-2 pt-1">
                            <p className="text-xs font-bold text-[#101D35]">
                              الصور المرفقة في البناء
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {readyAttachments.map((att) => (
                                <div
                                  key={`est_${att.id}`}
                                  className="relative w-14 h-14 rounded-xl overflow-hidden border border-slate-200 bg-slate-100 shrink-0"
                                >
                                  <img
                                    src={att.previewUrl || att.publicUrl}
                                    alt="صورة مرفقة في البناء"
                                    className="w-full h-full object-cover"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveAttachment(att.id)}
                                    aria-label="إزالة الصورة"
                                    className="absolute top-1 left-1 w-5 h-5 rounded-full bg-[#101D35]/85 hover:bg-[#101D35] text-white flex items-center justify-center transition-colors"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {supabaseNoticeMsgId === msg.id && (
                          <div className="rounded-xl bg-[#FFF9EB] border border-[#D5B45C]/50 px-3 py-2.5 text-xs font-semibold text-[#7B5D12]">
                            البناء الحقيقي يحتاج ربط Supabase (أضف مفاتيح المشروع في ملف .env لتشغيل خط بناء APK).
                          </div>
                        )}

                        {startedBuilds[msg.id] ? (
                          <button
                            type="button"
                            onClick={() => navigate('/builds')}
                            className="w-full min-h-[46px] rounded-xl bg-[#101D35] hover:bg-[#1B2C4E] text-white font-bold text-sm flex items-center justify-center gap-2 shadow-sm active:scale-[0.98] transition-all"
                          >
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>قيد البناء — تابع في تطبيقاتي</span>
                          </button>
                        ) : (
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
                        )}
                      </motion.div>
                    )}
                  </div>

                  <div className="shrink-0 mt-1">
                    <BoslaLogo size={30} variant="light" />
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
            <BoslaLogo size={30} variant="light" />
          </motion.div>
        )}

        <div ref={listEndRef} />
      </div>

      {/* Notification Denied In-Page Status Banner */}
      {notifDeniedBanner && (
        <div className="shrink-0 bg-[#FFF9EB] border-t border-[#D5B45C]/40 px-3.5 py-2.5 flex items-center justify-between gap-2 text-[11px] text-[#7B5D12]">
          <div className="flex items-start gap-2 min-w-0">
            <BellOff className="w-4 h-4 text-[#B8922E] shrink-0 mt-0.5" />
            <div className="min-w-0 space-y-1">
              <p className="font-bold leading-snug">
                تم رفض إذن الإشعارات — سيستمر بناء تطبيقك بشكل طبيعي، ولن تصلك إشعارات الجاهزية تلقائياً.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleEnableNotificationsInline}
                  className="font-extrabold text-[#2878E8] underline"
                >
                  إعادة السؤال عن الإذن
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/profile')}
                  className="font-bold text-[#101D35] underline"
                >
                  تفعيلها من حسابي
                </button>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setNotifDeniedBanner(false)}
            aria-label="إغلاق التنبيه"
            className="p-1 text-[#7B5D12] hover:text-[#101D35] shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Chat Composer */}
      <form
        onSubmit={handleSubmit}
        className="shrink-0 bg-white border-t border-slate-200 p-3 space-y-2"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFilesSelected}
          className="hidden"
        />

        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={thinking || (!attachmentsSent && attachments.length >= MAX_ATTACHED_IMAGES)}
            aria-label="إرفاق صورة"
            className="min-w-[46px] min-h-[46px] rounded-xl border border-slate-300 bg-[#F8FAFC] hover:bg-slate-100 disabled:opacity-50 text-[#101D35] flex items-center justify-center transition-colors shrink-0"
          >
            <ImagePlus className="w-5 h-5" />
          </button>

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
            disabled={!input.trim() || (thinking && !isWaitingRetry)}
            aria-label="إرسال الوصف"
            className="min-w-[46px] min-h-[46px] rounded-xl bg-[#2878E8] hover:bg-[#1E66CC] disabled:bg-slate-200 disabled:text-slate-400 text-white flex items-center justify-center transition-all active:scale-95 shrink-0"
          >
            <SendHorizontal className="w-5 h-5 rotate-180" />
          </button>
        </div>

        {/* Attached Images Thumbnails */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-0.5">
            {attachments.map((att) => (
              <div
                key={att.id}
                className={`relative w-16 h-16 rounded-xl overflow-hidden border bg-slate-100 shrink-0 ${
                  att.status === 'error' ? 'border-red-400' : 'border-slate-200'
                }`}
              >
                <img
                  src={att.previewUrl}
                  alt="معاينة الصورة"
                  className="w-full h-full object-cover"
                />

                {att.status === 'uploading' && (
                  <div className="absolute inset-0 bg-[#101D35]/55 flex items-center justify-center">
                    <Loader2 className="w-5 h-5 text-white animate-spin" />
                  </div>
                )}

                {att.status === 'error' && (
                  <div className="absolute inset-0 bg-red-950/75 flex flex-col items-center justify-center gap-1 p-1">
                    <span className="text-[9px] font-bold text-white leading-tight text-center">
                      فشل الرفع
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRetryUpload(att)}
                      aria-label="إعادة المحاولة"
                      className="w-6 h-6 rounded-full bg-white/90 text-[#101D35] flex items-center justify-center hover:bg-white transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => handleRemoveAttachment(att.id)}
                  aria-label="إزالة الصورة"
                  className="absolute top-1 left-1 w-5 h-5 rounded-full bg-[#101D35]/85 hover:bg-[#101D35] text-white flex items-center justify-center transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {input.length > 1500 && (
          <div className="text-[11px] text-slate-400 tabular-nums px-1">
            {input.length} / {MAX_CHARS} حرف
          </div>
        )}
      </form>
    </MobileShell>
  );
}
