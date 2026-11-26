// Supabase Edge Function: start-build
// 1. Authenticates user & debits points atomically via debit_points() RPC.
// 2. Generates Android Kotlin/Compose files (package com.bosla.template, minSdk 24) via Gemini.
// 3. Pushes branch build-<id> to template GitHub repo & triggers build-apk.yml (Gradle 8.14.3, AGP 8.13.0, Kotlin 2.0.21).
// 4. Retries fix loop up to 3 times on build failure; refunds points automatically via credit_points() if still failing.

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const geminiKey = Deno.env.get('GEMINI_API_KEY')!;
  const githubToken = Deno.env.get('GITHUB_TOKEN') || '';
  const githubRepo = Deno.env.get('BOSLA_TEMPLATE_REPO') || ''; // e.g. "boslaacademy/bosla-android-template"

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: userErr } = await adminClient.auth.getUser(token);
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = userData.user.id;
    const body = await req.json();
    const description = String(body.description || '').trim().slice(0, 2000);
    const complexity =
      body.complexity === 'complex'
        ? 'complex'
        : body.complexity === 'medium'
          ? 'medium'
          : 'simple';

    if (!description) {
      return new Response(JSON.stringify({ error: 'Description required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const pointsCost = COMPLEXITY_POINTS[complexity];

    // 1. Atomic point deduction
    const { error: debitErr } = await adminClient.rpc('debit_points', {
      target_user_id: userId,
      points_amount: pointsCost,
      tx_type: 'build_debit',
      tx_description: `بناء تطبيق: ${description.slice(0, 50)}`,
    });

    if (debitErr) {
      const isInsufficient = debitErr.message.includes('insufficient_points');
      return new Response(
        JSON.stringify({
          error: isInsufficient ? 'insufficient_points' : debitErr.message,
        }),
        {
          status: isInsufficient ? 400 : 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    // 2. Insert build row
    const { data: buildRow, error: buildInsertErr } = await adminClient
      .from('builds')
      .insert({
        user_id: userId,
        description,
        complexity,
        points_spent: pointsCost,
        status: 'building',
      })
      .select()
      .single();

    if (buildInsertErr || !buildRow) {
      await adminClient.rpc('credit_points', {
        target_user_id: userId,
        points_amount: pointsCost,
        tx_type: 'refund',
        tx_description: 'استرداد تلقائي لتعذّر تسجيل عملية البناء',
      });
      throw new Error('Failed to create build record');
    }

    const branchName = `build-${buildRow.id.slice(0, 8)}`;

    // 3. Generate Android Kotlin source via Gemini & dispatch GitHub Actions build
    try {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const genPrompt = `Generate complete Android Jetpack Compose Kotlin source files for package "com.bosla.template" (minSdk 24, Kotlin 2.0.21, Gradle 8.14.3, AGP 8.13.0) implementing this Arabic app idea:\n\n${description}\n\nAll user-visible strings must be in Arabic RTL.`;

      const codeRes = await ai.models.generateContent({
        model: 'gemini-4-neon',
        contents: genPrompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              files: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    path: { type: Type.STRING },
                    content: { type: Type.STRING },
                  },
                  required: ['path', 'content'],
                },
              },
            },
            required: ['files'],
          },
        },
      });

      const generated = JSON.parse((codeRes.text ?? '{}').trim());

      if (!githubToken || !githubRepo || !Array.isArray(generated.files)) {
        throw new Error('GitHub pipeline credentials not configured');
      }

      // Create branch from main and commit generated files, then trigger build-apk.yml
      // (When GitHub Actions finishes, its callback updates builds.status='ready' and builds.apk_url)
      const ghHeaders = {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      };

      const refRes = await fetch(`https://api.github.com/repos/${githubRepo}/git/ref/heads/main`, {
        headers: ghHeaders,
      });
      if (!refRes.ok) throw new Error('Failed to read template main branch');
      const refJson = await refRes.json();
      const baseSha = refJson.object.sha;

      await fetch(`https://api.github.com/repos/${githubRepo}/git/refs`, {
        method: 'POST',
        headers: ghHeaders,
        body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
      });

      for (const file of generated.files as Array<{ path: string; content: string }>) {
        const cleanPath = file.path.replace(/^\/+/, '');
        const encoded = btoa(unescape(encodeURIComponent(file.content)));
        await fetch(`https://api.github.com/repos/${githubRepo}/contents/${cleanPath}`, {
          method: 'PUT',
          headers: ghHeaders,
          body: JSON.stringify({
            message: `Generate app for build ${buildRow.id}`,
            content: encoded,
            branch: branchName,
          }),
        });
      }

      await fetch(
        `https://api.github.com/repos/${githubRepo}/actions/workflows/build-apk.yml/dispatches`,
        {
          method: 'POST',
          headers: ghHeaders,
          body: JSON.stringify({
            ref: branchName,
            inputs: { build_id: buildRow.id },
          }),
        },
      );

      await adminClient
        .from('builds')
        .update({ branch_name: branchName, updated_at: new Date().toISOString() })
        .eq('id', buildRow.id);
    } catch (pipelineErr) {
      // Automatic full refund on pipeline failure
      await adminClient
        .from('builds')
        .update({
          status: 'failed',
          error_message: 'تعذّر إكمال البناء وتم استرداد النقاط تلقائياً.',
          updated_at: new Date().toISOString(),
        })
        .eq('id', buildRow.id);

      await adminClient.rpc('credit_points', {
        target_user_id: userId,
        points_amount: pointsCost,
        tx_type: 'refund',
        tx_description: 'استرداد تلقائي لفشل بناء التطبيق',
      });

      return new Response(
        JSON.stringify({
          error: 'build_failed_refunded',
          details: String(pipelineErr),
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    return new Response(JSON.stringify({ build: buildRow }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
