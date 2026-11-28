// check-build v20 — Edge Function لفحص حالة بناء واحد دون انتظار داخل الدالة.
// التطبيق يستدعيها مراراً: كل استدعاء يفحص GitHub مرة واحدة فقط ثم يرد فوراً.
// إذا كان البناء مكتملاً بنجاح: يحدّث builds ويرسل إشعار FCM.
// إذا فشل: محاولة إصلاح واحدة (أقل من 3 عمليات مكتملة)، وإلا يفشل البناء ويسترد النقاط.
//
// v20 — سباق متوازي في fixGeneratedCode مثل start-build v20: مفتاح معلّق واحد
// كان يأكل مهلة الإصلاح (40ث) كلها في التصميم المتسلسل. الآن كل جولة تسبق
// نموذجاً واحداً على دفعة مفاتيح (4) في نفس الوقت، وأول نجاح يفوز فوراً.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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
const GENERATION_PROMPT_URL = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/GENERATION_PROMPT.md`;
const GEMINI_MODELS = ["gemini-3.5-flash", "gemini-3.8-flash", "gemini-3.5-flash-lite"];
const FETCH_TIMEOUT_MS = 10000;
const FIX_DEADLINE_MS = 40000;
// السباق المتوازي (v20): دفعة مفاتيح في كل جولة؛ 3.5-flash أولاً، ثم lite، ثم 3.8-flash.
const RACE_BATCH_SIZE = 4;
const RACE_MODELS_IN_ORDER = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.8-flash"];
const MAX_COMPLETED_RUNS = 3;
const FIX_NL = String.fromCharCode(10);
const GENERATED_FILES = [
  "app/src/main/java/com/bosla/template/MainActivity.kt",
  "app/src/main/res/layout/activity_main.xml",
  "app/src/main/res/values/strings.xml",
  "app/src/main/res/values/colors.xml",
  "app/src/main/res/drawable/ic_launcher_foreground.xml",
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
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function ghHeaders(): Record<string, string> {
  return {
    "Authorization": `Bearer ${GITHUB_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}
async function ghJson(path: string, method: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: ghHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}
function b64encode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}
function b64decode(b64: string): string {
  const clean = b64.split("").filter((c) => c !== "\n" && c !== "\r" && c !== " ").join("");
  const binary = atob(clean);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function parseGeneratedFiles(text: string): Map<string, string> {
  const files = new Map<string, string>();
  const parts = text.split("### FILE:");
  for (const part of parts) {
    const firstLineEnd = part.indexOf("\n");
    if (firstLineEnd < 0) continue;
    const path = part.slice(0, firstLineEnd).trim();
    if (!path) continue;
    const codeStart = part.indexOf("```", firstLineEnd);
    if (codeStart < 0) continue;
    const afterTicks = part.indexOf("\n", codeStart);
    if (afterTicks < 0) continue;
    const codeEnd = part.indexOf("```", afterTicks + 1);
    if (codeEnd < 0) continue;
    files.set(path, part.slice(afterTicks + 1, codeEnd));
  }
  return files;
}
async function callGeminiOnce(model: string, prompt: string, imagesSection: string, apiKey: string, keyIndex: number): Promise<Map<string, string>> {
  const systemRes = await fetch(GENERATION_PROMPT_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!systemRes.ok) throw new Error("cannot fetch GENERATION_PROMPT.md: " + systemRes.status);
  const systemPrompt = await systemRes.text();
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + apiKey;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: systemPrompt + FIX_NL + FIX_NL + "## App description:" + FIX_NL + prompt + imagesSection }] }],
      generationConfig: { temperature: 0.2 },
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    console.error("Gemini error:", model, "key #" + keyIndex, res.status, JSON.stringify(data)?.slice(0, 1000));
    throw Object.assign(new Error("gemini failed"), { status: res.status });
  }
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text as string | undefined;
  if (!text) throw Object.assign(new Error("gemini empty"), { status: 502 });
  const files = parseGeneratedFiles(text);
  for (const required of GENERATED_FILES) {
    if (!files.has(required)) throw new Error("Gemini output missing file: " + required);
  }
  return files;
}
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
    const jobsData = await ghJson("/repos/" + REPO_OWNER + "/" + REPO_NAME + "/actions/runs/" + runId + "/jobs") as { jobs: Array<{ id: number; name: string; conclusion: string | null }> };
    const failedJob = (jobsData.jobs ?? []).find((job) => job.conclusion === "failure" || job.conclusion === "cancelled");
    if (!failedJob) return "failed run (no job found)";
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
    console.error("[check-build] Failed to fetch build logs, continuing with step info only", e);
    return "Failed step: " + failedStep;
  }
}
async function fixGeneratedCode(previousFiles: Map<string, string>, errorExcerpt: string, deadline: number): Promise<Map<string, string>> {
  const previous = [...previousFiles.entries()].map(([path, content]) => "### FILE: " + path + FIX_NL + "```" + FIX_NL + content + FIX_NL + "```").join(FIX_NL + FIX_NL);
  const fixPrompt = "The previous Android app failed to build with this error:" + FIX_NL + errorExcerpt + FIX_NL + FIX_NL + "Fix ONLY the broken code and keep everything else identical. Output the FULL corrected files in the same ### FILE: blocks. Use ONLY APIs that exist in AndroidX and in the template build.gradle (never invent new listener names). Here are the previous files:" + FIX_NL + FIX_NL + previous;
  // سباق متوازي: جولات (نموذج × دفعة مفاتيح)، أول نجاح يفوز فوراً دون انتظار المعلّقين.
  const rounds: Array<{ model: string; keyIndexes: number[] }> = [];
  for (const model of RACE_MODELS_IN_ORDER) {
    for (let start = 0; start < GEMINI_API_KEYS.length; start += RACE_BATCH_SIZE) {
      const keyIndexes: number[] = [];
      for (let i = start; i < Math.min(start + RACE_BATCH_SIZE, GEMINI_API_KEYS.length); i++) keyIndexes.push(i);
      rounds.push({ model, keyIndexes });
    }
  }
  for (const round of rounds) {
    if (Date.now() > deadline) throw new Error("fix phase deadline exceeded");
    try {
      return await Promise.any(
        round.keyIndexes.map((k) => callGeminiOnce(round.model, fixPrompt, "", GEMINI_API_KEYS[k], k + 1)),
      );
    } catch (e) {
      console.error("[check-build] Fix race round " + round.model + " keys " + round.keyIndexes.map((k) => k + 1).join(",") + " all failed", e);
    }
  }
  if (Date.now() > deadline) throw new Error("fix phase deadline exceeded");
  throw Object.assign(new Error("gemini fix failed"), { status: 502 });
}
async function pushGeneratedCode(branch: string, files: Map<string, string>): Promise<void> {
  for (const [path, content] of files) {
    let sha: string | undefined;
    try {
      const existing = await ghJson("/repos/" + REPO_OWNER + "/" + REPO_NAME + "/contents/" + path + "?ref=" + branch, "GET") as { sha: string };
      sha = existing.sha;
    } catch { sha = undefined; }
    const body: Record<string, unknown> = { message: "Generated app code (" + branch + ")", content: b64encode(content), branch };
    if (sha) body.sha = sha;
    await ghJson("/repos/" + REPO_OWNER + "/" + REPO_NAME + "/contents/" + path, "PUT", body);
  }
}
async function getBranchFiles(branch: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const path of GENERATED_FILES) {
    const data = await ghJson("/repos/" + REPO_OWNER + "/" + REPO_NAME + "/contents/" + path + "?ref=" + branch, "GET") as { content?: string };
    if (!data.content) throw new Error("missing file on branch: " + path);
    files.set(path, b64decode(data.content));
  }
  return files;
}
async function sendBuildNotification(walletNumber: string, status: "success" | "failed", buildId: string): Promise<void> {
  try {
    const secretRaw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
    if (!secretRaw) {
      console.log("[check-build] FCM skipped: no service account secret");
      return;
    }
    let serviceAccount: { client_email: string; private_key: string; token_uri: string };
    try {
      serviceAccount = JSON.parse(secretRaw);
    } catch {
      console.log("[check-build] FCM skipped: no service account secret");
      return;
    }
    const { client_email, private_key, token_uri } = serviceAccount;
    if (!client_email || !private_key || !token_uri) {
      console.log("[check-build] FCM skipped: no service account secret");
      return;
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT" };
    const payload = {
      iss: client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: token_uri,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
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
      console.error("[check-build] FCM token request failed:", tokenRes.status, await tokenRes.text());
      return;
    }
    const tokenJson = await tokenRes.json() as { access_token?: string };
    const accessToken = tokenJson.access_token;
    if (!accessToken) {
      console.error("[check-build] FCM token request failed: no access_token");
      return;
    }
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: deviceTokens, error: tokensError } = await admin.from("device_tokens").select("fcm_token").eq("wallet_number", walletNumber);
    if (tokensError) {
      console.error("[check-build] FCM device_tokens query failed:", tokensError);
      return;
    }
    const tokens = (deviceTokens ?? []).map((row) => row.fcm_token).filter((t): t is string => typeof t === "string" && t.length > 0);
    if (tokens.length === 0) {
      console.log(`[check-build] FCM skipped: no device tokens for wallet ${walletNumber}`);
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
          console.log(`[check-build] FCM sent: build ${buildId} status=${status} token=${token.slice(0, 8)}`);
        } else {
          console.error(`[check-build] FCM send failed: build ${buildId} status=${status} token=${token.slice(0, 8)} http=${sendRes.status}`, await sendRes.text());
        }
      } catch (sendErr) {
        console.error(`[check-build] FCM send failed: build ${buildId} status=${status} token=${token.slice(0, 8)}`, sendErr);
      }
    }
  } catch (e) {
    console.error(`[check-build] FCM notification failed: build ${buildId}`, e);
  }
}
serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);
  const auth = req.headers.get("Authorization");
  if (!auth) return jsonResponse({ error: "missing authorization" }, 401);
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return jsonResponse({ error: "invalid token" }, 401);
  let body: { build_id?: unknown };
  try { body = await req.json(); } catch { return jsonResponse({ error: "invalid json" }, 400); }
  const buildId = typeof body.build_id === "string" ? body.build_id.trim() : "";
  if (!buildId) return jsonResponse({ error: "missing build_id" }, 400);
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  let profile: { wallet_number: string } | null = null;
  {
    const byUserId = await admin.from("profiles").select("wallet_number").eq("user_id", user.id).maybeSingle();
    if (byUserId.data) profile = byUserId.data;
    else {
      const byId = await admin.from("profiles").select("wallet_number").eq("id", user.id).maybeSingle();
      if (byId.data) profile = byId.data;
    }
  }
  if (!profile) return jsonResponse({ error: "build not found" }, 404);
  const { data: build, error: buildError } = await admin.from("builds").select("id, wallet_number, status, apk_artifact_url, created_at, points_charged").eq("id", buildId).maybeSingle();
  if (buildError || !build) return jsonResponse({ error: "build not found" }, 404);
  if (build.wallet_number !== profile.wallet_number) return jsonResponse({ error: "build not found" }, 404);
  if (build.status !== "building") return jsonResponse({ status: build.status, apk_url: build.apk_artifact_url }, 200);
  const branch = "build-" + build.id.slice(0, 8);
  const data = await ghJson("/repos/" + REPO_OWNER + "/" + REPO_NAME + "/actions/workflows/" + WORKFLOW_FILE + "/runs?branch=" + branch + "&event=workflow_dispatch&per_page=10", "GET") as { workflow_runs: Array<{ id: number; status: string; conclusion: string | null; html_url: string; created_at: string }> };
  const runs = (data.workflow_runs ?? []).filter((r) => r.created_at >= build.created_at).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const latest = runs[0];
  if (!latest || latest.status !== "completed") return jsonResponse({ status: "building" }, 200);
  const completedRuns = runs.filter((r) => r.status === "completed").length;
  if (latest.conclusion === "success") {
    const apkUrl = "https://github.com/" + REPO_OWNER + "/" + REPO_NAME + "/releases/download/" + branch + "/app-debug.apk";
    await admin.from("builds").update({ status: "success", apk_artifact_url: apkUrl, completed_at: new Date().toISOString() }).eq("id", build.id);
    await sendBuildNotification(build.wallet_number, "success", build.id);
    return jsonResponse({ status: "success", apk_url: apkUrl }, 200);
  }
  if (completedRuns < MAX_COMPLETED_RUNS) {
    try {
      const errorExcerpt = await fetchFailedBuildError(latest.id);
      const currentFiles = await getBranchFiles(branch);
      const fixedFiles = await fixGeneratedCode(currentFiles, errorExcerpt, Date.now() + FIX_DEADLINE_MS);
      await pushGeneratedCode(branch, fixedFiles);
      await ghJson("/repos/" + REPO_OWNER + "/" + REPO_NAME + "/actions/workflows/" + WORKFLOW_FILE + "/dispatches", "POST", { ref: branch });
      return jsonResponse({ status: "building", fix_attempt: completedRuns }, 200);
    } catch (fixErr) {
      console.error("[check-build] Fix attempt failed:", fixErr);
      return jsonResponse({ status: "building", fix_attempt: completedRuns }, 200);
    }
  }
  await admin.from("builds").update({ status: "failed", completed_at: new Date().toISOString() }).eq("id", build.id);
  await admin.rpc("refund_points", { p_wallet: build.wallet_number, p_amount: build.points_charged, p_note: "build failed refund" });
  await sendBuildNotification(build.wallet_number, "failed", build.id);
  return jsonResponse({ status: "failed" }, 200);
});