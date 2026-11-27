import { supabase } from './backend';
import type { AppBuild, BuildStatus } from '../types';

/**
 * مراقب بناء (build watcher) على مستوى الوحدة — module-level store.
 *
 * الحالة (المؤقتات والبناءات المراقَبة والمستمعون) تعيش خارج أي مكوّن، مثل
 * downloadManager.ts ومتجر إعادة محاولة الدردشة، فتنجو من التنقل بين
 * التبويبات ومن إعادة تحميل شاشة «تطبيقاتي».
 *
 * يستطلع الدالة check-build (POST { build_id } عبر
 * supabase.functions.invoke) استدعاءً واحداً لكل فحص، بلا انتظار داخلي،
 * كل 20 ثانية لأي بناء حالته 'building'، ويتوقف عن بناءٍ ما فور وصوله
 * إلى حالة نهائية (success أو failed). لا يوجد أي استطلاع عندما لا يوجد
 * بناء بحالة building.
 *
 * ملاحظة: عقد check-build يعيد status بقيم 'building' | 'success' | 'failed'،
 * بينما حالة البناء داخل التطبيق BuildStatus هي 'building' | 'ready' | 'failed'،
 * لذا تُترجَم 'success' إلى 'ready' عند إرسال التحديث للواجهة.
 */

export const BUILD_WATCH_POLL_MS = 20_000;

export interface BuildWatcherUpdate {
  buildId: string;
  /** الحالة النهائية فقط: 'ready' عند نجاح البناء، أو 'failed' عند فشله. */
  status: Extract<BuildStatus, 'ready' | 'failed'>;
  /** رابط APK عند النجاح فقط. */
  apkUrl?: string | null;
}

type BuildWatcherListener = (update: BuildWatcherUpdate) => void;

const listeners = new Set<BuildWatcherListener>();

/** معرّفات البناءات المراقَبة حالياً (على مستوى الوحدة). */
const watchedBuildIds = new Set<string>();

/** buildId -> معرّف مؤقت setInterval الخاص به. */
const timers = new Map<string, number>();

function emit(update: BuildWatcherUpdate): void {
  listeners.forEach((listener) => listener(update));
}

/** يشترك في تحديثات المراقب النهائية (نجاح/فشل بناء). يعيد دالة إلغاء الاشتراك. */
export function subscribeBuildWatcher(listener: BuildWatcherListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isWatchingBuild(buildId: string): boolean {
  return watchedBuildIds.has(buildId);
}

export function getWatchedBuildIds(): string[] {
  return [...watchedBuildIds];
}

function stopWatchingBuild(buildId: string): void {
  const timer = timers.get(buildId);
  if (timer !== undefined) {
    window.clearInterval(timer);
    timers.delete(buildId);
  }
  watchedBuildIds.delete(buildId);
}

/** يوقف كل مؤقتات الاستطلاع (مثلاً عند تسجيل الخروج). */
export function stopAllBuildWatchers(): void {
  [...timers.keys()].forEach((buildId) => stopWatchingBuild(buildId));
}

/** فحص واحد عبر check-build — استدعاء واحد فقط، بلا انتظار داخلي. */
async function checkBuildOnce(buildId: string): Promise<void> {
  if (!supabase) return;
  let data: { status?: string; apk_url?: string | null } | null;
  try {
    const result = await supabase.functions.invoke('check-build', {
      body: { build_id: buildId },
    });
    if (result.error) return;
    data = result.data as { status?: string; apk_url?: string | null } | null;
  } catch {
    // خطأ شبكة مؤقت — نبقي الاستطلاع ليعيد المحاولة في الفحص التالي.
    return;
  }
  const status = data?.status;
  if (status === 'success') {
    stopWatchingBuild(buildId);
    emit({ buildId, status: 'ready', apkUrl: data?.apk_url ?? null });
  } else if (status === 'failed') {
    stopWatchingBuild(buildId);
    emit({ buildId, status: 'failed', apkUrl: null });
  }
  // 'building' (أو حالة غير معروفة) — يستمر الاستطلاع.
}

/**
 * يبدأ استطلاع بناءٍ ما فوراً: فحص أول فوري، ثم كل 20 ثانية.
 * إن كان البناء مراقَباً أصلاً فلا يفعل شيئاً (لا مؤقتات مكررة).
 */
export function watchBuild(buildId: string): void {
  if (!buildId || watchedBuildIds.has(buildId)) return;
  watchedBuildIds.add(buildId);
  void checkBuildOnce(buildId).then(() => {
    // قد يكون الفحص الأول الفوري قد أنهى البناء أصلاً.
    if (!watchedBuildIds.has(buildId)) return;
    const timer = window.setInterval(() => {
      void checkBuildOnce(buildId);
    }, BUILD_WATCH_POLL_MS);
    timers.set(buildId, timer);
  });
}

/** يبدأ استطلاع كل بناءٍ في القائمة حالته 'building' ويوقف مراقبة أي بناء لم يعد فيها أو لم يعد 'building'. */
export function watchBuildingBuilds(builds: AppBuild[]): void {
  const buildingIds = new Set(
    builds.filter((build) => build.status === 'building').map((build) => build.id),
  );

  [...watchedBuildIds].forEach((buildId) => {
    if (!buildingIds.has(buildId)) {
      stopWatchingBuild(buildId);
    }
  });

  buildingIds.forEach((buildId) => watchBuild(buildId));
}
// يستطلع المراقب كل 20 ثانية فقط أثناء وجود بناء بحالة building، ويتوقف تماماً دون ذلك.