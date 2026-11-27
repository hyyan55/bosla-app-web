import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// start-build v1 — Edge Function لتوليد وبناء تطبيق من برومبت واحد.
// التدفق: تحقق من المستخدم → تحقق من الرصيد → خصم النقاط → إنشاء سجل بناء
// → الرد 200 فوراً مع {build}، والبناء يستمر في الخلفية (EdgeRuntime.waitUntil):
// توليد الكود بـ Gemini → فرع جديد في bosla-app → دفع الكود → تشغيل workflow
// build-apk.yml → انتظار النتيجة → تحديث سجل البناء (نجاح: رابط صفحة الـ run؛
// فشل: استرجاع النقاط).
//
// ملاحظات جوهرية (بعد مراجعة قاعدة البيانات الحية والتطبيق 2026-11-27):
// - قاعدة البيانات الحية (SQL 001) تستعمل: debit_points(p_wallet, p_amount,
//   p_reason) و credit_points(p_wallet, p_amount, p_note)، وجدول builds
//   بأعمدة (wallet_number, prompt, status 'pending'|'building'|'success'|
//   'failed', complexity, points_charged, apk_artifact_url). نسخة المستودع
//   (user_id / description / points_spent / apk_url) لا تطابق الحية، لذا هذه
//   الدالة تتكلم مع الحية مباشرة وتعيد للواجهة صفاً بصيغة AppBuild.
// - النقاط تُحسب في السيرفر من التعقيد (100/400/800) — الواجهة ترسل
//   {description, complexity} فقط، ولا يُؤخذ أي مبلغ من العميل.
// - النموذج gemini-3.5-flash أساسي (مثبت أنه يجيب بمفتاح مجاني — سجلات chat v7)،
//   و gemini-3.8-flash بديل؛ gemini-2.0-flash محذوف (أوقفته Google، 404).
// - إن لم يكن GITHUB_TOKEN مضبوطاً، تُرفض الطلبات قبل الخصم بخطأ
//   github_not_configured — لا تُخصم أي نقطة حتى يضيفه حيان.
// أسرار Supabase المدمجة (SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY) تأتي
// تلقائياً؛ المطلوب ضبطها يدوياً: GEMINI_API_KEY (موجود) و GITHUB_TOKEN.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN");

const REPO_OWNER = "hyyan55";
const REPO_NAME = "bosla-app";
const WORKFLOW_FILE = "build-apk.yml";
const GENERATION_PROMPT_URL = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/GENERATION_PROMPT.md`;
const GEMINI_MODELS = ["gemini-3.5-flash", "gemini-3.8-flash"];
const RETRY_DELAYS_MS = [3000, 6000];
const FALLBACK_DELAY_MS = 5000;

const POINTS_BY_COMPLEXITY: Record<string, number> = {
  simple: 100,
  medium: 400,
  complex: 800,
};

const GENERATED_FILES = [
  "app/src/main/java/com/bosla/template/MainActivity.kt",
  "app/src/main/res/layout/activity_main.xml",
  "app/src/main/res/values/strings.xml",
];

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function ghHeaders(): Record<string, string> {
  return {
    "Authorization": `Bearer ${GITHUB_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function b64encode(s: string): string {
  return btoa(unescape(encodeURIComponent(s)));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function ghJson(path: string, method: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: ghHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GitHub ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

function parseGeneratedFiles(text: string): Map<string, string> {
  const files = new Map<string, string>();
  const re = /### FILE:\s*([^\n]+)\n```(?:\w+)?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    files.set(m[1].trim(), m[2]);
  }
  return files;
}

async function callGeminiOnce(model: string, prompt: string): Promise<Map<string, string>> {
  const systemRes = await fetch(GENERATION_PROMPT_URL);
  if (!systemRes.ok) throw new Error(`cannot fetch GENERATION_PROMPT.md: ${systemRes.status}`);
  const systemPrompt = await systemRes.text();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: systemPrompt + "\n\n## وصف المستخدم للتطبيق:\n" + prompt }] }],
      generationConfig: { temperature: 0.2 },
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    console.error("Gemini error:", model, res.status, JSON.stringify(data)?.slice(0, 300));
    throw Object.assign(new Error("gemini failed"), { status: res.status });
  }
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text as string | undefined;
  if (!text) throw Object.assign(new Error("gemini empty"), { status: 502 });
  const files = parseGeneratedFiles(text);
  for (const required of GENERATED_FILES) {
    if (!files.has(required)) throw new Error(`Gemini output missing file: ${required}`);
  }
  return files;
}

async function generateCode(prompt: string): Promise<Map<string, string>> {
  if (!GEMINI_API_KEY) throw Object.assign(new Error("missing GEMINI_API_KEY"), { status: 500 });
  for (let m = 0; m < GEMINI_MODELS.length; m++) {
    const model = GEMINI_MODELS[m];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await callGeminiOnce(model, prompt);
      } catch (e) {
        const status = (e as { status?: number }).status;
        const retryable = status === 429 || status === 503;
        if (!retryable || attempt === 2) break;
        console.error(`Gemini ${model} attempt ${attempt + 1} failed (${status}), retrying...`);
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
    if (m < GEMINI_MODELS.length - 1) {
      console.error(`Gemini ${model} exhausted, falling back to ${GEMINI_MODELS[m + 1]}...`);
      await sleep(FALLBACK_DELAY_MS);
    }
  }
  throw Object.assign(new Error("gemini failed"), { status: 502 });
}

async function pushGeneratedCode(branch: string, files: Map<string, string>): Promise<void> {
  for (const [path, content] of files) {
    let sha: string | undefined;
    try {
      const existing = await ghJson(
        `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}?ref=${branch}`,
        "GET",
      ) as { sha: string };
      sha = existing.sha;
    } catch {
      sha = undefined;
    }
    const body: Record<string, unknown> = {
      message: `Generated app code (${branch})`,
      content: b64encode(content),
      branch,
    };
    if (sha) body.sha = sha;
    await ghJson(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, "PUT", body);
  }
}

async function waitForRun(branch: string, since: string): Promise<{ status: string; htmlUrl: string }> {
  for (let attempt = 0; attempt < 40; attempt++) {
    await sleep(15000);
    const data = await ghJson(
      `/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/runs?branch=${branch}&event=workflow_dispatch&per_page=1`,
      "GET",
    ) as {
      workflow_runs: Array<{ status: string; conclusion: string | null; html_url: string; created_at: string }>;
    };
    const run = data.workflow_runs?.[0];
    if (run && run.created_at >= since) {
      if (run.status === "completed") {
        return { status: run.conclusion ?? "failure", htmlUrl: run.html_url };
      }
    }
  }
  throw new Error("build timed out after 10 minutes");
}

async function runBuild(buildId: string, walletNumber: string, prompt: string, points: number): Promise<void> {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const branch = `build-${buildId.slice(0, 8)}`;
  try {
    const files = await generateCode(prompt);
    const main = await ghJson(
      `/repos/${REPO_OWNER}/${REPO_NAME}/git/ref/heads/main`,
      "GET",
    ) as { object: { sha: string } };
    await ghJson(`/repos/${REPO_OWNER}/${REPO_NAME}/git/refs`, "POST", {
      ref: `refs/heads/${branch}`,
      sha: main.object.sha,
    });
    await pushGeneratedCode(branch, files);
    const since = new Date().toISOString();
    await ghJson(
      `/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      "POST",
      { ref: branch },
    );
    const result = await waitForRun(branch, since);
    if (result.status === "success") {
      await admin.from("builds").update({
        status: "success",
        apk_artifact_url: result.htmlUrl,
        completed_at: new Date().toISOString(),
      }).eq("id", buildId);
    } else {
      throw new Error(`build concluded: ${result.status}`);
    }
  } catch (e) {
    await admin.from("builds").update({
      status: "failed",
      completed_at: new Date().toISOString(),
    }).eq("id", buildId);
    await admin.rpc("credit_points", {
      p_wallet: walletNumber,
      p_amount: points,
      p_note: "build failed refund",
    });
    console.error(`build ${buildId} failed:`, e);
  }
}

function toAppBuild(row: {
  id: string;
  wallet_number: string;
  prompt: string;
  complexity: string;
  points_charged: number;
  status: string;
  apk_artifact_url: string | null;
  created_at: string;
  completed_at: string | null;
}, userId: string, branch: string) {
  return {
    id: row.id,
    user_id: userId,
    description: row.prompt,
    complexity: row.complexity,
    points_spent: row.points_charged,
    status: row.status === "success" ? "ready" : row.status,
    apk_url: row.apk_artifact_url,
    error_message: null,
    branch_name: branch,
    created_at: row.created_at,
    updated_at: row.completed_at ?? row.created_at,
  };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  const auth = req.headers.get("Authorization");
  if (!auth) return jsonResponse({ error: "missing authorization" }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return jsonResponse({ error: "invalid token" }, 401);

  let body: { description?: unknown; complexity?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid json" }, 400);
  }
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const complexity = body.complexity === "complex"
    ? "complex"
    : body.complexity === "medium"
      ? "medium"
      : body.complexity === "simple"
        ? "simple"
        : "";
  if (!description || !complexity) {
    return jsonResponse({ error: "invalid description/complexity" }, 400);
  }
  const points = POINTS_BY_COMPLEXITY[complexity];

  if (!GITHUB_TOKEN) {
    return jsonResponse({ error: "github_not_configured" }, 500);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  let profile: { wallet_number: string; points_balance: number } | null = null;
  {
    const byUserId = await admin
      .from("profiles")
      .select("wallet_number, points_balance")
      .eq("user_id", user.id)
      .maybeSingle();
    if (byUserId.data) profile = byUserId.data;
    else {
      const byId = await admin
        .from("profiles")
        .select("wallet_number, points_balance")
        .eq("id", user.id)
        .maybeSingle();
      if (byId.data) profile = byId.data;
    }
  }
  if (!profile) return jsonResponse({ error: "wallet not found" }, 404);
  if (profile.points_balance < points) {
    return jsonResponse({ error: "insufficient_points" }, 400);
  }

  const { error: debitError } = await admin.rpc("debit_points", {
    p_wallet: profile.wallet_number,
    p_amount: points,
    p_reason: "build",
  });
  if (debitError) {
    const msg = (debitError.message || "").toLowerCase();
    if (msg.includes("insufficient")) {
      return jsonResponse({ error: "insufficient_points" }, 400);
    }
    return jsonResponse({ error: debitError.message }, 402);
  }

  const { data: build, error: buildError } = await admin
    .from("builds")
    .insert({
      wallet_number: profile.wallet_number,
      prompt: description,
      status: "building",
      complexity,
      points_charged: points,
    })
    .select("id, wallet_number, prompt, complexity, points_charged, status, apk_artifact_url, created_at, completed_at")
    .single();
  if (buildError || !build) return jsonResponse({ error: "could not create build" }, 500);

  const branch = `build-${(build.id as string).slice(0, 8)}`;
  const runtime = globalThis as unknown as {
    EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void };
  };
  const task = runBuild(build.id as string, profile.wallet_number, description, points);
  if (runtime.EdgeRuntime?.waitUntil) runtime.EdgeRuntime.waitUntil(task);
  else task.catch((e) => console.error("background build failed:", e));

  return jsonResponse({ build: toAppBuild(build, user.id, branch) }, 200);
});
