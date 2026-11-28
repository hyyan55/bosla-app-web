import { useSyncExternalStore } from 'react';
import {
  DOWNLOAD_FAILED_MESSAGE,
  INSTALL_PERMISSION_MESSAGE,
  downloadApkWithProgress,
  openApkDownloadInBrowser,
  openCachedApkInstaller,
} from './downloadApk';
import type { AppBuild } from '../types';

export interface BuildDownloadState {
  phase: 'downloading' | 'installing' | 'done';
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
  fileName: string;
}

export interface DownloadManagerSnapshot {
  downloads: Record<string, BuildDownloadState>;
  installErrors: Record<string, string>;
}

let snapshot: DownloadManagerSnapshot = {
  downloads: {},
  installErrors: {},
};

const listeners = new Set<() => void>();
const activeDownloadIds = new Set<string>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

function updateSnapshot(updater: (prev: DownloadManagerSnapshot) => DownloadManagerSnapshot) {
  snapshot = updater(snapshot);
  emitChange();
}

function getArabicErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim().length > 0) {
    return err.message;
  }
  return fallback;
}

export function subscribeDownloads(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getDownloadsSnapshot(): DownloadManagerSnapshot {
  return snapshot;
}

export function useApkDownloads(): DownloadManagerSnapshot {
  return useSyncExternalStore(subscribeDownloads, getDownloadsSnapshot, getDownloadsSnapshot);
}

export function getApkFileName(buildId: string): string {
  return `bosla-app-${buildId.slice(0, 8)}.apk`;
}

export function startApkDownload(build: AppBuild): void {
  if (!build.apk_url) return;
  const current = snapshot.downloads[build.id];
  if (
    activeDownloadIds.has(build.id) ||
    current?.phase === 'downloading' ||
    current?.phase === 'installing'
  ) {
    return;
  }

  const fileName = getApkFileName(build.id);
  activeDownloadIds.add(build.id);

  updateSnapshot((prev) => {
    const nextErrors = { ...prev.installErrors };
    delete nextErrors[build.id];
    return {
      downloads: {
        ...prev.downloads,
        [build.id]: {
          phase: 'downloading',
          downloadedBytes: 0,
          totalBytes: null,
          percent: null,
          fileName,
        },
      },
      installErrors: nextErrors,
    };
  });

  // لا يُعلَّم البناء بحالة done إلا بعد تأكيد downloadApkWithProgress عبر DownloadManager.
  let nativeFileVerified = false;

  void downloadApkWithProgress(
    build.apk_url,
    fileName,
    ({ downloadedBytes, totalBytes, percent }) => {
      updateSnapshot((prev) => {
        const existing = prev.downloads[build.id];
        return {
          ...prev,
          downloads: {
            ...prev.downloads,
            [build.id]: {
              phase: existing?.phase === 'installing' ? 'installing' : 'downloading',
              downloadedBytes,
              totalBytes,
              percent,
              fileName,
            },
          },
        };
      });
    },
    (phase) => {
      updateSnapshot((prev) => {
        const existing = prev.downloads[build.id] ?? {
          downloadedBytes: 0,
          totalBytes: null,
          percent: null,
          fileName,
        };
        return {
          ...prev,
          downloads: {
            ...prev.downloads,
            [build.id]: {
              ...existing,
              phase,
            },
          },
        };
      });
    },
    {
      onNativeFileSaved: () => {
        nativeFileVerified = true;
      },
    },
  )
    .then(() => {
      if (!nativeFileVerified) return;
      updateSnapshot((prev) => {
        const existing = prev.downloads[build.id] ?? {
          downloadedBytes: 0,
          totalBytes: null,
          percent: 100,
          fileName,
        };
        return {
          ...prev,
          downloads: {
            ...prev.downloads,
            [build.id]: {
              ...existing,
              phase: 'done',
              percent: 100,
              fileName,
            },
          },
        };
      });
    })
    .catch((err: unknown) => {
      const errorMessage = getArabicErrorMessage(
        err,
        nativeFileVerified ? INSTALL_PERMISSION_MESSAGE : DOWNLOAD_FAILED_MESSAGE,
      );
      updateSnapshot((prev) => {
        const nextDownloads = { ...prev.downloads };
        if (nativeFileVerified && nextDownloads[build.id]) {
          nextDownloads[build.id] = {
            ...nextDownloads[build.id],
            phase: 'done',
            percent: 100,
          };
        } else {
          delete nextDownloads[build.id];
        }
        return {
          downloads: nextDownloads,
          installErrors: {
            ...prev.installErrors,
            [build.id]: errorMessage,
          },
        };
      });
    })
    .finally(() => {
      activeDownloadIds.delete(build.id);
    });
}

/** يفتح رابط APK في متصفح النظام كبديل عند فشل تنزيل DownloadManager. */
export function openApkInBrowser(build: AppBuild): void {
  if (!build.apk_url) return;
  openApkDownloadInBrowser(build.apk_url);
}

export async function openDownloadedApk(build: AppBuild): Promise<void> {
  if (!build.apk_url) return;
  const fileName = snapshot.downloads[build.id]?.fileName ?? getApkFileName(build.id);

  updateSnapshot((prev) => {
    if (!prev.installErrors[build.id]) return prev;
    const nextErrors = { ...prev.installErrors };
    delete nextErrors[build.id];
    return { ...prev, installErrors: nextErrors };
  });

  try {
    const result = await openCachedApkInstaller(fileName);
    if (result === 'missing_file') {
      updateSnapshot((prev) => {
        const nextDownloads = { ...prev.downloads };
        delete nextDownloads[build.id];
        return {
          ...prev,
          downloads: nextDownloads,
        };
      });
      startApkDownload(build);
    }
  } catch (err: unknown) {
    const errorMessage = getArabicErrorMessage(err, INSTALL_PERMISSION_MESSAGE);
    updateSnapshot((prev) => ({
      ...prev,
      installErrors: {
        ...prev.installErrors,
        [build.id]: errorMessage,
      },
    }));
  }
}
