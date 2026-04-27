package ai.kryp.openclaw;

import android.Manifest;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.ViewGroup;
import android.widget.Toast;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

public class MainActivity extends Activity {
    private static final String START_URL = "https://ai.kryp.xyz/";
    private static final int LOCATION_REQUEST = 42;
    private static final int FILE_REQUEST = 43;

    private SwipeRefreshLayout swipeRefreshLayout;
    private WebView webView;
    private GeolocationPermissions.Callback pendingGeoCallback;
    private String pendingGeoOrigin;
    private ValueCallback<Uri[]> filePathCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        swipeRefreshLayout = new SwipeRefreshLayout(this);
        swipeRefreshLayout.setLayoutParams(new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        swipeRefreshLayout.setColorSchemeColors(0xFF38BDF8, 0xFF0EA5E9, 0xFF2563EB);
        swipeRefreshLayout.setEnabled(false);
        swipeRefreshLayout.setOnRefreshListener(() -> webView.reload());

        webView = new WebView(this);
        webView.setLayoutParams(new SwipeRefreshLayout.LayoutParams(
            SwipeRefreshLayout.LayoutParams.MATCH_PARENT,
            SwipeRefreshLayout.LayoutParams.MATCH_PARENT
        ));
        swipeRefreshLayout.addView(webView);
        setContentView(swipeRefreshLayout);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }

        webView.addJavascriptInterface(new ScrollBridge(), "OpenClawAndroid");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("ai.kryp.xyz".equals(uri.getHost())) {
                    return false;
                }
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                swipeRefreshLayout.setRefreshing(false);
                installScrollReporter();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (hasLocationPermission()) {
                    callback.invoke(origin, true, false);
                    return;
                }
                pendingGeoOrigin = origin;
                pendingGeoCallback = callback;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    requestPermissions(new String[] {
                        Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION
                    }, LOCATION_REQUEST);
                } else {
                    callback.invoke(origin, true, false);
                }
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                Intent intent = params.createIntent();
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                try {
                    startActivityForResult(intent, FILE_REQUEST);
                } catch (Exception error) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });

        if (savedInstanceState == null) {
            webView.loadUrl(START_URL);
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    private void installScrollReporter() {
        webView.evaluateJavascript(
            "(function(){" +
                "var messages=document.getElementById('messages');" +
                "if(!messages||!window.OpenClawAndroid){return;}" +
                "function report(){OpenClawAndroid.setCanRefresh(messages.scrollTop<=0 && window.scrollY<=0);}" +
                "messages.removeEventListener('scroll', window.__openClawRefreshReport);" +
                "window.removeEventListener('scroll', window.__openClawRefreshReport);" +
                "window.__openClawRefreshReport=report;" +
                "messages.addEventListener('scroll', report, {passive:true});" +
                "window.addEventListener('scroll', report, {passive:true});" +
                "report();" +
            "})();",
            null
        );
    }

    private boolean hasLocationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return true;
        }
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private class ScrollBridge {
        @JavascriptInterface
        public void setCanRefresh(boolean canRefresh) {
            runOnUiThread(() -> swipeRefreshLayout.setEnabled(canRefresh));
        }

        @JavascriptInterface
        public void downloadBlob(String fileName, String mimeType, String base64Data) {
            try {
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                String safeName = safeFileName(fileName);
                saveToDownloads(safeName, mimeType, bytes);
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "다운로드 완료: " + safeName, Toast.LENGTH_SHORT).show());
            } catch (Exception error) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "다운로드 실패: " + error.getMessage(), Toast.LENGTH_LONG).show());
            }
        }

        @JavascriptInterface
        public void clearWebCache() {
            runOnUiThread(() -> {
                webView.clearCache(true);
                webView.clearFormData();
                WebStorage.getInstance().deleteAllData();
                Toast.makeText(MainActivity.this, "캐시를 삭제했습니다.", Toast.LENGTH_SHORT).show();
            });
        }
    }

    private String safeFileName(String fileName) {
        String fallback = "openclaw-image.png";
        if (fileName == null || fileName.trim().isEmpty()) {
            return fallback;
        }
        String safe = fileName.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
        return safe.isEmpty() ? fallback : safe;
    }

    private void saveToDownloads(String fileName, String mimeType, byte[] bytes) throws Exception {
        String type = (mimeType == null || mimeType.isEmpty()) ? "application/octet-stream" : mimeType;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
            values.put(MediaStore.MediaColumns.MIME_TYPE, type);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/OpenClaw");
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) {
                throw new IllegalStateException("다운로드 항목을 만들 수 없습니다.");
            }
            try (OutputStream output = getContentResolver().openOutputStream(uri)) {
                if (output == null) {
                    throw new IllegalStateException("다운로드 파일을 열 수 없습니다.");
                }
                output.write(bytes);
            }
            values.clear();
            values.put(MediaStore.MediaColumns.IS_PENDING, 0);
            getContentResolver().update(uri, values, null, null);
            return;
        }

        File directory = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "OpenClaw");
        if (!directory.exists() && !directory.mkdirs()) {
            throw new IllegalStateException("다운로드 폴더를 만들 수 없습니다.");
        }
        File file = new File(directory, fileName);
        try (OutputStream output = new FileOutputStream(file)) {
            output.write(bytes);
        }
        sendBroadcast(new Intent(Intent.ACTION_MEDIA_SCANNER_SCAN_FILE, Uri.fromFile(file)));
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == LOCATION_REQUEST && pendingGeoCallback != null) {
            boolean granted = false;
            for (int result : grantResults) {
                granted = granted || result == PackageManager.PERMISSION_GRANTED;
            }
            pendingGeoCallback.invoke(pendingGeoOrigin, granted, false);
            pendingGeoCallback = null;
            pendingGeoOrigin = null;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_REQUEST && filePathCallback != null) {
            Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            filePathCallback.onReceiveValue(result);
            filePathCallback = null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
