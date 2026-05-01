import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, normalize, resolve } from "node:path";
import type { ErrorResponseDto } from "../contracts/apiContractV1.js";

export interface StaticRouteDeps {
  publicDir: string;
}

export interface MediaRouteDeps {
  corsHeaders: Record<string, string>;
  mediaRoots: string[];
  isAuthorized(request: IncomingMessage): boolean;
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

  response.writeHead(200, {
    "content-type": contentTypeFor(filePath),
    "cache-control": filePath.endsWith("index.html") || filePath.endsWith("sw.js") ? "no-cache" : "public, max-age=3600",
  });
  if (request.method === "HEAD") {
    response.end();
    return true;
  }
  createReadStream(filePath).pipe(response);
  return true;
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
    case ".txt":
      return "text/plain; charset=utf-8";
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

function resolveAllowedMediaPath(rawPath: string, mediaRoots: string[]): string | null {
  const filePath = resolve(normalizeMediaPath(rawPath));
  return mediaRoots.some((root) => isWithinRoot(filePath, root)) ? filePath : null;
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

  const filePath = resolveAllowedMediaPath(rawPath, deps.mediaRoots);
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
