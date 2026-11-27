import { useSyncExternalStore } from 'react';
import { downloadApkWithProgress, openCachedApkInstaller } from './downloadApk';
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
const cachedBlobs = new Map<string, Blob>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

function updateSnapshot(updater: (prev: DownloadManagerSnapshot) => DownloadManagerSnapshot) {
  snapshot = updater(snapshot);
  emitChange();
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

  let filePersistedLocally = false;

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
      onBlobCached: (blob) => {
        cachedBlobs.set(build.id, blob);
        filePersistedLocally = true;
      },
      onNativeFileSaved: () => {
        filePersistedLocally = true;
      },
    },
  )
    .then(() => {
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
    .catch(() => {
      updateSnapshot((prev) => {
        const nextDownloads = { ...prev.downloads };
        if (filePersistedLocally && nextDownloads[build.id]) {
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
            [build.id]: 'تعذّر فتح مثبّت التطبيق — تأكد من صلاحية التثبيت وحاول مجدداً.',
          },
        };
      });
    })
    .finally(() => {
      activeDownloadIds.delete(build.id);
    });
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
    const result = await openCachedApkInstaller(
      fileName,
      build.apk_url,
      cachedBlobs.get(build.id),
    );
    if (result === 'missing_native_cache') {
      startApkDownload(build);
    }
  } catch {
    updateSnapshot((prev) => ({
      ...prev,
      installErrors: {
        ...prev.installErrors,
        [build.id]: 'تعذّر فتح مثبّت التطبيق — تأكد من صلاحية التثبيت وحاول مجدداً.',
      },
    }));
  }
}
