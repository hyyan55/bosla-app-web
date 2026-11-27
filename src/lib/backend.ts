import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  AppBuild,
  AppSettings,
  ComplexityLevel,
  EstimatePayload,
  PointsTransaction,
  TopupMethod,
  TopupRequest,
  UserProfile,
} from '../types';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

const isPlaceholder = (val: string) =>
  !val || val.includes('YOUR_PROJECT_ID') || val.includes('YOUR_SUPABASE_ANON_KEY');

export const isSupabaseConfigured =
  !isPlaceholder(SUPABASE_URL) && !isPlaceholder(SUPABASE_ANON_KEY);

export const isDemoMode = !isSupabaseConfigured;

// Generous timeout fetch for slow 4G networks (30s read / connect)
async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 30000);
  try {
    return await fetch(input, {
      ...init,
      signal: init?.signal ?? controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      global: {
        fetch: fetchWithTimeout,
      },
    })
  : null;

export const COMPLEXITY_POINTS: Record<ComplexityLevel, number> = {
  simple: 100,
  medium: 400,
  complex: 800,
};

export const COMPLEXITY_LABELS: Record<ComplexityLevel, string> = {
  simple: 'بسيط',
  medium: 'متوسط',
  complex: 'معقد',
};

export const TOPUP_METHOD_LABELS: Record<TopupMethod, string> = {
  bankak: 'بنكك',
  sahil: 'ساهل',
  mycashy: 'ماي كاشي',
};

// Session expiration listeners so UI can redirect cleanly with Arabic message
type SessionExpiredListener = (message: string) => void;
const sessionExpiredListeners = new Set<SessionExpiredListener>();

export function onSessionExpired(listener: SessionExpiredListener): () => void {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

function notifySessionExpired() {
  const msg = 'انتهت جلستك — سجّل دخولك من جديد ثم حاول.';
  sessionExpiredListeners.forEach((fn) => fn(msg));
}

function isUnauthorizedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const anyErr = err as { status?: number; code?: string | number; message?: string };
  if (anyErr.status === 401 || anyErr.code === 401 || anyErr.code === '401') return true;
  const msg = (anyErr.message || '').toLowerCase();
  return msg.includes('jwt expired') || msg.includes('unauthorized') || msg.includes('401');
}

async function withSessionRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    if (!supabase || !isUnauthorizedError(err)) {
      throw err;
    }
    const { data, error: refreshErr } = await supabase.auth.refreshSession();
    if (refreshErr || !data.session) {
      await supabase.auth.signOut().catch(() => undefined);
      notifySessionExpired();
      throw new Error('انتهت جلستك — سجّل دخولك من جديد ثم حاول.');
    }
    try {
      return await operation();
    } catch (retryErr) {
      if (isUnauthorizedError(retryErr)) {
        await supabase.auth.signOut().catch(() => undefined);
        notifySessionExpired();
        throw new Error('انتهت جلستك — سجّل دخولك من جديد ثم حاول.');
      }
      throw retryErr;
    }
  }
}

// ============================================================================
// Demo Mode Local Store (used ONLY when Supabase env vars are not configured)
// ============================================================================
const DEMO_STORAGE_KEY = 'bosla_demo_store_v1';

interface DemoAccount {
  id: string;
  full_name: string;
  username: string;
  email: string;
  phone?: string;
  password_hash: string;
  wallet_number: string;
  points_balance: number;
  email_verified: boolean;
  is_admin: boolean;
  created_at: string;
}

interface DemoStore {
  accounts: DemoAccount[];
  currentUserId: string | null;
  pendingVerifyEmail: string | null;
  transactions: PointsTransaction[];
  topupRequests: TopupRequest[];
  builds: AppBuild[];
  settings: AppSettings;
  nextWalletSeq: number;
  adminCredentials: {
    username: string;
    passwordHash: string;
  };
}

const DEFAULT_SETTINGS: AppSettings = {
  point_price_sdg: 50,
  gift_points: 20,
  admin_whatsapp: '249912345678',
};

const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD_HASH =
  '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92';

async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const data = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback pure-JS SHA-256 for non-secure contexts
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const bytes = Array.from(new TextEncoder().encode(input));
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while ((bytes.length % 64) !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push((bitLen / Math.pow(2, i * 8)) & 0xff);
  const w = new Array<number>(64);
  const rotr = (n: number, x: number) => (x >>> n) | (x << (32 - n));
  for (let i = 0; i < bytes.length; i += 64) {
    for (let t = 0; t < 16; t++) {
      w[t] =
        (bytes[i + t * 4] << 24) |
        (bytes[i + t * 4 + 1] << 16) |
        (bytes[i + t * 4 + 2] << 8) |
        bytes[i + t * 4 + 3];
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(7, w[t - 15]) ^ rotr(18, w[t - 15]) ^ (w[t - 15] >>> 3);
      const s1 = rotr(17, w[t - 2]) ^ rotr(19, w[t - 2]) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t] + w[t]) | 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + temp1) | 0;
      d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0;
    H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0;
    H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  return H.map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('');
}

function simpleClientDigest(input: string): string {
  // Deterministic non-reversible digest for demo-only localStorage accounts
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return `demo_${(hash >>> 0).toString(16)}`;
}

function readDemoStore(): DemoStore {
  try {
    localStorage.removeItem('bosla_local_gemini_key');
  } catch {
    // ignore
  }
  try {
    const raw = localStorage.getItem(DEMO_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DemoStore>;
      const store: DemoStore = {
        accounts: parsed.accounts || [],
        currentUserId: parsed.currentUserId || null,
        pendingVerifyEmail: parsed.pendingVerifyEmail || null,
        transactions: parsed.transactions || [],
        topupRequests: parsed.topupRequests || [],
        builds: parsed.builds || [],
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
        nextWalletSeq: parsed.nextWalletSeq || 2001,
        adminCredentials: parsed.adminCredentials?.username && parsed.adminCredentials?.passwordHash
          ? parsed.adminCredentials
          : {
              username: DEFAULT_ADMIN_USERNAME,
              passwordHash: DEFAULT_ADMIN_PASSWORD_HASH,
            },
      };
      if (!parsed.adminCredentials) {
        localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(store));
      }
      return store;
    }
  } catch {
    // ignore corrupted store
  }

  const initial: DemoStore = {
    accounts: [],
    currentUserId: null,
    pendingVerifyEmail: null,
    transactions: [],
    topupRequests: [],
    builds: [],
    settings: { ...DEFAULT_SETTINGS },
    nextWalletSeq: 2001,
    adminCredentials: {
      username: DEFAULT_ADMIN_USERNAME,
      passwordHash: DEFAULT_ADMIN_PASSWORD_HASH,
    },
  };
  localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(initial));
  return initial;
}

function writeDemoStore(store: DemoStore): void {
  localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(store));
}

function toUserProfile(acc: DemoAccount): UserProfile {
  return {
    id: acc.id,
    full_name: acc.full_name,
    username: acc.username,
    email: acc.email,
    phone: acc.phone,
    wallet_number: acc.wallet_number,
    points_balance: acc.points_balance,
    email_verified: acc.email_verified,
    is_admin: acc.is_admin,
    created_at: acc.created_at,
  };
}

function ensureDemoWalletForAccount(store: DemoStore, acc: DemoAccount): void {
  if (!acc.wallet_number) {
    const walletNum = `BOS-${store.nextWalletSeq}`;
    store.nextWalletSeq += 1;
    acc.wallet_number = walletNum;
    const gift = store.settings.gift_points;
    acc.points_balance = gift;
    store.transactions.unshift({
      id: `tx_${Date.now()}`,
      user_id: acc.id,
      wallet_number: walletNum,
      user_name: acc.full_name,
      type: 'gift',
      amount: gift,
      balance_after: gift,
      description: 'هدية ترحيبية عند إنشاء المحفظة',
      created_at: new Date().toISOString(),
    });
  }
}

// ============================================================================
// Public Service Layer API
// ============================================================================

export const backend = {
  isDemoMode,
  isSupabaseConfigured,

  async getSettings(): Promise<AppSettings> {
    if (!supabase) {
      return readDemoStore().settings;
    }

    try {
      const { data, error } = await supabase
        .from('settings')
        .select('point_price_sdg, gift_points, admin_whatsapp')
        .eq('id', 1)
        .single();
      if (error || !data) return { ...DEFAULT_SETTINGS };
      return {
        point_price_sdg: Number(data.point_price_sdg) || 50,
        gift_points: Number(data.gift_points) || 20,
        admin_whatsapp: data.admin_whatsapp || DEFAULT_SETTINGS.admin_whatsapp,
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  },

  async getCurrentProfile(): Promise<{
    user: UserProfile | null;
    unverifiedEmail?: string;
  }> {
    if (!supabase) {
      const store = readDemoStore();
      if (!store.currentUserId) {
        return {
          user: null,
          unverifiedEmail: store.pendingVerifyEmail || undefined,
        };
      }
      const acc = store.accounts.find((a) => a.id === store.currentUserId);
      if (!acc) {
        store.currentUserId = null;
        writeDemoStore(store);
        return { user: null };
      }
      if (!acc.email_verified) {
        return { user: null, unverifiedEmail: acc.email };
      }
      ensureDemoWalletForAccount(store, acc);
      writeDemoStore(store);
      return { user: toUserProfile(acc) };
    }

    return withSessionRetry(async () => {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const session = sessionData.session;
      if (!session) return { user: null };

      const authUser = session.user;
      if (!authUser.email_confirmed_at) {
        return { user: null, unverifiedEmail: authUser.email || undefined };
      }

      // Ensure wallet exists on first verified login
      const { error: rpcErr } = await supabase.rpc('ensure_wallet');
      if (rpcErr && isUnauthorizedError(rpcErr)) throw rpcErr;

      const { data: profile, error: profErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .single();

      if (profErr) {
        if (isUnauthorizedError(profErr)) throw profErr;
        throw new Error('تعذّر تحميل بيانات الحساب');
      }

      return {
        user: {
          id: profile.id,
          full_name: profile.full_name || authUser.user_metadata?.full_name || 'مستخدم بوصلة',
          username: profile.username || authUser.user_metadata?.username || 'user',
          email: profile.email || authUser.email || '',
          phone: profile.phone || undefined,
          wallet_number: profile.wallet_number,
          points_balance: Number(profile.points_balance) || 0,
          email_verified: true,
          is_admin: Boolean(profile.is_admin),
          created_at: profile.created_at,
        },
      };
    });
  },

  async login(
    email: string,
    password: string,
  ): Promise<
    | { ok: true; user: UserProfile }
    | { ok: false; unverified?: boolean; email?: string; message: string }
  > {
    const cleanEmail = email.trim().toLowerCase();

    if (!supabase) {
      const store = readDemoStore();
      const acc = store.accounts.find((a) => a.email.toLowerCase() === cleanEmail);
      if (!acc || acc.password_hash !== simpleClientDigest(password)) {
        return { ok: false, message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' };
      }
      if (!acc.email_verified) {
        store.pendingVerifyEmail = acc.email;
        writeDemoStore(store);
        return {
          ok: false,
          unverified: true,
          email: acc.email,
          message: 'فعّل بريدك أولاً',
        };
      }
      ensureDemoWalletForAccount(store, acc);
      store.currentUserId = acc.id;
      store.pendingVerifyEmail = null;
      writeDemoStore(store);
      return { ok: true, user: toUserProfile(acc) };
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('email not confirmed')) {
        return {
          ok: false,
          unverified: true,
          email: cleanEmail,
          message: 'فعّل بريدك أولاً',
        };
      }
      if (msg.includes('invalid login credentials')) {
        return { ok: false, message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' };
      }
      return { ok: false, message: 'تعذّر تسجيل الدخول — تحقق من الاتصال وحاول مجدداً' };
    }

    if (!data.user?.email_confirmed_at) {
      await supabase.auth.signOut().catch(() => undefined);
      return {
        ok: false,
        unverified: true,
        email: cleanEmail,
        message: 'فعّل بريدك أولاً',
      };
    }

    const profileRes = await this.getCurrentProfile();
    if (!profileRes.user) {
      return { ok: false, message: 'تعذّر تحميل بيانات المحفظة' };
    }
    return { ok: true, user: profileRes.user };
  },

  async signup(params: {
    fullName: string;
    username: string;
    email: string;
    password: string;
  }): Promise<{ ok: true; email: string } | { ok: false; message: string }> {
    const cleanEmail = params.email.trim().toLowerCase();
    const cleanUsername = params.username.trim();
    const cleanName = params.fullName.trim();

    if (!supabase) {
      const store = readDemoStore();
      if (store.accounts.some((a) => a.email.toLowerCase() === cleanEmail)) {
        return { ok: false, message: 'هذا البريد مسجّل بالفعل' };
      }
      if (store.accounts.some((a) => a.username.toLowerCase() === cleanUsername.toLowerCase())) {
        return { ok: false, message: 'اسم المستخدم مستخدم من قبل' };
      }

      const newAcc: DemoAccount = {
        id: `usr_${Date.now()}`,
        full_name: cleanName,
        username: cleanUsername,
        email: cleanEmail,
        password_hash: simpleClientDigest(params.password),
        wallet_number: '',
        points_balance: 0,
        email_verified: false,
        is_admin: store.accounts.length === 0,
        created_at: new Date().toISOString(),
      };
      store.accounts.push(newAcc);
      store.pendingVerifyEmail = cleanEmail;
      writeDemoStore(store);
      return { ok: true, email: cleanEmail };
    }

    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password: params.password,
      options: {
        emailRedirectTo: `${window.location.origin}/verified`,
        data: {
          full_name: cleanName,
          username: cleanUsername,
        },
      },
    });

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('already registered') || msg.includes('already exists')) {
        return { ok: false, message: 'هذا البريد مسجّل بالفعل' };
      }
      return { ok: false, message: 'تعذّر إنشاء الحساب — حاول مرة أخرى' };
    }

    // Supabase returns empty identities when email already exists and confirmation is enabled
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return { ok: false, message: 'هذا البريد مسجّل بالفعل' };
    }

    return { ok: true, email: cleanEmail };
  },

  async resendVerification(email: string): Promise<{ ok: boolean; message: string }> {
    const cleanEmail = email.trim().toLowerCase();
    if (!supabase) {
      return { ok: true, message: 'تم إرسال رابط التفعيل لبريدك' };
    }
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: cleanEmail,
      options: {
        emailRedirectTo: `${window.location.origin}/verified`,
      },
    });
    if (error) {
      return { ok: false, message: 'تعذّر إعادة الإرسال حالياً — حاول بعد قليل' };
    }
    return { ok: true, message: 'تم إعادة إرسال رابط التفعيل بنجاح' };
  },

  // Used ONLY in Demo Mode to simulate clicking the verification email link
  async completeDemoVerification(email: string): Promise<boolean> {
    if (supabase) return false;
    const store = readDemoStore();
    const acc = store.accounts.find((a) => a.email.toLowerCase() === email.toLowerCase());
    if (!acc) return false;
    acc.email_verified = true;
    ensureDemoWalletForAccount(store, acc);
    store.pendingVerifyEmail = null;
    writeDemoStore(store);
    return true;
  },

  getPendingVerificationEmail(): string | null {
    if (!supabase) {
      return readDemoStore().pendingVerifyEmail;
    }
    return null;
  },

  async requestPasswordReset(email: string): Promise<{ ok: boolean; message: string }> {
    const cleanEmail = email.trim().toLowerCase();
    if (!supabase) {
      const store = readDemoStore();
      const acc = store.accounts.find((a) => a.email.toLowerCase() === cleanEmail);
      if (!acc) {
        return { ok: false, message: 'لا يوجد حساب مسجّل بهذا البريد' };
      }
      store.pendingVerifyEmail = cleanEmail;
      writeDemoStore(store);
      return {
        ok: true,
        message: 'تم إرسال رابط استعادة كلمة المرور (في وضع العرض يمكنك التوجه لصفحة إعادة التعيين مباشرة)',
      };
    }

    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      return { ok: false, message: 'تعذّر إرسال رابط الاستعادة — تأكد من البريد وحاول مجدداً' };
    }
    return { ok: true, message: 'تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني' };
  },

  async updatePassword(newPassword: string): Promise<{ ok: boolean; message: string }> {
    if (!supabase) {
      const store = readDemoStore();
      const target =
        store.accounts.find((a) => a.id === store.currentUserId) ||
        store.accounts.find(
          (a) => store.pendingVerifyEmail && a.email.toLowerCase() === store.pendingVerifyEmail.toLowerCase(),
        );
      if (!target) {
        return { ok: false, message: 'لم يتم العثور على جلسة لتحديث كلمة المرور' };
      }
      target.password_hash = simpleClientDigest(newPassword);
      writeDemoStore(store);
      return { ok: true, message: 'تم تحديث كلمة المرور بنجاح' };
    }

    return withSessionRetry(async () => {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        if (isUnauthorizedError(error)) throw error;
        return { ok: false, message: 'تعذّر تحديث كلمة المرور — تأكد من صلاحية الرابط' };
      }
      return { ok: true, message: 'تم تحديث كلمة المرور بنجاح' };
    });
  },

  async logout(): Promise<void> {
    if (!supabase) {
      const store = readDemoStore();
      store.currentUserId = null;
      writeDemoStore(store);
      return;
    }
    await supabase.auth.signOut().catch(() => undefined);
  },

  async getTransactions(): Promise<PointsTransaction[]> {
    if (!supabase) {
      const store = readDemoStore();
      if (!store.currentUserId) return [];
      return store.transactions.filter((t) => t.user_id === store.currentUserId);
    }

    return withSessionRetry(async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return [];
      const { data, error } = await supabase
        .from('points_transactions')
        .select('*')
        .eq('user_id', userData.user.id)
        .order('created_at', { ascending: false });

      if (error) {
        if (isUnauthorizedError(error)) throw error;
        throw new Error('تعذّر تحميل سجل المعاملات');
      }
      return (data || []) as PointsTransaction[];
    });
  },

  async submitTopupRequest(params: {
    method: TopupMethod;
    points: number;
  }): Promise<{ ok: true; request: TopupRequest; whatsappUrl: string } | { ok: false; message: string }> {
    const settings = await this.getSettings();
    const priceSdg = params.points * settings.point_price_sdg;

    const buildWhatsappLink = (name: string, walletNumber: string) => {
      const text = [
        'مرحباً إدارة بوصلة التطبيقات،',
        'أرغب في شحن رصيد محفظتي:',
        `الاسم: ${name}`,
        `رقم المحفظة: ${walletNumber}`,
        `طريقة الدفع: ${TOPUP_METHOD_LABELS[params.method]}`,
        `عدد النقاط المطلوبة: ${params.points} نقطة`,
        `المبلغ المطلوب: ${priceSdg.toLocaleString('en-US')} جنيه سوداني`,
      ].join('\n');
      const phone = settings.admin_whatsapp.replace(/[^\d]/g, '');
      return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
    };

    if (!supabase) {
      const store = readDemoStore();
      const acc = store.accounts.find((a) => a.id === store.currentUserId);
      if (!acc) return { ok: false, message: 'يرجى تسجيل الدخول أولاً' };
      const req: TopupRequest = {
        id: `top_${Date.now()}`,
        user_id: acc.id,
        wallet_number: acc.wallet_number,
        user_name: acc.full_name,
        method: params.method,
        points: params.points,
        price_sdg: priceSdg,
        status: 'pending',
        created_at: new Date().toISOString(),
      };
      store.topupRequests.unshift(req);
      writeDemoStore(store);
      return {
        ok: true,
        request: req,
        whatsappUrl: buildWhatsappLink(acc.full_name, acc.wallet_number),
      };
    }

    return withSessionRetry(async () => {
      const profRes = await this.getCurrentProfile();
      if (!profRes.user) return { ok: false, message: 'يرجى تسجيل الدخول أولاً' };

      const { data, error } = await supabase
        .from('topup_requests')
        .insert({
          user_id: profRes.user.id,
          wallet_number: profRes.user.wallet_number,
          user_name: profRes.user.full_name,
          method: params.method,
          points: params.points,
          price_sdg: priceSdg,
          status: 'pending',
        })
        .select()
        .single();

      if (error) {
        if (isUnauthorizedError(error)) throw error;
        return { ok: false, message: 'تعذّر تسجيل طلب الشحن — حاول مرة أخرى' };
      }

      return {
        ok: true,
        request: data as TopupRequest,
        whatsappUrl: buildWhatsappLink(profRes.user.full_name, profRes.user.wallet_number),
      };
    });
  },

  async getBuilds(): Promise<AppBuild[]> {
    if (!supabase) {
      const store = readDemoStore();
      if (!store.currentUserId) return [];
      return store.builds.filter((b) => b.user_id === store.currentUserId);
    }

    return withSessionRetry(async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return [];

      const { data: profile, error: profErr } = await supabase
        .from('profiles')
        .select('wallet_number')
        .eq('id', userData.user.id)
        .single();

      if (profErr) {
        if (isUnauthorizedError(profErr)) throw profErr;
        throw new Error('تعذّر تحميل قائمة التطبيقات');
      }

      const walletNumber = profile?.wallet_number;
      if (!walletNumber) return [];

      const { data, error } = await supabase
        .from('builds')
        .select('*')
        .eq('wallet_number', walletNumber)
        .order('created_at', { ascending: false });

      if (error) {
        if (isUnauthorizedError(error)) throw error;
        throw new Error('تعذّر تحميل قائمة التطبيقات');
      }

      return (data || []).map((row: Record<string, unknown>): AppBuild => {
        const rawStatus = row.status;
        const status: AppBuild['status'] =
          rawStatus === 'success'
            ? 'ready'
            : rawStatus === 'failed'
              ? 'failed'
              : 'building';

        return {
          id: String(row.id),
          user_id: userData.user!.id,
          description: String(row.prompt ?? ''),
          complexity: row.complexity as ComplexityLevel,
          points_spent: Number(row.points_charged) || 0,
          status,
          apk_url: (row.apk_artifact_url as string | null) ?? null,
          error_message: null,
          branch_name: null,
          created_at: String(row.created_at),
          updated_at: String(row.completed_at ?? row.created_at),
        };
      });
    });
  },

  async sendChatMessage(params: {
    history: Array<{ role: 'user' | 'bot'; text: string }>;
    message: string;
  }): Promise<
    | { ok: true; reply: string; estimate?: EstimatePayload }
    | { ok: false; message: string }
  > {
    if (!supabase) {
      return {
        ok: false,
        message: 'التحليل الذكي غير مفعّل بعد',
      };
    }

    const settings = await this.getSettings();

    try {
      const res = await withSessionRetry(async () => {
        const { data, error } = await supabase.functions.invoke('chat', {
          body: {
            message: params.message,
            history: params.history.slice(-6),
          },
        });
        if (error) throw error;
        return data as {
          action?: 'clarify' | 'estimate';
          reply: string;
          estimate?: {
            complexity?: ComplexityLevel;
            points?: number;
            price_sdg?: number;
            features?: string[];
            reasoning?: string;
            reason?: string;
          } | null;
          complexity?: ComplexityLevel;
          points?: number;
          price_sdg?: number;
          features?: string[];
          reason?: string;
        };
      });

      if (res.estimate && res.estimate.complexity) {
        const complexity = res.estimate.complexity;
        const points = res.estimate.points ?? COMPLEXITY_POINTS[complexity];
        const priceSdg = res.estimate.price_sdg ?? points * settings.point_price_sdg;
        return {
          ok: true,
          reply: res.reply,
          estimate: {
            complexity,
            complexityLabel: COMPLEXITY_LABELS[complexity],
            points,
            priceSdg,
            features: res.estimate.features || [],
            reason:
              res.estimate.reasoning ||
              res.estimate.reason ||
              'السبب: تقدير تلقائي بناءً على تفاصيل التطبيق.',
          },
        };
      }

      if (res.estimate === null) {
        return { ok: true, reply: res.reply };
      }

      if (res.action === 'estimate' && res.complexity) {
        const points = res.points ?? COMPLEXITY_POINTS[res.complexity];
        const priceSdg = res.price_sdg ?? points * settings.point_price_sdg;
        return {
          ok: true,
          reply: res.reply,
          estimate: {
            complexity: res.complexity,
            complexityLabel: COMPLEXITY_LABELS[res.complexity],
            points,
            priceSdg,
            features: res.features || [],
            reason: res.reason || 'السبب: تقدير تلقائي بناءً على تفاصيل التطبيق.',
          },
        };
      }

      return { ok: true, reply: res.reply };
    } catch (err) {
      if (err instanceof Error && err.message.includes('انتهت جلستك')) {
        return { ok: false, message: err.message };
      }
      return {
        ok: false,
        message: 'تعذّر الوصول للذكاء الاصطناعي — حاول لاحقاً',
      };
    }
  },

  async startBuild(params: {
    description: string;
    complexity: ComplexityLevel;
  }): Promise<
    | { ok: true; build: AppBuild }
    | { ok: false; requiresSupabase?: boolean; insufficientPoints?: boolean; message: string }
  > {
    if (!supabase) {
      // Honest notice: never simulate or fake APK builds when Supabase is not configured
      return {
        ok: false,
        requiresSupabase: true,
        message: 'البناء الحقيقي يحتاج ربط Supabase',
      };
    }

    return withSessionRetry(async () => {
      const { data, error } = await supabase.functions.invoke('start-build', {
        body: {
          description: params.description,
          complexity: params.complexity,
        },
      });

      if (error) {
        if (isUnauthorizedError(error)) throw error;
        const msg = (error.message || '').toLowerCase();
        if (msg.includes('insufficient')) {
          return {
            ok: false,
            insufficientPoints: true,
            message: 'رصيد نقاطك غير كافٍ — اشحن محفظتك أولاً',
          };
        }
        return { ok: false, message: 'تعذّر بدء البناء حالياً — حاول لاحقاً' };
      }

      if (data?.error === 'insufficient_points') {
        return {
          ok: false,
          insufficientPoints: true,
          message: 'رصيد نقاطك غير كافٍ — اشحن محفظتك أولاً',
        };
      }

      return { ok: true, build: data.build as AppBuild };
    });
  },

  // ==========================================================================
  // Admin Operations (Shared Supabase Backend or Demo Store)
  // ==========================================================================
  async adminLoginWithCredentials(
    username: string,
    password: string,
  ): Promise<{ ok: boolean; message?: string }> {
    const cleanUser = username.trim();
    const passHash = await sha256Hex(password);

    if (!supabase) {
      const store = readDemoStore();
      if (
        cleanUser === store.adminCredentials.username &&
        passHash === store.adminCredentials.passwordHash
      ) {
        return { ok: true };
      }
      return { ok: false, message: 'بيانات الدخول غير صحيحة' };
    }

    const { data, error } = await supabase
      .from('settings')
      .select('admin_username, admin_password_hash')
      .eq('id', 1)
      .single();

    if (error || !data) {
      return { ok: false, message: 'بيانات الدخول غير صحيحة' };
    }

    const expectedUser = (data.admin_username || DEFAULT_ADMIN_USERNAME).trim();
    const expectedHash = data.admin_password_hash || DEFAULT_ADMIN_PASSWORD_HASH;

    if (cleanUser === expectedUser && passHash === expectedHash) {
      return { ok: true };
    }
    return { ok: false, message: 'بيانات الدخول غير صحيحة' };
  },

  async adminChangePassword(params: {
    currentPassword: string;
    newPassword: string;
  }): Promise<{ ok: boolean; message: string }> {
    if (params.newPassword.length < 6) {
      return { ok: false, message: 'كلمة السر الجديدة يجب أن تكون 6 أحرف على الأقل' };
    }

    const currentHash = await sha256Hex(params.currentPassword);
    const nextHash = await sha256Hex(params.newPassword);

    if (!supabase) {
      const store = readDemoStore();
      if (currentHash !== store.adminCredentials.passwordHash) {
        return { ok: false, message: 'كلمة السر الحالية غير صحيحة' };
      }
      store.adminCredentials.passwordHash = nextHash;
      writeDemoStore(store);
      return { ok: true, message: 'تم تغيير كلمة سر الإدارة بنجاح' };
    }

    const { data: settingsData, error: readErr } = await supabase
      .from('settings')
      .select('admin_password_hash')
      .eq('id', 1)
      .single();

    if (readErr || !settingsData) {
      return { ok: false, message: 'تعذّر التحقق من كلمة السر الحالية' };
    }

    const expectedHash = settingsData.admin_password_hash || DEFAULT_ADMIN_PASSWORD_HASH;
    if (currentHash !== expectedHash) {
      return { ok: false, message: 'كلمة السر الحالية غير صحيحة' };
    }

    const { data: rpcOk, error: rpcErr } = await supabase.rpc('change_admin_password', {
      old_hash: currentHash,
      new_hash: nextHash,
    });

    if (!rpcErr && rpcOk === true) {
      return { ok: true, message: 'تم تغيير كلمة سر الإدارة بنجاح' };
    }

    const { error: updateErr } = await supabase
      .from('settings')
      .update({ admin_password_hash: nextHash })
      .eq('id', 1);

    if (updateErr) {
      return { ok: false, message: 'تعذّر تحديث كلمة سر الإدارة' };
    }
    return { ok: true, message: 'تم تغيير كلمة سر الإدارة بنجاح' };
  },

  async adminSearchWallets(query: string): Promise<UserProfile[]> {
    const q = query.trim().toLowerCase();
    if (!supabase) {
      const store = readDemoStore();
      return store.accounts
        .filter((a) => a.wallet_number)
        .filter(
          (a) =>
            !q ||
            a.wallet_number.toLowerCase().includes(q) ||
            a.full_name.toLowerCase().includes(q) ||
            (a.phone || '').toLowerCase().includes(q) ||
            a.email.toLowerCase().includes(q),
        )
        .map(toUserProfile);
    }

    return withSessionRetry(async () => {
      let req = supabase.from('profiles').select('*').order('created_at', { ascending: false }).limit(50);
      if (q) {
        req = req.or(`wallet_number.ilike.%${q}%,full_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`);
      }
      const { data, error } = await req;
      if (error) {
        if (isUnauthorizedError(error)) throw error;
        throw new Error('تعذّر البحث في المحافظ');
      }
      return (data || []) as UserProfile[];
    });
  },

  async adminAdjustPoints(params: {
    userId: string;
    delta: number;
    reason: string;
  }): Promise<{ ok: boolean; newBalance?: number; message: string }> {
    if (!params.delta || Number.isNaN(params.delta)) {
      return { ok: false, message: 'أدخل عدد نقاط صحيح' };
    }

    if (!supabase) {
      const store = readDemoStore();
      const acc = store.accounts.find((a) => a.id === params.userId);
      if (!acc) return { ok: false, message: 'المحفظة غير موجودة' };

      const nextBalance = acc.points_balance + params.delta;
      if (nextBalance < 0) {
        return { ok: false, message: 'لا يمكن أن يقل رصيد المحفظة عن صفر' };
      }
      acc.points_balance = nextBalance;
      store.transactions.unshift({
        id: `tx_${Date.now()}`,
        user_id: acc.id,
        wallet_number: acc.wallet_number,
        user_name: acc.full_name,
        type: params.delta > 0 ? 'admin_credit' : 'admin_debit',
        amount: params.delta,
        balance_after: nextBalance,
        description: params.reason.trim() || (params.delta > 0 ? 'شحن إداري' : 'خصم إداري'),
        created_at: new Date().toISOString(),
      });
      writeDemoStore(store);
      return { ok: true, newBalance: nextBalance, message: 'تم تحديث رصيد المحفظة بنجاح' };
    }

    return withSessionRetry(async () => {
      const rpcName = params.delta > 0 ? 'credit_points' : 'debit_points';
      const { data, error } = await supabase.rpc(rpcName, {
        target_user_id: params.userId,
        points_amount: Math.abs(params.delta),
        tx_type: params.delta > 0 ? 'admin_credit' : 'admin_debit',
        tx_description: params.reason.trim() || (params.delta > 0 ? 'شحن إداري' : 'خصم إداري'),
      });
      if (error) {
        if (isUnauthorizedError(error)) throw error;
        return { ok: false, message: error.message || 'تعذّر تعديل النقاط' };
      }
      return { ok: true, newBalance: Number(data), message: 'تم تحديث الرصيد بنجاح' };
    });
  },

  async adminListTopupRequests(): Promise<TopupRequest[]> {
    if (!supabase) {
      return readDemoStore().topupRequests;
    }

    return withSessionRetry(async () => {
      const { data, error } = await supabase
        .from('topup_requests')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) {
        if (isUnauthorizedError(error)) throw error;
        throw new Error('تعذّر تحميل طلبات الشحن');
      }
      return (data || []) as TopupRequest[];
    });
  },

  async adminReviewTopup(params: {
    requestId: string;
    approve: boolean;
    note?: string;
  }): Promise<{ ok: boolean; message: string }> {
    if (!supabase) {
      const store = readDemoStore();
      const req = store.topupRequests.find((r) => r.id === params.requestId);
      if (!req) return { ok: false, message: 'الطلب غير موجود' };
      if (req.status !== 'pending') return { ok: false, message: 'تمت معالجة هذا الطلب مسبقاً' };

      req.status = params.approve ? 'approved' : 'rejected';
      req.admin_note = params.note?.trim() || undefined;
      req.reviewed_at = new Date().toISOString();

      if (params.approve) {
        const acc = store.accounts.find((a) => a.id === req.user_id);
        if (acc) {
          acc.points_balance += req.points;
          store.transactions.unshift({
            id: `tx_${Date.now()}`,
            user_id: acc.id,
            wallet_number: acc.wallet_number,
            user_name: acc.full_name,
            type: 'topup',
            amount: req.points,
            balance_after: acc.points_balance,
            description: `شحن رصيد عبر ${TOPUP_METHOD_LABELS[req.method]}`,
            created_at: new Date().toISOString(),
          });
        }
      }

      writeDemoStore(store);
      return {
        ok: true,
        message: params.approve ? 'تمت الموافقة وشحن النقاط بنجاح' : 'تم رفض الطلب',
      };
    }

    return withSessionRetry(async () => {
      const { error } = await supabase.rpc('approve_topup_request', {
        req_id: params.requestId,
        is_approved: params.approve,
        note_text: params.note?.trim() || null,
      });
      if (error) {
        if (isUnauthorizedError(error)) throw error;
        return { ok: false, message: error.message || 'تعذّر معالجة الطلب' };
      }
      return {
        ok: true,
        message: params.approve ? 'تمت الموافقة وشحن النقاط بنجاح' : 'تم رفض الطلب',
      };
    });
  },

  async adminListAllTransactions(): Promise<PointsTransaction[]> {
    if (!supabase) {
      return readDemoStore().transactions;
    }

    return withSessionRetry(async () => {
      const { data, error } = await supabase
        .from('points_transactions')
        .select('*, profiles(wallet_number, full_name)')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) {
        if (isUnauthorizedError(error)) throw error;
        throw new Error('تعذّر تحميل سجل المعاملات');
      }
      return (data || []).map((row: Record<string, unknown>) => {
        const prof = row.profiles as { wallet_number?: string; full_name?: string } | null;
        return {
          ...(row as unknown as PointsTransaction),
          wallet_number: prof?.wallet_number,
          user_name: prof?.full_name,
        };
      });
    });
  },

  async adminUpdateSettings(next: Partial<AppSettings>): Promise<{ ok: boolean; message: string }> {
    if (!supabase) {
      const store = readDemoStore();
      store.settings = { ...store.settings, ...next };
      writeDemoStore(store);
      return { ok: true, message: 'تم حفظ الإعدادات بنجاح' };
    }

    return withSessionRetry(async () => {
      const { error } = await supabase.from('settings').update(next).eq('id', 1);
      if (error) {
        if (isUnauthorizedError(error)) throw error;
        return { ok: false, message: 'تعذّر حفظ الإعدادات' };
      }
      return { ok: true, message: 'تم حفظ الإعدادات بنجاح' };
    });
  },
};
