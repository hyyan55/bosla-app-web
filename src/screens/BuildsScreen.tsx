import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Download,
  ExternalLink,
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  MessageSquarePlus,
  Loader2,
} from 'lucide-react';
import { MobileShell } from '../components/MobileShell';
import { backend, COMPLEXITY_LABELS } from '../lib/backend';
import { subscribeBuildWatcher, watchBuildingBuilds } from '../lib/buildWatcher';
import { openApkInBrowser, openDownloadedApk, startApkDownload, useApkDownloads } from '../lib/downloadManager';
import type { AppBuild, BuildStatus } from '../types';

function formatMegabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

const STATUS_META: Record<
  BuildStatus,
  { label: string; badgeClass: string; icon: React.ReactNode }
> = {
  building: {
    label: 'قيد البناء',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
    icon: <Clock className="w-3.5 h-3.5 text-amber-600" />,
  },
  ready: {
    label: 'جاهز',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />,
  },
  failed: {
    label: 'فشل',
    badgeClass: 'bg-red-50 text-red-800 border-red-200',
    icon: <XCircle className="w-3.5 h-3.5 text-red-600" />,
  },
};

export function BuildsScreen() {
  const navigate = useNavigate();

  const [builds, setBuilds] = useState<AppBuild[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emptyImgFailed, setEmptyImgFailed] = useState(false);
  const { downloads, installErrors } = useApkDownloads();

  // Pull-to-refresh touch tracking
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const touchStartY = useRef<number | null>(null);
  const [pullOffset, setPullOffset] = useState(0);

  const loadBuilds = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const data = await backend.getBuilds();
      setBuilds(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر تحميل التطبيقات');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadBuilds(false);
  }, [loadBuilds]);

  // استئناف مراقبة أي بناء بحالة building عند تحميل القائمة، وإيقافها عند عدم وجود بناء قيد البناء
  useEffect(() => {
    if (loading) return;
    watchBuildingBuilds(builds);
  }, [builds, loading]);

  // الاشتراك في تحديثات buildWatcher لتحديث حالة البناء و apk_url فور وصولها
  useEffect(() => {
    return subscribeBuildWatcher((update) => {
      setBuilds((prev) =>
        prev.map((build) =>
          build.id === update.buildId
            ? {
                ...build,
                status: update.status,
                apk_url: update.apkUrl ?? build.apk_url,
              }
            : build,
        ),
      );
    });
  }, []);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (scrollRef.current && scrollRef.current.scrollTop === 0) {
      touchStartY.current = e.touches[0].clientY;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    const diff = e.touches[0].clientY - touchStartY.current;
    if (diff > 0) {
      setPullOffset(Math.min(64, diff * 0.45));
    }
  };

  const handleTouchEnd = () => {
    if (pullOffset > 42 && !refreshing) {
      loadBuilds(true);
    }
    touchStartY.current = null;
    setPullOffset(0);
  };

  const handleDownloadApk = (build: AppBuild) => {
    startApkDownload(build);
  };

  return (
    <MobileShell>
      {/* Top Bar */}
      <header className="shrink-0 bg-[#101D35] text-white px-5 py-4 flex items-center justify-between">
        <h1 className="text-base font-extrabold">تطبيقاتي</h1>
        <button
          type="button"
          onClick={() => loadBuilds(true)}
          aria-label="تحديث القائمة"
          className="min-w-[40px] min-h-[40px] rounded-xl bg-white/10 hover:bg-white/15 flex items-center justify-center"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing || loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      <div
        ref={scrollRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
      >
        {pullOffset > 10 && (
          <div
            style={{ height: pullOffset }}
            className="flex items-center justify-center text-xs font-bold text-[#2878E8]"
          >
            اسحب للتحديث…
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-28 rounded-2xl bg-white border border-slate-200 animate-pulse"
              />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl bg-red-50 border border-red-200 p-5 text-center space-y-2">
            <AlertCircle className="w-7 h-7 text-red-600 mx-auto" />
            <p className="text-xs font-bold text-red-900">{error}</p>
            <button
              type="button"
              onClick={() => loadBuilds(false)}
              className="text-xs font-bold text-[#2878E8] underline"
            >
              إعادة المحاولة
            </button>
          </div>
        ) : builds.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center py-8 px-4">
            {!emptyImgFailed ? (
              <img
                src="/src/assets/images/empty_builds_compass_1795719419098.jpg"
                alt="لا توجد تطبيقات بعد"
                referrerPolicy="no-referrer"
                onError={() => setEmptyImgFailed(true)}
                className="w-44 h-44 object-contain rounded-3xl mb-5 border border-slate-100 bg-white p-2"
              />
            ) : (
              <div className="w-24 h-24 rounded-3xl bg-[#101D35] text-[#D5B45C] flex items-center justify-center mb-5">
                <MessageSquarePlus className="w-11 h-11" />
              </div>
            )}
            <h2 className="text-base font-extrabold text-[#101D35] mb-1.5">
              لم تبنِ أي تطبيق بعد
            </h2>
            <p className="text-xs text-slate-500 max-w-[260px] leading-relaxed mb-5">
              اكتب فكرة تطبيقك للبوت في الصفحة الرئيسية، وعند الموافقة على التقدير سيظهر تطبيقك هنا مع زر تنزيل APK.
            </p>
            <button
              type="button"
              onClick={() => navigate('/chat')}
              className="min-h-[46px] px-6 rounded-xl bg-[#2878E8] hover:bg-[#1E66CC] text-white font-bold text-sm active:scale-[0.98] transition-all"
            >
              صف تطبيقك الأول الآن
            </button>
          </div>
        ) : (
          builds.map((b) => {
            const meta = STATUS_META[b.status];
            return (
              <article
                key={b.id}
                className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3 shadow-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-bold ${meta.badgeClass}`}
                  >
                    {meta.icon}
                    <span>{meta.label}</span>
                  </span>
                  <span className="text-[11px] text-slate-500 tabular-nums">
                    {new Date(b.created_at).toLocaleDateString('ar-SD', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </div>

                <p className="text-sm font-bold text-[#101D35] leading-relaxed line-clamp-3">
                  {b.description}
                </p>

                <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-100">
                  <span>المستوى: {COMPLEXITY_LABELS[b.complexity]}</span>
                  <span className="font-bold text-[#101D35] tabular-nums">
                    {b.points_spent} نقطة
                  </span>
                </div>

                {b.status === 'failed' && (
                  <p className="text-xs text-red-700 bg-red-50 rounded-xl px-3 py-2">
                    {b.error_message ||
                      'تعذّر إكمال البناء — تم استرداد نقاطك تلقائياً إلى محفظتك.'}
                  </p>
                )}

                {b.status === 'ready' && b.apk_url && (() => {
                  const dl = downloads[b.id];
                  const installErr = installErrors[b.id];
                  const isDownloading = dl?.phase === 'downloading';
                  const isInstalling = dl?.phase === 'installing';
                  const isDone = dl?.phase === 'done';
                  const isBusy = isDownloading || isInstalling;

                  return (
                    <div className="space-y-2">
                      {isDone ? (
                        <>
                          <div className="flex items-center justify-between gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs font-bold text-emerald-800">
                            <div className="flex items-center gap-1.5">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                              <span>تم التنزيل</span>
                            </div>
                            {dl.totalBytes !== null && (
                              <span className="text-[11px] font-semibold text-emerald-700 tabular-nums">
                                {formatMegabytes(dl.totalBytes)} م.ب
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => openDownloadedApk(b)}
                            className="w-full min-h-[44px] px-3 rounded-xl bg-[#2878E8] hover:bg-[#1E66CC] text-white font-bold text-xs flex items-center justify-center gap-2 transition-colors"
                          >
                            <Download className="w-4 h-4 shrink-0" />
                            <span>فتح المثبّت</span>
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleDownloadApk(b)}
                          className="w-full min-h-[44px] px-3 rounded-xl bg-[#2878E8] hover:bg-[#1E66CC] disabled:opacity-80 text-white font-bold text-xs flex items-center justify-center gap-2 transition-colors"
                        >
                          {isDownloading ? (
                            dl.totalBytes !== null ? (
                              <span className="tabular-nums">
                                جاري التحميل {dl.percent ?? 0}% — {formatMegabytes(dl.downloadedBytes)} / {formatMegabytes(dl.totalBytes)} م.ب
                              </span>
                            ) : (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                                <span className="tabular-nums">
                                  جاري التحميل {formatMegabytes(dl.downloadedBytes)} م.ب
                                </span>
                              </>
                            )
                          ) : isInstalling ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                              <span>جاري التثبيت…</span>
                            </>
                          ) : (
                            <>
                              <Download className="w-4 h-4 shrink-0" />
                              <span>تنزيل APK</span>
                            </>
                          )}
                        </button>
                      )}

                      {(isDownloading || isInstalling) && (
                        <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          {isInstalling ? (
                            <div
                              className="h-full bg-[#2878E8] transition-all duration-150"
                              style={{ width: '100%' }}
                            />
                          ) : dl.totalBytes !== null ? (
                            <div
                              className="h-full bg-[#2878E8] transition-all duration-150"
                              style={{ width: `${dl.percent ?? 0}%` }}
                            />
                          ) : (
                            <div className="h-full w-1/2 bg-[#2878E8] rounded-full animate-pulse" />
                          )}
                        </div>
                      )}

                      {installErr && (
                        <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 space-y-2">
                          <p className="text-xs text-red-700 leading-relaxed">{installErr}</p>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => startApkDownload(b)}
                              className="min-h-[36px] px-3 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-bold text-xs inline-flex items-center gap-1.5 transition-colors"
                            >
                              <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                              <span>إعادة المحاولة</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => openApkInBrowser(b)}
                              className="min-h-[36px] px-3 rounded-lg bg-white border border-red-300 hover:bg-red-100 text-red-700 font-bold text-xs inline-flex items-center gap-1.5 transition-colors"
                            >
                              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                              <span>فتح الرابط في المتصفح</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </article>
            );
          })
        )}
      </div>
    </MobileShell>
  );
}
