// Supabase Edge Function: chat
// Analyses the user's Arabic app prompt via Gemini API (server-side only)
// and computes server-authoritative complexity points + SDG price.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { GoogleGenAI, Type } from 'npm:@google/genai@1.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const COMPLEXITY_POINTS = {
  simple: 100,
  medium: 400,
  complex: 800,
} as const;

const MODEL_35_FLASH = 'gemini-3.5-flash';
const MODEL_38_FLASH = 'gemini-3.8-flash';
const MODEL_35_FLASH_LITE = 'gemini-3.5-flash-lite';
const GEMINI_MODELS = [MODEL_35_FLASH, MODEL_38_FLASH, MODEL_35_FLASH_LITE] as const;
const RETRY_503_DELAYS_MS = [3000, 6000] as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function getErrorStatus(err: unknown): number | null {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = Number((err as { status?: unknown }).status);
    if (status === 429 || status === 503) return status;
  }
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (msg.includes('429')) return 429;
  if (msg.includes('503')) return 503;
  return null;
}

const SYSTEM_INSTRUCTION = `أنت المساعد الذكي لتطبيق "بوصلة التطبيقات" — منصة تحوّل وصفاً عربياً بسيطاً من مبتدئ إلى تطبيق أندرويد حقيقي.
1. إذا كان الوصف غامضاً أو كلمة واحدة أو غير مفهوم أو خارج موضوع التطبيقات:
   - action = "clarify"
   - reply = سؤال توضيحي واحد قصير وودود باللهجة العربية/السودانية البسيطة.
2. إذا كان الوصف واضحاً:
   - action = "estimate"
   - reply = 2 إلى 3 جمل قصيرة ترحب بالفكرة (ممنوع ذكر النقاط أو السعر في النص).
   - complexity = "simple" | "medium" | "complex"
   - features = 3 إلى 5 نقاط قصيرة لمميزات التطبيق.
   - reason = سطر واحد يبدأ بـ "السبب: " يوضح سبب المستوى المختار.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const geminiKeys: string[] = [];
    for (let i = 1; i <= 10; i++) {
      const envName = i === 1 ? 'GEMINI_API_KEY' : `GEMINI_API_KEY_${i}`;
      const val = Deno.env.get(envName)?.trim();
      if (val) geminiKeys.push(val);
    }

    if (geminiKeys.length === 0) {
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY missing on server' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const message = String(body.message || '').trim().slice(0, 2000);
    const history = Array.isArray(body.history) ? body.history.slice(-6) : [];

    if (!message) {
      return new Response(JSON.stringify({ error: 'Empty message' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: settingsRow } = await supabase
      .from('settings')
      .select('point_price_sdg')
      .eq('id', 1)
      .single();

    const pointPriceSdg = Number(settingsRow?.point_price_sdg) || 50;

    const historyText = history
      .map((m: { role: string; text: string }) =>
        `${m.role === 'user' ? 'المستخدم' : 'البوت'}: ${m.text}`,
      )
      .join('\n');

    const prompt = historyText
      ? `المحادثة السابقة:\n${historyText}\n\nالرسالة الجديدة:\n${message}`
      : `وصف المستخدم:\n${message}`;

    const requestConfig = {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          action: { type: Type.STRING },
          reply: { type: Type.STRING },
          complexity: { type: Type.STRING },
          features: { type: Type.ARRAY, items: { type: Type.STRING } },
          reason: { type: Type.STRING },
        },
        required: ['action', 'reply'],
      },
    };

    let aiRes: { text?: string } | null = null;
    for (let k = 0; k < geminiKeys.length; k++) {
      const keyNumber = k + 1;
      const ai = new GoogleGenAI({ apiKey: geminiKeys[k] });
      let hit429 = false;

      for (const model of GEMINI_MODELS) {
        for (let attempt = 1; attempt <= 3; attempt++) {
          const startedAt = Date.now();
          console.log(
            `[chat] calling Gemini key #${keyNumber} model=${model} attempt=${attempt} msgLen=${message.length}`,
          );
          try {
            const res = await ai.models.generateContent({
              model,
              contents: prompt,
              config: requestConfig,
            });
            console.log(
              `[chat] Gemini succeeded key #${keyNumber} model=${model} durationMs=${Date.now() - startedAt}`,
            );
            aiRes = res;
            break;
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error(
              `[chat] Gemini failed key #${keyNumber} model=${model} durationMs=${Date.now() - startedAt}:`,
              errMsg,
            );
            const status = getErrorStatus(err);
            if (status === 429) {
              hit429 = true;
              break;
            }
            if (status === 503 && attempt < 3) {
              await sleep(RETRY_503_DELAYS_MS[attempt - 1]);
              continue;
            }
            break;
          }
        }
        if (aiRes || hit429) break;
      }
      if (aiRes) break;
    }

    if (!aiRes) {
      console.error('[chat] all Gemini keys and models exhausted');
      return new Response(
        JSON.stringify({ error: 'تعذّر الحصول على رد من الذكاء الاصطناعي حالياً — حاول لاحقاً' }),
        {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    const rawText = (aiRes.text ?? '').trim();
    if (!rawText) {
      console.error('[chat] Gemini returned empty response text');
      return new Response(
        JSON.stringify({ error: 'تعذّر استلام رد من الذكاء الاصطناعي — حاول لاحقاً' }),
        {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    let parsed: {
      action?: string;
      reply?: unknown;
      complexity?: string;
      features?: unknown;
      reason?: string;
    };
    try {
      parsed = JSON.parse(rawText) as {
        action?: string;
        reply?: unknown;
        complexity?: string;
        features?: unknown;
        reason?: string;
      };
    } catch {
      console.error('[chat] Gemini returned invalid JSON:', rawText.slice(0, 300));
      return new Response(
        JSON.stringify({ error: 'تعذّر قراءة رد الذكاء الاصطناعي — حاول لاحقاً' }),
        {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    const replyText = typeof parsed?.reply === 'string' ? parsed.reply.trim() : '';
    if (!replyText) {
      console.error('[chat] Gemini JSON missing valid reply:', rawText.slice(0, 300));
      return new Response(
        JSON.stringify({ error: 'تعذّر قراءة رد الذكاء الاصطناعي — حاول لاحقاً' }),
        {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    if (parsed.action === 'estimate') {
      const complexity =
        parsed.complexity === 'complex'
          ? 'complex'
          : parsed.complexity === 'medium'
            ? 'medium'
            : 'simple';
      const points = COMPLEXITY_POINTS[complexity];
      return new Response(
        JSON.stringify({
          action: 'estimate',
          reply: replyText,
          complexity,
          points,
          price_sdg: points * pointPriceSdg,
          features: Array.isArray(parsed.features) ? parsed.features.slice(0, 5) : [],
          reason: typeof parsed.reason === 'string' ? parsed.reason : '',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ action: 'clarify', reply: replyText }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[chat] unhandled error:', err instanceof Error ? err.message : String(err));
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
