import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';

export interface DownloadProgress {
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
}

export type DownloadPhase = 'downloading' | 'installing';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذّر قراءة ملف التطبيق'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

export async function downloadApkWithProgress(
  apkUrl: string,
  fileName: string,
  onProgress: (progress: DownloadProgress) => void,
  onPhaseChange?: (phase: DownloadPhase) => void,
): Promise<'native' | 'web' | 'fallback'> {
  let blob: Blob;

  try {
    onPhaseChange?.('downloading');
    const response = await fetch(apkUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentLengthHeader = response.headers.get('content-length');
    const parsedTotal = contentLengthHeader ? Number(contentLengthHeader) : NaN;
    const totalBytes = Number.isFinite(parsedTotal) && parsedTotal > 0 ? parsedTotal : null;

    if (!response.body) {
      blob = await response.blob();
      onProgress({
        downloadedBytes: blob.size,
        totalBytes: totalBytes ?? (blob.size > 0 ? blob.size : null),
        percent: 100,
      });
    } else {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let downloadedBytes = 0;

      onProgress({
        downloadedBytes: 0,
        totalBytes,
        percent: totalBytes ? 0 : null,
      });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          downloadedBytes += value.byteLength;
          const percent = totalBytes
            ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
            : null;
          onProgress({
            downloadedBytes,
            totalBytes,
            percent,
          });
        }
      }

      blob = new Blob(chunks as BlobPart[], {
        type: 'application/vnd.android.package-archive',
      });
    }
  } catch {
    window.open(apkUrl, '_blank');
    return 'fallback';
  }

  if (Capacitor.isNativePlatform()) {
    onPhaseChange?.('installing');
    const base64 = await blobToBase64(blob);
    await Filesystem.writeFile({
      path: fileName,
      data: base64,
      directory: Directory.Cache,
    });
    const { uri } = await Filesystem.getUri({
      path: fileName,
      directory: Directory.Cache,
    });
    await FileOpener.open({
      filePath: uri,
      contentType: 'application/vnd.android.package-archive',
    });
    return 'native';
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 100);
  }

  return 'web';
}
