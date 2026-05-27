import { createReadStream } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, normalize, resolve } from "node:path";
import type { ErrorResponseDto } from "../contracts/apiContractV1.js";
import type { AuthContext } from "./authRoutes.js";

export interface StaticRouteDeps {
  publicDir: string;
}

export interface MediaRouteDeps {
  corsHeaders: Record<string, string>;
  mediaRoots: string[];
  isAuthorized(request: IncomingMessage): boolean;
  getAuthContext(request: IncomingMessage): AuthContext | null;
  resolveAuthorizedMediaPath(rawPath: string, auth: AuthContext): Promise<string | null>;
  sendJson(response: ServerResponse, statusCode: number, body: unknown): void;
}

export async function handleStaticRoute(request: IncomingMessage, response: ServerResponse, url: URL, deps: StaticRouteDeps): Promise<boolean> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return false;
  }

  const pathname = decodeURIComponent(url.pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const normalizedPath = normalize(relativePath);
  if (normalizedPath.startsWith("..") || normalizedPath.includes("/../")) {
    return false;
  }

  let filePath = resolve(deps.publicDir, normalizedPath);
  if (!filePath.startsWith(`${deps.publicDir}/`) && filePath !== deps.publicDir) {
    return false;
  }

  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      if (normalizedPath === "download" || normalizedPath.startsWith("download/")) {
        await serveDirectoryListing(request, response, filePath, pathname);
        return true;
      }
      filePath = resolve(filePath, "index.html");
    } else if (!fileStat.isFile()) {
      return false;
    }
  } catch {
    const extension = extname(normalizedPath).toLowerCase();
    const isAssetRequest = Boolean(extension) || normalizedPath.startsWith("assets/");
    if (isAssetRequest) {
      return false;
    }
    filePath = resolve(deps.publicDir, "index.html");
    try {
      const indexStat = await stat(filePath);
      if (!indexStat.isFile()) {
        return false;
      }
    } catch {
      return false;
    }
  }

  const noCache = filePath.endsWith("index.html") || filePath.endsWith("sw.js") || filePath.endsWith("client-version.json");
  response.writeHead(200, {
    "content-type": contentTypeFor(filePath),
    "cache-control": noCache ? "no-cache" : "public, max-age=3600",
  });
  if (request.method === "HEAD") {
    response.end();
    return true;
  }
  createReadStream(filePath).pipe(response);
  return true;
}


async function serveDirectoryListing(
  request: IncomingMessage,
  response: ServerResponse,
  directoryPath: string,
  requestPathname: string,
): Promise<void> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const basePath = requestPathname.endsWith("/") ? requestPathname : `${requestPathname}/`;
  const visibleEntries = entries
    .filter((entry) => !entry.name.startsWith(".") && entry.name !== "index.html")
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));

  const rows = await Promise.all(visibleEntries.map(async (entry) => {
    const entryPath = resolve(directoryPath, entry.name);
    const entryStat = await stat(entryPath);
    const label = entry.isDirectory() ? `${entry.name}/` : entry.name;
    const href = `${basePath}${encodeURIComponent(entry.name)}${entry.isDirectory() ? "/" : ""}`;
    const downloadAttribute = entry.isDirectory() ? "" : " download";
    const size = entry.isDirectory() ? "-" : formatFileSize(entryStat.size);
    const modified = formatDateTime(entryStat.mtime);

    return `<tr>
        <td class="name"><a href="${escapeHtml(href)}"${downloadAttribute}>${escapeHtml(label)}</a></td>
        <td class="size">${escapeHtml(size)}</td>
        <td class="modified">${escapeHtml(modified)}</td>
      </tr>`;
  }));

  const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>파일 다운로드</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 40px; line-height: 1.5; color: #111827; }
    main { max-width: 900px; }
    h1 { margin-bottom: 8px; }
    .note { color: #4b5563; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: left; }
    th { background: #f9fafb; color: #374151; font-weight: 700; }
    tr:hover td { background: #f9fafb; }
    a { color: #2563eb; text-decoration: none; font-weight: 600; }
    a:hover { text-decoration: underline; }
    .size { text-align: right; white-space: nowrap; color: #374151; }
    .modified { white-space: nowrap; color: #6b7280; }
    .empty { color: #6b7280; text-align: center; }
    @media (max-width: 640px) { body { margin: 20px; } .modified { display: none; } }
  </style>
</head>
<body>
  <main>
    <h1>파일 다운로드</h1>
    <p class="note">이 폴더의 현재 파일 목록입니다. 파일을 클릭하면 다운로드됩니다.</p>
    <table>
      <thead>
        <tr><th>이름</th><th class="size">크기</th><th class="modified">수정한 날짜</th></tr>
      </thead>
      <tbody>
      ${rows.length > 0 ? rows.join("\n      ") : '<tr><td class="empty" colspan="3">파일이 없습니다.</td></tr>'}
      </tbody>
    </table>
  </main>
</body>
</html>`;

  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-cache",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  response.end(html);
}

function formatFileSize(size: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return unitIndex === 0 ? `${value} ${units[unitIndex]}` : `${value.toFixed(1)} ${units[unitIndex]}`;
}

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return char;
    }
  });
}

export async function handleMediaRoute(request: IncomingMessage, response: ServerResponse, url: URL, deps: MediaRouteDeps): Promise<boolean> {
  if (request.method !== "GET" || url.pathname !== "/v1/media") {
    return false;
  }

  await serveMediaFile(request, response, url.searchParams.get("path") ?? "", deps);
  return true;
}

function contentTypeFor(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".webmanifest":
      return "application/manifest+json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".pdf":
      return "application/pdf";
    case ".zip":
      return "application/zip";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".md":
      return "text/markdown; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function isWithinRoot(filePath: string, root: string): boolean {
  return filePath === root || filePath.startsWith(`${root}/`);
}

function normalizeMediaPath(rawPath: string): string {
  if (rawPath.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(rawPath).pathname);
    } catch {
      return rawPath;
    }
  }
  return rawPath;
}

async function resolveAllowedMediaPath(rawPath: string, mediaRoots: string[]): Promise<string | null> {
  const filePath = await realpath(resolve(normalizeMediaPath(rawPath)));
  const realRoots = await Promise.all(mediaRoots.map(async (root) => realpath(root).catch(() => resolve(root))));
  return realRoots.some((root) => isWithinRoot(filePath, root)) ? filePath : null;
}

async function serveMediaFile(request: IncomingMessage, response: ServerResponse, rawPath: string, deps: MediaRouteDeps): Promise<void> {
  if (!deps.isAuthorized(request)) {
    deps.sendJson(response, 401, {
      error: {
        code: "AUTH_INVALID_TOKEN",
        message: "API key is invalid.",
      },
      request_id: "req_unavailable",
    } satisfies ErrorResponseDto);
    return;
  }

  const auth = deps.getAuthContext(request);
  const filePath = auth
    ? await deps.resolveAuthorizedMediaPath(rawPath, auth)
    : await resolveAllowedMediaPath(rawPath, deps.mediaRoots).catch(() => null);
  if (!filePath) {
    deps.sendJson(response, 403, {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Media path is not allowed.",
      },
      request_id: "req_unavailable",
    } satisfies ErrorResponseDto);
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      throw new Error("not a file");
    }
    response.writeHead(200, {
      "content-type": contentTypeFor(filePath),
      "content-length": String(fileStat.size),
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(filePath.split("/").pop() ?? "media")}`,
      ...deps.corsHeaders,
    });
    createReadStream(filePath).pipe(response);
  } catch {
    deps.sendJson(response, 404, {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Media file not found.",
      },
      request_id: "req_unavailable",
    } satisfies ErrorResponseDto);
  }
}
