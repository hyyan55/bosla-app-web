import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// start-build v1 — Edge Function لتوليد وبناء تطبيق من برومبت واحد.
// التدفق: تحقق من المستخدم → تحقق من الرصيد → خصم النقاط → إنشاء سجل بناء
// → البدء المتزامن قبل الرد 200 (مهلة 45 ثانية)، ثم الرد 200 مع {build}، والمتابعة فقط في الخلفية (EdgeRuntime.waitUntil):
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
const GEMINI_API_KEYS: string[] = [];
for (let i = 1; i <= 10; i++) {
  const key = Deno.env.get(i === 1 ? "GEMINI_API_KEY" : "GEMINI_API_KEY_" + i);
  if (key) GEMINI_API_KEYS.push(key);
}
const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN");

const REPO_OWNER = "hyyan55";
const REPO_NAME = "bosla-app";
const WORKFLOW_FILE = "build-apk.yml";
const MAX_FIX_ATTEMPTS = 2;
const FIX_PHASE_DEADLINE_MS = 180000;

const GENERATION_PROMPT_URL = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/GENERATION_PROMPT.md`;
const GEMINI_MODELS = ["gemini-3.5-flash", "gemini-3.8-flash", "gemini-3.5-flash-lite"];
const RETRY_DELAYS_MS = [2000, 3000];
const SYNC_PHASE_DEADLINE_MS = 45000;
const FETCH_TIMEOUT_MS = 10000;
const FALLBACK_DELAY_MS = 3000;

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
  console.log(`[start-build] GitHub API start: ${method} ${path}`);
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: ghHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[start-build] GitHub API error: ${method} ${path} -> ${res.status}`);
    throw new Error(`GitHub ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);  }
  console.log(`[start-build] GitHub API done: ${method} ${path} -> ${res.status}`);
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

async function callGeminiOnce(model: string, prompt: string, imagesSection: string, apiKey: string, keyIndex: number): Promise<Map<string, string>> {
  console.log("[start-build] Prompt fetch start");
  const systemRes = await fetch(GENERATION_PROMPT_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  console.log(`[start-build] Prompt fetch done: ${systemRes.status}`);
  if (!systemRes.ok) throw new Error(`cannot fetch GENERATION_PROMPT.md: ${systemRes.status}`);
  const systemPrompt = await systemRes.text();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: systemPrompt + "\n\n## وصف المستخدم للتطبيق:\n" + prompt + imagesSection }] }],
      generationConfig: { temperature: 0.2 },
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    console.error("Gemini error:", model, `key #${keyIndex}`, res.status, JSON.stringify(data)?.slice(0, 1000));
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

function invalidDrawableRefs(files: Map<string, string>, allowed: Set<string>): string[] {
  const bad = new Set<string>();
  for (const content of files.values()) {
    for (const m of content.matchAll(/@drawable\/([A-Za-z0-9_]+)/g)) {
      if (!allowed.has(m[1])) bad.add(m[1]);
    }
    for (const m of content.matchAll(/R\.drawable\.([A-Za-z0-9_]+)/g)) {
      if (!allowed.has(m[1])) bad.add(m[1]);
    }
  }
  return [...bad];
}

async function generateCode(prompt: string, imagesSection: string, allowedDrawables: Set<string>, deadline: number): Promise<Map<string, string>> {
  if (GEMINI_API_KEYS.length === 0) throw Object.assign(new Error("missing GEMINI_API_KEY"), { status: 500 });
  let extraNote = "";
  for (let k = 0; k < GEMINI_API_KEYS.length; k++) {
    const apiKey = GEMINI_API_KEYS[k];
    const keyIndex = k + 1;
  for (let m = 0; m < GEMINI_MODELS.length; m++) {
    const model = GEMINI_MODELS[m];
    let lastStatus: number | undefined;    for (let attempt = 0; attempt < 3; attempt++) {
        if (Date.now() > deadline) throw new Error("sync phase deadline exceeded (45s)");
      try {
        const files = await callGeminiOnce(model, prompt, imagesSection + extraNote, apiKey, keyIndex);
        const bad = invalidDrawableRefs(files, allowedDrawables);
        if (bad.length > 0) {
          console.error(`Gemini ${model} used missing drawables: ${bad.join(", ")} — retrying with correction`);
          extraNote = `\n\nتصحيح مهم: الموارد التالية غير موجودة في المشروع — لا تستخدمها إطلاقاً: ${bad.join(", ")}. استخدم فقط الموارد المسموحة.`;
          if (k === GEMINI_API_KEYS.length - 1 && m === GEMINI_MODELS.length - 1 && attempt === 2) throw new Error(`Gemini output references missing drawables: ${bad.join(", ")}`);
          continue;
        }
        return files;
      } catch (e) {
        const status = (lastStatus = (e as { status?: number }).status);
        const retryable = status === 503;
        if (!retryable || attempt === 2) break;
        console.error(`Gemini ${model} key #${keyIndex} attempt ${attempt + 1} failed (${status}), retrying...`);
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
    if (lastStatus !== 429 && (m < GEMINI_MODELS.length - 1 || k < GEMINI_API_KEYS.length - 1)) {
      console.error(`Gemini ${model} key #${keyIndex} exhausted, falling back...`);
      await sleep(FALLBACK_DELAY_MS);
    }
  }
  }  throw Object.assign(new Error("gemini failed"), { status: 502 });
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

async function waitForRun(branch: string, since: string): Promise<{ status: string; htmlUrl: string; runId: number | null }> {
  for (let attempt = 0; attempt < 40; attempt++) {
    console.log(`[start-build] Poll tick: ${branch} attempt ${attempt + 1}`);    await sleep(15000);
    const data = await ghJson(
      `/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/runs?branch=${branch}&event=workflow_dispatch&per_page=1`,
      "GET",
    ) as {
      workflow_runs: Array<{ id: number; status: string; conclusion: string | null; html_url: string; created_at: string }>;
    };
    const run = data.workflow_runs?.[0];
    if (run && run.created_at >= since) {
      if (run.status === "completed") {
        return { status: run.conclusion ?? "failure", htmlUrl: run.html_url, runId: run.id };
      }
    }
  }
  throw new Error("build timed out after 10 minutes");
}

// --- Automatic fix loop: fetch the failed build log, ask Gemini to fix only the broken code, re-push and re-dispatch (max 2 attempts) ---
const FIX_NL = String.fromCharCode(10);
function extractBuildErrorLines(logText: string): string {
  const keywords = ["error:", "FAILED", "Unresolved reference", "Exception"];
  const lines = logText.split(FIX_NL).filter((line) => keywords.some((k) => line.includes(k)));
  return lines.slice(0, 40).join(FIX_NL).slice(0, 4000);
}
async function extractZipText(zip: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(zip);
  const view = new DataView(zip);
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    if (view.getUint32(offset, true) !== 0x04034b50) break;
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const dataStart = offset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) break;
    const data = bytes.slice(dataStart, dataEnd);
    if (method === 8) {
      const stream = new Response(data).body!.pipeThrough(new DecompressionStream("deflate-raw"));
      parts.push(await new Response(stream).text());
    } else if (method === 0) {
      parts.push(decoder.decode(data));
    }
    offset = dataEnd;
  }
  return parts.join(FIX_NL);
}
async function fetchFailedBuildError(runId: number | null): Promise<string> {
  let failedStep = "unknown step";
  try {
    if (!runId) return "failed run (no run id)";
    const jobsData = await ghJson("/repos/" + REPO_OWNER + "/" + REPO_NAME + "/actions/runs/" + runId + "/jobs") as {
      jobs: Array<{ id: number; name: string; conclusion: string | null }>;
    };
    const failedJob = (jobsData.jobs ?? []).find((job) => job.conclusion === "failure" || job.conclusion === "cancelled");
    if (!failedJob) return "failed run (no failed job found)";
    failedStep = failedJob.name + " (" + (failedJob.conclusion ?? "failed") + ")";
    const res = await fetch("https://api.github.com/repos/" + REPO_OWNER + "/" + REPO_NAME + "/actions/jobs/" + failedJob.id + "/logs", {
      headers: ghHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error("logs download failed: " + res.status);
    const logText = await extractZipText(await res.arrayBuffer());
    const excerpt = extractBuildErrorLines(logText);
    return excerpt ? "Failed step: " + failedStep + FIX_NL + excerpt : "Failed step: " + failedStep;
  } catch (e) {
    console.error("[start-build] Failed to fetch build logs, continuing with step info only", e);
    return "Failed step: " + failedStep;
  }
}
async function fixGeneratedCode(previousFiles: Map<string, string>, errorExcerpt: string, deadline: number): Promise<Map<string, string>> {
  if (GEMINI_API_KEYS.length === 0) throw Object.assign(new Error("missing GEMINI_API_KEY"), { status: 500 });
  const previous = [...previousFiles.entries()]
    .map(([path, content]) => "### FILE: " + path + FIX_NL + "```" + FIX_NL + content + FIX_NL + "```")
    .join(FIX_NL + FIX_NL);
  const fixPrompt = "The previous generated Android app failed to build with this error:" + FIX_NL + errorExcerpt + FIX_NL + FIX_NL + "Fix ONLY the broken code and keep everything else identical. Output the FULL corrected files in the same ### FILE: blocks. Use ONLY APIs that exist in AndroidX/Material as declared in the template's build.gradle (never invent listener names, e.g. never call a listener method that does not exist). Here are the previous files:" + FIX_NL + FIX_NL + previous;
  for (let k = 0; k < GEMINI_API_KEYS.length; k++) {
    const apiKey = GEMINI_API_KEYS[k];
    const keyIndex = k + 1;
    for (let m = 0; m < GEMINI_MODELS.length; m++) {
      const model = GEMINI_MODELS[m];
      try {
        if (Date.now() > deadline) throw new Error("fix phase deadline exceeded");
        return await callGeminiOnce(model, fixPrompt, "", apiKey, keyIndex);
      } catch (e) {
        console.error("Gemini fix " + model + " key #" + keyIndex + " failed", e);
      }
    }
  }
  throw Object.assign(new Error("gemini fix failed"), { status: 502 });
}
async function startBuildSync(buildId: string, prompt: string, imagesSection: string, imageFiles: Array<{ url: string; name: string }>, deadline: number): Promise<{ branch: string; since: string; files: Map<string, string> }> {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const branch = `build-${buildId.slice(0, 8)}`;
  console.log(`[start-build] Sync phase start: build ${buildId} branch ${branch}`);
  try {
    const allowedDrawables = new Set(["ic_launcher_foreground", ...imageFiles.map((f) => f.name.replace(/\.[^.]+$/, ""))]);
console.log(`[start-build] Code generation start: build ${buildId}`);
    const files = await generateCode(prompt, imagesSection, allowedDrawables, deadline);
    console.log(`[start-build] Code generation done: build ${buildId} files ${files.size}`);
    console.log(`[start-build] Branch creation start: ${branch}`);    const main = await ghJson(
      `/repos/${REPO_OWNER}/${REPO_NAME}/git/ref/heads/main`,
      "GET",
    ) as { object: { sha: string } };
    await ghJson(`/repos/${REPO_OWNER}/${REPO_NAME}/git/refs`, "POST", {
      ref: `refs/heads/${branch}`,
      sha: main.object.sha,
    });
    console.log(`[start-build] Branch creation done: ${branch}`);
    await pushGeneratedCode(branch, files);
    console.log(`[start-build] File push done: ${branch}`);
    console.log(`[start-build] Workflow dispatch start: ${branch}`);
    const since = new Date().toISOString();
    await ghJson(
      `/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      "POST",
      imageFiles.length ? { ref: branch, inputs: { image_urls: imageFiles.map((f) => f.url).join(","), image_names: imageFiles.map((f) => f.name).join(",") } } : { ref: branch },
    );
    console.log(`[start-build] Workflow dispatch done: ${branch}`);
    return { branch, since, files };
  } catch (e) {
    console.error(`[start-build] Sync phase failed: build ${buildId}`, e);
    throw e;
  }
}

async function pollBuild(buildId: string, walletNumber: string, points: number, branch: string, since: string, files: Map<string, string>, imageFiles: Array<{ url: string; name: string }>): Promise<void> {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  try {
    console.log(`[start-build] Polling start: build ${buildId} branch ${branch}`);
    let result = await waitForRun(branch, since);
    console.log(`[start-build] Run completed: build ${buildId} branch ${branch} conclusion=${result.status}`);
        let currentFiles = files;
    for (let fixAttempt = 1; result.status !== "success" && fixAttempt <= MAX_FIX_ATTEMPTS; fixAttempt++) {
      const errorExcerpt = await fetchFailedBuildError(result.runId);
      console.log("[start-build] Fix attempt " + fixAttempt + "/" + MAX_FIX_ATTEMPTS + ": build " + buildId + " branch " + branch + " error: " + errorExcerpt.slice(0, 500));
      try {
        const fixedFiles = await fixGeneratedCode(currentFiles, errorExcerpt, Date.now() + FIX_PHASE_DEADLINE_MS);
        currentFiles = fixedFiles;
        await pushGeneratedCode(branch, fixedFiles);
        const fixSince = new Date().toISOString();
        await ghJson(
          "/repos/" + REPO_OWNER + "/" + REPO_NAME + "/actions/workflows/" + WORKFLOW_FILE + "/dispatches",
          "POST",
          imageFiles.length ? { ref: branch, inputs: { image_urls: imageFiles.map((f) => f.url).join(","), image_names: imageFiles.map((f) => f.name).join(",") } } : { ref: branch },
        );
        console.log("[start-build] Fix attempt " + fixAttempt + " re-dispatched: build " + buildId + " branch " + branch);
        result = await waitForRun(branch, fixSince);
        console.log("[start-build] Run completed: build " + buildId + " branch " + branch + " conclusion=" + result.status);
      } catch (fixErr) {
        console.error("[start-build] Fix attempt " + fixAttempt + " failed: build " + buildId, fixErr);
        break;
      }
    }
if (result.status === "success") {
      await admin.from("builds").update({
        status: "success",
        apk_artifact_url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${branch}/app-debug.apk`,
        completed_at: new Date().toISOString(),
      }).eq("id", buildId);
      await sendBuildNotification(walletNumber, "success", buildId);
    } else {
      throw new Error(`build concluded: ${result.status}`);
    }
  } catch (e) {
    await admin.from("builds").update({
      status: "failed",
      completed_at: new Date().toISOString(),
    }).eq("id", buildId);
    await admin.rpc("refund_points", {
      p_wallet: walletNumber,
      p_amount: points,
      p_note: "build failed refund",
    });
    console.log(`[start-build] Poll-failure refund done: build ${buildId} ${points} points`);
    await sendBuildNotification(walletNumber, "failed", buildId);
  console.error(`[start-build] Poll phase failed, refunding: build ${buildId}`, e);
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

  let body: { description?: unknown; complexity?: unknown; images?: unknown };
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
  const images: string[] = Array.isArray(body.images)
    ? (body.images as unknown[]).filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u)).slice(0, 5)
    : [];
const imageFiles = images.map((url, i) => {
  const m = url.split("?")[0].match(/\.(png|jpe?g|webp)$/i);
  return { url, name: `img_${i + 1}${m ? m[0].toLowerCase() : ".jpg"}` };
  });
  const imagesSection = imageFiles.length
    ? "\n\n## صور أرفقها المستخدم (موارد محلية جاهزة في res/drawable):\n" + imageFiles.map((f, i) => `- الصورة ${i + 1}: الملف ${f.name} — استخدمه كـ R.drawable.${f.name.replace(/\.[^.]+$/, "")} (شعار في الأعلى، أو صور في شبكة/قائمة حسب الوصف).`).join("\n") + "\nلا تحمّل أي صورة من رابط خارجي، ولا تولّد أي ملف صورة."
    : "";
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

  // (branch is computed inside startBuildSync and returned as started.branch)
  const runtime = globalThis as unknown as {
    EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void };
  };
  const deadline = Date.now() + SYNC_PHASE_DEADLINE_MS;
  try {
    const started = await startBuildSync(build.id as string, description, imagesSection, imageFiles, deadline);
    console.log(`[start-build] Build started: ${build.id} branch ${started.branch}`);
  if (runtime.EdgeRuntime?.waitUntil) runtime.EdgeRuntime.waitUntil(pollBuild(build.id as string, profile.wallet_number, points, started.branch, started.since, started.files, imageFiles));
  else pollBuild(build.id as string, profile.wallet_number, points, started.branch, started.since, started.files, imageFiles).catch((e) => console.error("[start-build] Background poll failed:", e));
    return jsonResponse({ build: toAppBuild(build, user.id, started.branch) }, 200);
  } catch (syncErr) {
    console.error(`[start-build] Sync start failed, refunding: ${build.id}`, syncErr);
    try {
      await admin.from("builds").update({ status: "failed", completed_at: new Date().toISOString() }).eq("id", build.id);
      await admin.rpc("refund_points", { p_wallet: profile.wallet_number, p_amount: points, p_note: `Refund: build ${build.id} failed to start` });
      console.log(`[start-build] Sync-failure refund done: build ${build.id} ${points} points`);
    } catch (refundErr) {
      console.error(`[start-build] Sync-failure refund FAILED: build ${build.id}`, refundErr);
    }
    return jsonResponse({ error: "تعذّر بدء البناء، وتمت إعادة النقاط إلى محفظتك" }, 500);
  }

  // (the sync try above already returned 200 on success, or 500 with a refund on failure)
});

// إشعار اكتمال البناء عبر FCM — لا ترمي أبداً داخل مسار البناء.
async function sendBuildNotification(walletNumber: string, status: "success" | "failed", buildId: string): Promise<void> {
  try {
    const secretRaw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
    if (!secretRaw) {
      console.log("[start-build] FCM skipped: no service account secret");
      return;
    }
    let serviceAccount: { client_email: string; private_key: string; token_uri: string };
    try {
      serviceAccount = JSON.parse(secretRaw);
    } catch {
      console.log("[start-build] FCM skipped: no service account secret");
      return;
    }
    const { client_email, private_key, token_uri } = serviceAccount;
    if (!client_email || !private_key || !token_uri) {
      console.log("[start-build] FCM skipped: no service account secret");
      return;
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT" };
    const payload = {
      iss: client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: token_uri,
      exp: nowSeconds + 3600,
      iat: nowSeconds,
    };
    const base64Url = (input: ArrayBuffer | Uint8Array): string => {
      const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
      let binary = "";
      bytes.forEach((b) => { binary += String.fromCharCode(b); });
      return btoa(binary).split("+").join("-").split("/").join("_").replace(/=+$/, "");
    };
    const pemBody = private_key.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/\s+/g, "");
    const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey("pkcs8", keyBytes, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    const unsignedToken = `${base64Url(new TextEncoder().encode(JSON.stringify(header)))}.${base64Url(new TextEncoder().encode(JSON.stringify(payload)))}`;
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(unsignedToken));
    const jwt = `${unsignedToken}.${base64Url(signature)}`;
    const tokenRes = await fetch(token_uri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${encodeURIComponent(jwt)}`,
    });
    if (!tokenRes.ok) {
      console.error("[start-build] FCM token request failed:", tokenRes.status, await tokenRes.text());
      return;
    }
    const tokenJson = await tokenRes.json() as { access_token?: string };
    const accessToken = tokenJson.access_token;
    if (!accessToken) {
      console.error("[start-build] FCM token request failed: no access_token");
      return;
    }
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: deviceTokens, error: tokensError } = await admin.from("device_tokens").select("fcm_token").eq("wallet_number", walletNumber);
    if (tokensError) {
      console.error("[start-build] FCM device_tokens query failed:", tokensError);
      return;
    }
    const tokens = (deviceTokens ?? []).map((row) => row.fcm_token).filter((t): t is string => typeof t === "string" && t.length > 0);
    if (tokens.length === 0) {
      console.log(`[start-build] FCM skipped: no device tokens for wallet ${walletNumber}`);
      return;
    }
    const isSuccess = status === "success";
    const title = isSuccess ? "تطبيقك جاهز 🎉" : "تعذّر بناء التطبيق";
    const body = isSuccess ? "اكتمل بناء تطبيقك — افتح التطبيق لتنزيله" : "فشل بناء التطبيق — تمت إعادة النقاط إلى محفظتك";
    for (const token of tokens) {
      try {
        const sendRes = await fetch("https://fcm.googleapis.com/v1/projects/bosla-app-aa374/messages:send", {
          method: "POST",
          headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            message: {
              token,
              notification: { title, body },
              data: { build_id: buildId, status, type: "build_completed" },
            },
          }),
        });
        if (sendRes.ok) {
          console.log(`[start-build] FCM sent: build ${buildId} status=${status} token=${token.slice(0, 8)}`);
        } else {
          console.error(`[start-build] FCM send failed: build ${buildId} status=${status} token=${token.slice(0, 8)} http=${sendRes.status}`, await sendRes.text());
        }
      } catch (sendErr) {
        console.error(`[start-build] FCM send failed: build ${buildId} status=${status} token=${token.slice(0, 8)}`, sendErr);
      }
    }
  } catch (e) {
    console.error(`[start-build] FCM notification failed: build ${buildId}`, e);
  }
}
