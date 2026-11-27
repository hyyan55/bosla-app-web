import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';

export interface DownloadProgress {
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
}

export type DownloadPhase = 'downloading' | 'installing';

/**
 * التنزيل والتثبيت من داخل التطبيق (أندرويد أصلي فقط).
 *
 * لماذا لا fetch؟ روابط GitHub releases لا ترسل CORS headers، فيرفض fetch
 * من داخل WebView. Filesystem.downloadFile أصلي ولا يتأثر بـ CORS.
 *
 * مسار الحفظ: Directory.ExternalStorage + مجلد Download
 * (/storage/emulated/0/Download/<fileName>)، لأن @capacitor/filesystem لا يوفّر
 * Directory.Downloads في enum Directory؛ فيظهر ملف APK في مجلد «التنزيلات»
 * على أندرويد. لا يُعلَّم التنزيل مكتملاً إلا بعد التحقق عبر Filesystem.stat
 * من وجود الملف فعلاً وحجمه > 0، ثم يُفتح المثبّت عبر FileOpener من نفس المسار.
 *
 * في متصفح الويب (المعاينة) لا يوجد تنزيل أصلي: تُرمى رسالة عربية واضحة،
 * ولا يُعلَّم «تم التنزيل»، ولا يُفتح المتصفح الخارجي إطلاقاً.
 */

/** جذر التخزين الخارجي العام + المجلد الفرعي Download لمجلد التنزيلات على أندرويد. */
export const APK_DOWNLOAD_DIRECTORY = Directory.ExternalStorage;
export const APK_DOWNLOAD_SUBDIR = 'Download';

export function getApkDownloadPath(fileName: string): string {
  return fileName.startsWith(`${APK_DOWNLOAD_SUBDIR}/`)
    ? fileName
    : `${APK_DOWNLOAD_SUBDIR}/${fileName}`;
}

export const APK_MIME_TYPE = 'application/vnd.android.package-archive';

export const DOWNLOAD_FAILED_MESSAGE =
  'تعذّر تنزيل التطبيق — تحقق من الاتصال بالإنترنت ثم أعد المحاولة.';

export const INSTALL_PERMISSION_MESSAGE =
  'تعذّر فتح مثبّت التطبيق — فعّل إذن «التثبيت من مصادر غير معروفة» لهذا التطبيق من إعدادات أندرويد ثم أعد المحاولة.';

export const WEB_DOWNLOAD_UNSUPPORTED_MESSAGE =
  'التنزيل والتثبيت من داخل التطبيق يتطلبان تطبيق أندرويد — افتح التطبيق على هاتفك ثم اضغط «تنزيل APK».';

export interface DownloadCallbacks {
  /** يُستدعى بعد حفظ الملف بنجاح في مجلد التنزيلات والتحقق من وجوده. */
  onNativeFileSaved?: (fileName: string) => void;
}

/** يتحقق من وجود الملف فعلاً في مجلد التنزيلات وحجمه أكبر من صفر، ويعيد حجمه. */
async function verifyApkInDownloads(fileName: string): Promise<number> {
  const stat = await Filesystem.stat({
    path: getApkDownloadPath(fileName),
    directory: APK_DOWNLOAD_DIRECTORY,
  });
  if (!stat.size || stat.size <= 0) {
    throw new Error(DOWNLOAD_FAILED_MESSAGE);
  }
  return stat.size;
}

/** يفتح مثبّت APK من مسار الملف في مجلد التنزيلات عبر FileOpener. */
async function openApkFromDownloads(fileName: string): Promise<void> {
  const { uri } = await Filesystem.getUri({
    path: getApkDownloadPath(fileName),
    directory: APK_DOWNLOAD_DIRECTORY,
  });
  try {
    await FileOpener.open({
      filePath: uri,
      contentType: APK_MIME_TYPE,
    });
  } catch {
    throw new Error(INSTALL_PERMISSION_MESSAGE);
  }
}

/**
 * يفتح مثبّت APK لملف سبق تنزيله إلى مجلد التنزيلات.
 * يعيد 'missing_file' عندما لا يكون الملف موجوداً (ليعيد المدير التنزيل)،
 * ويرمي خطأً عربياً عند فشل فتح المثبّت.
 */
export async function openCachedApkInstaller(
  fileName: string,
): Promise<'opened' | 'missing_file'> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error(WEB_DOWNLOAD_UNSUPPORTED_MESSAGE);
  }
  try {
    const stat = await Filesystem.stat({
      path: getApkDownloadPath(fileName),
      directory: APK_DOWNLOAD_DIRECTORY,
    });
    if (!stat.size || stat.size <= 0) {
      return 'missing_file';
    }
  } catch {
    return 'missing_file';
  }
  await openApkFromDownloads(fileName);
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

  const apkPath = getApkDownloadPath(fileName);

  onPhaseChange?.('downloading');
  onProgress({ downloadedBytes: 0, totalBytes: null, percent: null });

  // الحجم الكلي يأتي من حدث progress الأصلي (contentLength)،
  // والمنزَّل يأتي من حدث progress ومن استطلاع Filesystem.stat على القرص.
  let totalBytes: number | null = null;
  let disposed = false;
  let progressHandle: PluginListenerHandle | null = null;

  const statTimer = window.setInterval(() => {
    void Filesystem.stat({
      path: apkPath,
      directory: APK_DOWNLOAD_DIRECTORY,
    })
      .then((stat) => {
        if (disposed) return;
        const downloadedBytes = stat.size ?? 0;
        onProgress({
          downloadedBytes,
          totalBytes,
          percent:
            totalBytes && totalBytes > 0
              ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
              : null,
        });
      })
      .catch(() => {
        // الملف غير موجود بعد — التنزيل لم يكتب أي بايت حتى الآن.
      });
  }, 500);

  try {
    await Filesystem.mkdir({
      path: APK_DOWNLOAD_SUBDIR,
      directory: APK_DOWNLOAD_DIRECTORY,
      recursive: true,
    }).catch(() => undefined);

    progressHandle = await Filesystem.addListener('progress', (progress) => {
      if (disposed || (progress.url && progress.url !== apkUrl)) return;
      if (progress.contentLength > 0) {
        totalBytes = progress.contentLength;
      }
      onProgress({
        downloadedBytes: progress.bytes,
        totalBytes,
        percent:
          totalBytes && totalBytes > 0
            ? Math.min(100, Math.round((progress.bytes / totalBytes) * 100))
            : null,
      });
    });

    await Filesystem.downloadFile({
      path: apkPath,
      directory: APK_DOWNLOAD_DIRECTORY,
      url: apkUrl,
      progress: true,
    });
  } catch {
    throw new Error(DOWNLOAD_FAILED_MESSAGE);
  } finally {
    disposed = true;
    window.clearInterval(statTimer);
    if (progressHandle) {
      await progressHandle.remove().catch(() => undefined);
    }
  }

  // لا «تم التنزيل» إلا بعد التحقق أن الملف موجود فعلاً في مجلد التنزيلات.
  const savedSize = await verifyApkInDownloads(fileName);
  onProgress({
    downloadedBytes: savedSize,
    totalBytes: totalBytes ?? savedSize,
    percent: 100,
  });
  callbacks?.onNativeFileSaved?.(fileName);

  onPhaseChange?.('installing');
  await openApkFromDownloads(fileName);
  return 'native';
}
