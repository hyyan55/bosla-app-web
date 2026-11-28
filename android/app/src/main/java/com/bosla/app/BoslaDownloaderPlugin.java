package com.bosla.app;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * تنزيل ملفات APK إلى مجلد التنزيلات العام عبر DownloadManager (مدير تنزيل النظام).
 *
 * لماذا لا Filesystem.downloadFile؟ تلك الدالة تكتب عبر FileOutputStream إلى
 * Directory.ExternalStorage، وهو غير قابل للكتابة في أندرويد 11 أو أحدث
 * (توثيق إضافة @capacitor/filesystem نفسه: «not accessible on Android 11 or
 * newer») — فيفشل التنزيل على أي هاتف حديث رغم وجود الإنترنت. أما DownloadManager
 * فهو خدمة النظام المسموح لها بالكتابة في التنزيلات العامة، ويتبع إعادة التوجيه
 * (روابط GitHub releases 302) بنفسه، ويعرض إشعار نظام بتقدم التنزيل.
 *
 * التثبيت يتم عبر رابط المحتوى الخاص بـ DownloadManager
 * (content://downloads/my_downloads/<id>)، فيفتحه مثبّت الحزم مباشرة دون
 * الحاجة لمسار ملف خام في التخزين المشترك.
 */
@CapacitorPlugin(name = "BoslaDownloader")
public class BoslaDownloaderPlugin extends Plugin {

    private static final String APK_MIME_TYPE = "application/vnd.android.package-archive";

    @PluginMethod
    public void startDownload(PluginCall call) {
        String url = call.getString("url");
        String fileName = call.getString("fileName");
        if (url == null || url.isEmpty() || fileName == null || fileName.isEmpty()) {
            call.reject("missing url or fileName");
            return;
        }
        try {
            DownloadManager dm = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm == null) {
                call.reject("download manager unavailable");
                return;
            }
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle(fileName);
            request.setDescription("Bosla app download");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setVisibleInDownloadsUi(true);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
            request.setMimeType(APK_MIME_TYPE);
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(true);
            long id = dm.enqueue(request);
            JSObject ret = new JSObject();
            ret.put("downloadId", id);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("download start failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void getDownloadStatus(PluginCall call) {
        long id;
        try {
            id = Long.parseLong(call.getString("downloadId", "-1"));
        } catch (Exception e) {
            call.reject("invalid downloadId");
            return;
        }
        try {
            DownloadManager dm = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm == null) {
                call.reject("download manager unavailable");
                return;
            }
            Cursor cursor = null;
            try {
                cursor = dm.query(new DownloadManager.Query().setFilterById(id));
                if (cursor == null || !cursor.moveToFirst()) {
                    JSObject ret = new JSObject();
                    ret.put("status", "not_found");
                    ret.put("downloadedBytes", 0);
                    ret.put("totalBytes", -1);
                    ret.put("reason", -1);
                    call.resolve(ret);
                    return;
                }
                int status = getIntColumn(cursor, DownloadManager.COLUMN_STATUS, -1);
                long downloaded = getLongColumn(cursor, DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR, 0);
                long total = getLongColumn(cursor, DownloadManager.COLUMN_TOTAL_SIZE_BYTES, -1);
                int reason = getIntColumn(cursor, DownloadManager.COLUMN_REASON, -1);
                String localUri = getStringColumn(cursor, DownloadManager.COLUMN_LOCAL_URI);
                JSObject ret = new JSObject();
                ret.put("status", mapStatus(status));
                ret.put("downloadedBytes", downloaded);
                ret.put("totalBytes", total);
                ret.put("reason", reason);
                if (localUri != null) {
                    ret.put("localUri", localUri);
                }
                call.resolve(ret);
            } finally {
                if (cursor != null) {
                    cursor.close();
                }
            }
        } catch (Exception e) {
            call.reject("status query failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void openDownloadedApk(PluginCall call) {
        long id;
        try {
            id = Long.parseLong(call.getString("downloadId", "-1"));
        } catch (Exception e) {
            call.reject("invalid downloadId");
            return;
        }
        try {
            DownloadManager dm = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm == null) {
                call.reject("download manager unavailable");
                return;
            }
            Uri uri = dm.getUriForDownloadedFile(id);
            if (uri == null) {
                call.reject("file not found");
                return;
            }
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, APK_MIME_TYPE);
            intent.setFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Activity activity = getActivity();
            try {
                if (activity != null) {
                    activity.startActivity(intent);
                } else {
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(intent);
                }
                call.resolve();
            } catch (ActivityNotFoundException e) {
                call.reject("no installer found");
            }
        } catch (Exception e) {
            call.reject("open failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void findDownloadByFileName(PluginCall call) {
        String fileName = call.getString("fileName");
        if (fileName == null || fileName.isEmpty()) {
            call.reject("missing fileName");
            return;
        }
        try {
            DownloadManager dm = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm == null) {
                call.reject("download manager unavailable");
                return;
            }
            Cursor cursor = null;
            try {
                cursor = dm.query(new DownloadManager.Query());
                long foundId = -1;
                String foundStatus = null;
                if (cursor != null) {
                    while (cursor.moveToNext()) {
                        String title = getStringColumn(cursor, DownloadManager.COLUMN_TITLE);
                        String localUri = getStringColumn(cursor, DownloadManager.COLUMN_LOCAL_URI);
                        boolean matches = fileName.equals(title)
                                || (localUri != null && localUri.endsWith("/" + fileName));
                        if (!matches) {
                            continue;
                        }
                        int status = getIntColumn(cursor, DownloadManager.COLUMN_STATUS, -1);
                        long id = getLongColumn(cursor, DownloadManager.COLUMN_ID, -1);
                        String mapped = mapStatus(status);
                        // فضّل التنزيل المكتمل إن وُجد أكثر من مطابق.
                        if ("successful".equals(mapped)) {
                            foundId = id;
                            foundStatus = mapped;
                            break;
                        }
                        if (foundId < 0) {
                            foundId = id;
                            foundStatus = mapped;
                        }
                    }
                }
                JSObject ret = new JSObject();
                if (foundId >= 0) {
                    ret.put("found", true);
                    ret.put("downloadId", String.valueOf(foundId));
                    ret.put("status", foundStatus);
                } else {
                    ret.put("found", false);
                }
                call.resolve(ret);
            } finally {
                if (cursor != null) {
                    cursor.close();
                }
            }
        } catch (Exception e) {
            call.reject("lookup failed: " + e.getMessage());
        }
    }

    private static String mapStatus(int status) {
        switch (status) {
            case DownloadManager.STATUS_PENDING:
                return "pending";
            case DownloadManager.STATUS_RUNNING:
                return "running";
            case DownloadManager.STATUS_PAUSED:
                return "paused";
            case DownloadManager.STATUS_SUCCESSFUL:
                return "successful";
            case DownloadManager.STATUS_FAILED:
                return "failed";
            default:
                return "not_found";
        }
    }

    private static int getIntColumn(Cursor cursor, String column, int fallback) {
        int idx = cursor.getColumnIndex(column);
        if (idx < 0) {
            return fallback;
        }
        try {
            return cursor.getInt(idx);
        } catch (Exception e) {
            return fallback;
        }
    }

    private static long getLongColumn(Cursor cursor, String column, long fallback) {
        int idx = cursor.getColumnIndex(column);
        if (idx < 0) {
            return fallback;
        }
        try {
            return cursor.getLong(idx);
        } catch (Exception e) {
            return fallback;
        }
    }

    private static String getStringColumn(Cursor cursor, String column) {
        int idx = cursor.getColumnIndex(column);
        if (idx < 0) {
            return null;
        }
        try {
            return cursor.getString(idx);
        } catch (Exception e) {
            return null;
        }
    }
}
