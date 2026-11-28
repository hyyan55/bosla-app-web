import { Capacitor } from '@capacitor/core';
import { BoslaDownloader } from './boslaDownloader';

export interface DownloadProgress {
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
}

export type DownloadPhase = 'downloading' | 'installing';

/**
 * التنزيل والتثبيت من داخل التطبيق (أندرويد أصلي فقط) عبر DownloadManager.
 *
 * لماذا لا fetch؟ روابط GitHub releases لا ترسل CORS headers، فيرفض fetch
 * من داخل WebView.
 *
 * ولماذا لا Filesystem.downloadFile؟ تلك الدالة تكتب عبر FileOutputStream إلى
 * Directory.ExternalStorage، وهو غير قابل للكتابة في أندرويد 11 أو أحدث
 * (توثيق الإضافة نفسه) — فيفشل التنزيل على أي هاتف حديث رغم وجود الإنترنت،
 * وكانت رسالة الخطأ القديمة «تحقق من الإنترنت» مضللة تماماً. أما DownloadManager
 * فهو خدمة النظام المسموح لها بالكتابة في مجلد التنزيلات العام
 * (/storage/emulated/0/Download/<fileName>)، ويتبع إعادة التوجيه بنفسه،
 * ويعرض إشعار نظام بتقدم التنزيل.
 *
 * في متصفح الويب (المعاينة) لا يوجد تنزيل أصلي: تُرمى رسالة عربية واضحة،
 * ولا يُعلَّم «تم التنزيل»، ولا يُفتح المتصفح الخارجي إطلاقاً.
 */

export const APK_MIME_TYPE = 'application/vnd.android.package-archive';

// رسالة عامة صادقة: لا تلوم الإنترنت إلا عندما يكون السبب فعلاً الشبكة
// (انظر mapDownloadManagerReason و DOWNLOAD_STALLED_MESSAGE أدناه).
export const DOWNLOAD_FAILED_MESSAGE = 'تعذّر تنزيل التطبيق — حاول مرة أخرى.';

export const DOWNLOAD_STALLED_MESSAGE =
  'تعذّر تنزيل التطبيق — التنزيل متوقف منذ فترة، تحقق من الاتصال بالإنترنت ثم أعد المحاولة.';

export const INSTALL_PERMISSION_MESSAGE =
  'تعذّر فتح مثبّت التطبيق — فعّل إذن «التثبيت من مصادر غير معروفة» لهذا التطبيق من إعدادات أندرويد ثم أعد المحاولة.';

export const WEB_DOWNLOAD_UNSUPPORTED_MESSAGE =
  'التنزيل والتثبيت من داخل التطبيق يتطلبان تطبيق أندرويد — افتح التطبيق على هاتفك ثم اضغط «تنزيل APK».';

// رموز DownloadManager عند الفشل (android.app.DownloadManager.ERROR_*).
const DOWNLOAD_MANAGER_REASON_MESSAGES: Record<number, string> = {
  1000: 'تعذّر تنزيل التطبيق — حاول مرة أخرى.', // ERROR_UNKNOWN
  1001: 'تعذّر حفظ التطبيق في مجلد التنزيلات — تحقق من مساحة التخزين ثم أعد المحاولة.', // ERROR_FILE_ERROR
  1002: 'تعذّر تنزيل التطبيق — رابط التنزيل غير صالح.', // ERROR_UNHANDLED_HTTP_CODE
  1004: 'انقطع الاتصال أثناء التنزيل — تحقق من الإنترنت ثم أعد المحاولة.', // ERROR_HTTP_DATA
  1005: 'تعذّر تنزيل التطبيق — رابط التنزيل غير صالح.', // ERROR_TOO_MANY_REDIRECTS
  1006: 'لا توجد مساحة كافية على الجهاز لتنزيل التطبيق.', // ERROR_INSUFFICIENT_SPACE
  1007: 'تعذّر الوصول إلى التخزين — أعد المحاولة.', // ERROR_DEVICE_NOT_FOUND
  1008: 'تعذّر استئناف التنزيل — تحقق من الإنترنت ثم أعد المحاولة.', // ERROR_CANNOT_RESUME
  1009: 'تعذّر تنزيل التطبيق — حاول مرة أخرى.', // ERROR_BLOCKED
};

function mapDownloadManagerReason(reason: number): string {
  return DOWNLOAD_MANAGER_REASON_MESSAGES[reason] ?? DOWNLOAD_FAILED_MESSAGE;
}

// إن بقي التنزيل متوقفاً (paused) هذه المدة دون أي تقدم، نعتبره فشلاً
// برسالة صادقة بدل الانتظار إلى الأبد.
const PAUSED_STALL_TIMEOUT_MS = 120000;

export interface DownloadCallbacks {
  /** يُستدعى بعد اكتمال التنزيل بنجاح في مجلد التنزيلات. */
  onNativeFileSaved?: (fileName: string) => void;
}

/**
 * يفتح مثبّت APK لملف سبق تنزيله إلى مجلد التنزيلات عبر DownloadManager.
 * يعيد 'missing_file' عندما لا يكون الملف موجوداً (ليعيد المدير التنزيل)،
 * ويرمي خطأً عربياً عند فشل فتح المثبّت.
 */
export async function openCachedApkInstaller(
  fileName: string,
): Promise<'opened' | 'missing_file'> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error(WEB_DOWNLOAD_UNSUPPORTED_MESSAGE);
  }
  let found: { found: boolean; downloadId?: string; status?: string };
  try {
    found = await BoslaDownloader.findDownloadByFileName({ fileName });
  } catch {
    return 'missing_file';
  }
  if (!found.found || !found.downloadId || found.status !== 'successful') {
    return 'missing_file';
  }
  try {
    await BoslaDownloader.openDownloadedApk({ downloadId: found.downloadId });
  } catch {
    throw new Error(INSTALL_PERMISSION_MESSAGE);
  }
  return 'opened';
}

export async function downloadApkWithProgress(
  apkUrl: string,
  fileName: string,
  onProgress: (progress: DownloadProgress) => void,
  onPhaseChange?: (phase: DownloadPhase) => void,
  callbacks?: DownloadCallbacks,
): Promise<'native'> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error(WEB_DOWNLOAD_UNSUPPORTED_MESSAGE);
  }

  onPhaseChange?.('downloading');
  onProgress({ downloadedBytes: 0, totalBytes: null, percent: null });

  let downloadId: string;
  try {
    const started = await BoslaDownloader.startDownload({ url: apkUrl, fileName });
    downloadId = String(started.downloadId);
  } catch {
    throw new Error(DOWNLOAD_FAILED_MESSAGE);
  }

  // استطلاع حالة التنزيل كل 500ms حتى النجاح أو الفشل — DownloadManager نفسه
  // يتولى إعادة المحاولة عند انقطاع الشبكة؛ نحن فقط نراقب ونعرض التقدم.
  const downloadedBytes = await new Promise<number>((resolve, reject) => {
    let pausedSince: number | null = null;
    const timer = window.setInterval(() => {
      void BoslaDownloader.getDownloadStatus({ downloadId })
        .then((s) => {
          if (s.status === 'successful') {
            window.clearInterval(timer);
            if (s.downloadedBytes <= 0) {
              reject(new Error(DOWNLOAD_FAILED_MESSAGE));
            } else {
              resolve(s.downloadedBytes);
            }
          } else if (s.status === 'failed') {
            window.clearInterval(timer);
            reject(new Error(mapDownloadManagerReason(s.reason)));
          } else if (s.status === 'not_found') {
            window.clearInterval(timer);
            reject(new Error(DOWNLOAD_FAILED_MESSAGE));
          } else {
            if (s.status === 'paused') {
              if (pausedSince === null) {
                pausedSince = Date.now();
              } else if (Date.now() - pausedSince > PAUSED_STALL_TIMEOUT_MS) {
                window.clearInterval(timer);
                reject(new Error(DOWNLOAD_STALLED_MESSAGE));
                return;
              }
            } else {
              pausedSince = null;
            }
            const total = s.totalBytes > 0 ? s.totalBytes : null;
            onProgress({
              downloadedBytes: s.downloadedBytes,
              totalBytes: total,
              percent:
                total && total > 0
                  ? Math.min(100, Math.round((s.downloadedBytes / total) * 100))
                  : null,
            });
          }
        })
        .catch(() => {
          // فشل الاستطلاع نفسه (عابر) — أعد المحاولة في الدورة التالية.
        });
    }, 500);
  });

  // لا «تم التنزيل» إلا بعد تأكيد DownloadManager أن التنزيل مكتمل بحجم > 0.
  onProgress({
    downloadedBytes,
    totalBytes: downloadedBytes,
    percent: 100,
  });
  callbacks?.onNativeFileSaved?.(fileName);

  onPhaseChange?.('installing');
  try {
    await BoslaDownloader.openDownloadedApk({ downloadId });
  } catch {
    throw new Error(INSTALL_PERMISSION_MESSAGE);
  }
  return 'native';
}
