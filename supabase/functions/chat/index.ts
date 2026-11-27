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
    const geminiKey = Deno.env.get('GEMINI_API_KEY');

    if (!geminiKey) {
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

    const ai = new GoogleGenAI({ apiKey: geminiKey });
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

    let aiRes;
    const callGemini = async (model: string) => {
      const startedAt = Date.now();
      console.log(`[chat] calling Gemini model=${model} msgLen=${message.length}`);
      try {
        const res = await ai.models.generateContent({
          model,
          contents: prompt,
          config: requestConfig,
        });
        console.log(`[chat] Gemini succeeded model=${model} durationMs=${Date.now() - startedAt}`);
        return res;
      } catch (err) {
        console.error(
          `[chat] Gemini failed model=${model} durationMs=${Date.now() - startedAt}:`,
          err instanceof Error ? err.message : String(err),
        );
        throw err;
      }
    };

    try {
      aiRes = await callGemini('gemini-3.5-flash');
    } catch {
      aiRes = await callGemini('gemini-3.8-flash');
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

    const parsed = JSON.parse(rawText) as {
      action?: string;
      reply?: unknown;
      complexity?: string;
      features?: unknown;
      reason?: string;
    };

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
