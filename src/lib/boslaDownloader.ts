import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * غلاف TypeScript لإضافة BoslaDownloader الأصلية (DownloadManager).
 * تُستخدم فقط على أندرويد الأصلي؛ في متصفح الويب تُرمى رسالة واضحة من downloadApk.
 */

export type BoslaDownloadStatusName =
  | 'pending'
  | 'running'
  | 'paused'
  | 'successful'
  | 'failed'
  | 'not_found';

export interface BoslaDownloadStatus {
  status: BoslaDownloadStatusName;
  downloadedBytes: number;
  /** الحجم الكلي بالبايت، أو -1 إن كان غير معروف بعد. */
  totalBytes: number;
  /** رمز سبب DownloadManager (ERROR_* عند الفشل، PAUSED_* عند التوقف)، أو -1. */
  reason: number;
  localUri?: string;
}

export interface BoslaDownloaderPlugin {
  startDownload(options: { url: string; fileName: string }): Promise<{ downloadId: number }>;
  getDownloadStatus(options: { downloadId: string }): Promise<BoslaDownloadStatus>;
  openDownloadedApk(options: { downloadId: string }): Promise<void>;
  findDownloadByFileName(options: { fileName: string }): Promise<{
    found: boolean;
    downloadId?: string;
    status?: string;
  }>;
}

const BoslaDownloader = registerPlugin<BoslaDownloaderPlugin>('BoslaDownloader');

export { BoslaDownloader };

export function isBoslaDownloaderAvailable(): boolean {
  return Capacitor.isNativePlatform();
}
