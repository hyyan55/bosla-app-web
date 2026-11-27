import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DEFAULT_ADMIN_PASSWORD_HASH =
  "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const METHOD_LABELS: Record<string, string> = {
  bankak: "بنكك",
  sahil: "ساهل",
  mycashy: "ماي كاشي",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "صيغة الطلب غير صالحة" }, 400);
  }

  const action = typeof body.action === "string" ? body.action.trim() : "";
  const adminPassword = typeof body.admin_password === "string" ? body.admin_password : "";

  if (!action || !adminPassword) {
    return jsonResponse({ error: "Unauthorized: missing admin credentials" }, 401);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Verify admin_password against settings.admin_password_hash
  const { data: settingsRow, error: settingsErr } = await admin
    .from("settings")
    .select("admin_password_hash")
    .eq("id", 1)
    .maybeSingle();

  if (settingsErr) {
    console.error("[admin-data] settings lookup error:", settingsErr.message);
    return jsonResponse({ error: "تعذّر التحقق من صلاحية الإدارة" }, 500);
  }

  const expectedHash =
    (settingsRow?.admin_password_hash as string | undefined) || DEFAULT_ADMIN_PASSWORD_HASH;
  const enteredHash = await sha256Hex(adminPassword);
  if (enteredHash !== expectedHash) {
    return jsonResponse({ error: "Unauthorized: invalid admin password" }, 401);
  }

  try {
    if (action === "list_users") {
      const searchRaw =
        typeof body.search === "string"
          ? body.search
          : typeof body.query === "string"
            ? body.query
            : "";
      const q = searchRaw.trim().toLowerCase();

      const { data: profilesData, error: profErr } = await admin
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (profErr) {
        console.error("[admin-data] list_users profiles error:", profErr.message);
        return jsonResponse({ error: "تعذّر تحميل المحافظ" }, 500);
      }

      const authUsersById = new Map<string, { email?: string; email_confirmed_at?: string | null; user_metadata?: Record<string, unknown>; created_at?: string }>();
      try {
        const { data: authList } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
        for (const u of authList?.users ?? []) {
          authUsersById.set(u.id, {
            email: u.email,
            email_confirmed_at: u.email_confirmed_at,
            user_metadata: u.user_metadata,
            created_at: u.created_at,
          });
        }
      } catch (e) {
        console.warn("[admin-data] auth.admin.listUsers warning:", e);
      }

      const seenAuthIds = new Set<string>();
      const combined: Array<Record<string, unknown>> = [];

      for (const p of (profilesData ?? []) as Array<Record<string, unknown>>) {
        const pid = String(p.id ?? "");
        const uid = String(p.user_id ?? pid);
        if (uid) seenAuthIds.add(uid);
        const authUser = uid ? authUsersById.get(uid) : undefined;
        const email = String(p.email ?? authUser?.email ?? "");
        const displayName = String(
          p.full_name ??
            p.display_name ??
            authUser?.user_metadata?.full_name ??
            "—",
        );

        combined.push({
          profile_id: pid,
          user_id: uid,
          wallet_number: p.wallet_number ?? null,
          display_name: displayName,
          full_name: displayName,
          username: String(p.username ?? authUser?.user_metadata?.username ?? ""),
          email,
          phone: p.phone ?? null,
          points_balance: Number(p.points_balance ?? 0) || 0,
          email_verified: Boolean(authUser?.email_confirmed_at ?? true),
          is_admin: Boolean(p.is_admin ?? false),
          created_at: String(p.created_at ?? authUser?.created_at ?? ""),
        });
      }

      // Include auth users that do not yet have a profile row (unconfirmed / pre-wallet accounts)
      for (const [uid, u] of authUsersById.entries()) {
        if (seenAuthIds.has(uid)) continue;
        const displayName = String(u.user_metadata?.full_name ?? "—");
        combined.push({
          profile_id: uid,
          user_id: uid,
          wallet_number: null,
          display_name: displayName,
          full_name: displayName,
          username: String(u.user_metadata?.username ?? ""),
          email: String(u.email ?? ""),
          phone: null,
          points_balance: 0,
          email_verified: Boolean(u.email_confirmed_at),
          is_admin: false,
          created_at: String(u.created_at ?? ""),
        });
      }

      const filtered = q
        ? combined.filter((row) =>
            [
              row.wallet_number,
              row.display_name,
              row.full_name,
              row.email,
              row.phone,
              row.username,
            ]
              .filter((v): v is string => typeof v === "string" && v.length > 0)
              .some((v) => v.toLowerCase().includes(q)),
          )
        : combined;

      return jsonResponse({ users: filtered });
    }

    if (action === "list_topups") {
      const { data, error } = await admin
        .from("topup_requests")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) {
        console.error("[admin-data] list_topups error:", error.message);
        return jsonResponse({ error: "تعذّر تحميل طلبات الشحن" }, 500);
      }

      return jsonResponse({ topups: data ?? [] });
    }

    if (action === "list_transactions") {
      const { data: txRows, error: txErr } = await admin
        .from("points_transactions")
        .select("id, wallet_number, amount, type, reason, admin_note, created_at")
        .order("created_at", { ascending: false })
        .limit(100);

      if (txErr) {
        console.error("[admin-data] list_transactions error:", txErr.message);
        return jsonResponse({ error: "تعذّر تحميل سجل المعاملات" }, 500);
      }

      const rows = (txRows ?? []) as Array<Record<string, unknown>>;
      const walletNumbers = Array.from(
        new Set(
          rows
            .map((r) => r.wallet_number)
            .filter((w): w is string => typeof w === "string" && w.length > 0),
        ),
      );

      const profileByWallet = new Map<
        string,
        { user_id: string; user_name: string; runningBalance: number }
      >();

      if (walletNumbers.length > 0) {
        const { data: profilesData } = await admin
          .from("profiles")
          .select("id, wallet_number, full_name, points_balance")
          .in("wallet_number", walletNumbers);

        for (const p of (profilesData ?? []) as Array<Record<string, unknown>>) {
          const w = typeof p.wallet_number === "string" ? p.wallet_number : "";
          if (!w) continue;
          profileByWallet.set(w, {
            user_id: String(p.id ?? ""),
            user_name: String(p.full_name ?? ""),
            runningBalance: Number(p.points_balance ?? 0) || 0,
          });
        }
      }

      const enriched = rows.map((row) => {
        const wallet = typeof row.wallet_number === "string" ? row.wallet_number : "";
        const amount = Number(row.amount ?? 0) || 0;
        const prof = profileByWallet.get(wallet);
        const balanceAfter = prof ? prof.runningBalance : 0;
        if (prof) {
          prof.runningBalance -= amount;
        }
        return {
          ...row,
          user_id: prof?.user_id ?? "",
          user_name: prof?.user_name || undefined,
          balance_after: balanceAfter,
        };
      });

      return jsonResponse({ transactions: enriched });
    }

    if (action === "approve_topup") {
      const reqId = typeof body.req_id === "string" ? body.req_id.trim() : "";
      const approve = Boolean(body.approve);
      const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;

      if (!reqId) {
        return jsonResponse({ error: "معرّف طلب الشحن مطلوب" }, 400);
      }

      const { data: topupReq, error: fetchErr } = await admin
        .from("topup_requests")
        .select("*")
        .eq("id", reqId)
        .maybeSingle();

      if (fetchErr) {
        console.error("[admin-data] approve_topup fetch error:", fetchErr.message);
        return jsonResponse({ error: "تعذّر قراءة طلب الشحن" }, 500);
      }
      if (!topupReq) {
        return jsonResponse({ error: "طلب الشحن غير موجود" }, 404);
      }
      if (topupReq.status !== "pending") {
        return jsonResponse({ error: "تمت معالجة هذا الطلب مسبقاً" }, 400);
      }

      if (approve) {
        const walletNumber =
          typeof topupReq.wallet_number === "string" ? topupReq.wallet_number.trim() : "";
        const pointsToCredit = Number(topupReq.points ?? 0);

        if (!walletNumber || !Number.isFinite(pointsToCredit) || pointsToCredit <= 0) {
          return jsonResponse(
            { error: "بيانات طلب الشحن غير مكتملة — تعذّر شحن النقاط" },
            400,
          );
        }

        const methodLabel =
          METHOD_LABELS[String(topupReq.method || "")] || String(topupReq.method || "");
        const creditNote = note
          ? `شحن رصيد عبر ${methodLabel} — ${note}`
          : `شحن رصيد عبر ${methodLabel}`;

        // Step 1: Credit wallet & record transaction FIRST via live credit_points(p_wallet, p_amount, p_note)
        const { error: creditErr } = await admin.rpc("credit_points", {
          p_wallet: walletNumber,
          p_amount: pointsToCredit,
          p_note: creditNote,
        });

        if (creditErr) {
          console.error("[admin-data] credit_points failed:", creditErr.message);
          return jsonResponse(
            {
              error: "فشل شحن النقاط في المحفظة — لم يتم اعتماد الطلب، حاول مجدداً",
              details: creditErr.message,
            },
            500,
          );
        }
      }

      // Step 2: Update request status ONLY AFTER credit_points succeeded (or when rejecting)
      const nextStatus = approve ? "approved" : "rejected";
      const { error: updateErr } = await admin
        .from("topup_requests")
        .update({
          status: nextStatus,
          admin_note: note,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", reqId)
        .eq("status", "pending");

      if (updateErr) {
        console.error("[admin-data] approve_topup status update error:", updateErr.message);
        return jsonResponse(
          { error: "تعذّر تحديث حالة طلب الشحن" },
          500,
        );
      }

      return jsonResponse({ ok: true, status: nextStatus });
    }

    if (action === "adjust_points") {
      const delta = Number(body.delta);
      const reason =
        typeof body.reason === "string" && body.reason.trim()
          ? body.reason.trim()
          : delta > 0
            ? "شحن إداري"
            : "خصم إداري";
      let walletNumber =
        typeof body.wallet_number === "string" ? body.wallet_number.trim() : "";
      const profileId =
        typeof body.profile_id === "string" ? body.profile_id.trim() : "";

      if (!delta || Number.isNaN(delta)) {
        return jsonResponse({ error: "أدخل عدد نقاط صحيح" }, 400);
      }

      if (!walletNumber && profileId) {
        const { data: prof } = await admin
          .from("profiles")
          .select("wallet_number")
          .eq("id", profileId)
          .maybeSingle();
        walletNumber = typeof prof?.wallet_number === "string" ? prof.wallet_number : "";
      }

      if (!walletNumber) {
        return jsonResponse({ error: "لم يتم العثور على رقم المحفظة" }, 404);
      }

      if (delta > 0) {
        const { error: creditErr } = await admin.rpc("credit_points", {
          p_wallet: walletNumber,
          p_amount: delta,
          p_note: reason,
        });
        if (creditErr) {
          console.error("[admin-data] adjust credit error:", creditErr.message);
          return jsonResponse({ error: creditErr.message || "تعذّر شحن النقاط" }, 400);
        }
      } else {
        const { error: debitErr } = await admin.rpc("debit_points", {
          p_wallet: walletNumber,
          p_amount: Math.abs(delta),
          p_reason: reason,
        });
        if (debitErr) {
          console.error("[admin-data] adjust debit error:", debitErr.message);
          const msg = (debitErr.message || "").toLowerCase();
          if (msg.includes("insufficient")) {
            return jsonResponse({ error: "لا يمكن أن يقل رصيد المحفظة عن صفر" }, 400);
          }
          return jsonResponse({ error: debitErr.message || "تعذّر خصم النقاط" }, 400);
        }
      }

      const { data: updatedProf } = await admin
        .from("profiles")
        .select("points_balance")
        .eq("wallet_number", walletNumber)
        .maybeSingle();

      return jsonResponse({
        ok: true,
        new_balance:
          updatedProf?.points_balance !== undefined
            ? Number(updatedProf.points_balance)
            : undefined,
      });
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    console.error("[admin-data] unhandled error:", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "خطأ غير متوقع في خادم الإدارة" },
      500,
    );
  }
});
