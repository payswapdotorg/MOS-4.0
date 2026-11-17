import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Socket } from "node:net";

import { parseLoopbackCallback, type LoopbackCallback } from "./oauth.js";

/**
 * RFC 8252 §7.3 loopback redirect receiver for the Google OAuth native-app
 * flow. Pure node:http (no Electron); binds 127.0.0.1 with an OS-assigned port
 * (Google treats any port on 127.0.0.1 as the registered loopback redirect).
 *
 * Placement: instantiated by the services-layer MOS connection service
 * (docs/mos/desktop-integration-spec.md). Design follows the repo's loopback
 * precedents (remoteMediaPreviewProxy / cloudContentService): lazy listen on
 * port 0, socket tracking, injectable serverFactory for tests, and dispose()
 * that never throws.
 */

export type LoopbackFailureReason =
  | "timed-out"
  | "access-denied"
  | "invalid-response"
  | "aborted"
  | "server-error";

/** The successful variant of the parsed redirect (code + state + scopes). */
export type LoopbackCallbackSuccess = Extract<LoopbackCallback, { ok: true }>;

export type LoopbackResult =
  | { ok: true; callback: LoopbackCallbackSuccess }
  | { ok: false; reason: LoopbackFailureReason; message?: string };

export interface PendingLoopbackFlow {
  /** Exactly what was sent to Google as redirect_uri. */
  redirectUri: string;
  /**
   * Resolves on the first valid (state-matching) callback, a user denial,
   * timeout, or dispose — always exactly once. A mismatched-state request is
   * answered with an error page but does NOT resolve the wait (stale tabs
   * must not kill a live flow).
   */
  waitForCallback(options?: { timeoutMs?: number }): Promise<LoopbackResult>;
  dispose(): Promise<void>;
}

export interface LoopbackServerOptions {
  expectedState: string;
  serverFactory?: () => Server;
  /** Structured, non-sensitive request diagnostics (never URLs with codes). */
  onInvalidRequest?: (info: { kind: "method-not-allowed" | "invalid-response" | "state-mismatch" }) => void;
}

const SUCCESS_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>MOS 4.0</title></head>
<body style="font-family:system-ui,sans-serif;background:#0b0d12;color:#e6e8ee;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
<div style="text-align:center;padding:2rem">
<div style="font-size:2rem;font-weight:700">MOS 4.0</div>
<p>YouTube connected. You can close this tab and return to the app.<br>YouTube 已连接，可以关闭此页并返回应用。</p>
</div></body></html>`;

const ERROR_PAGE = (heading: string, detail: string) => `<!doctype html>
<html><head><meta charset="utf-8"><title>MOS 4.0</title></head>
<body style="font-family:system-ui,sans-serif;background:#0b0d12;color:#e6e8ee;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
<div style="text-align:center;padding:2rem">
<div style="font-size:2rem;font-weight:700">MOS 4.0</div>
<p><strong>${heading}</strong></p><p>${detail}</p>
</div></body></html>`;

const DENIED_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>MOS 4.0</title></head>
<body style="font-family:system-ui,sans-serif;background:#0b0d12;color:#e6e8ee;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
<div style="text-align:center;padding:2rem">
<div style="font-size:2rem;font-weight:700">MOS 4.0</div>
<p>Sign-in was cancelled. You can close this tab.<br>已取消连接，可以关闭此页。</p>
</div></body></html>`;

export async function startLoopbackCallbackServer(options: LoopbackServerOptions): Promise<PendingLoopbackFlow> {
  const server = (options.serverFactory ?? (() => createServer()))();
  const sockets = new Set<Socket>();
  let settled = false;
  let timeoutHandle: NodeJS.Timeout | null = null;
  let disposeRequested = false;

  let resolveWait: ((result: LoopbackResult) => void) | null = null;
  const waitPromise = new Promise<LoopbackResult>((resolve) => {
    resolveWait = resolve;
  });

  const finish = (result: LoopbackResult): void => {
    if (settled) return;
    settled = true;
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    resolveWait?.(result);
    void closeServer();
  };

  const closeServer = async (): Promise<void> => {
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  };

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  server.on("error", (error) => {
    finish({
      ok: false,
      reason: "server-error",
      message: error instanceof Error ? error.message : String(error),
    });
  });

  server.on("request", (request: IncomingMessage, response: ServerResponse) => {
    handleRequest(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500, { "content-type": "text/html; charset=utf-8" });
      response.end(ERROR_PAGE("Connection failed", "Please try connecting again from MOS 4.0."));
    });
  });

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      options.onInvalidRequest?.({ kind: "method-not-allowed" });
      response.writeHead(405, { "content-type": "text/html; charset=utf-8", allow: "GET, HEAD" });
      response.end(ERROR_PAGE("Method not allowed", "This local endpoint only serves the Google sign-in redirect."));
      return;
    }

    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    // 修复原因：先做 state 校验再分支 error/code——否则拒授权（error=access_denied）会被
    // 误判为"响应不完整"，且成功回调上不存在的 error 字段会把整个流当成拒绝处理。
    const state = url.searchParams.get("state");
    if (state === null || state !== options.expectedState) {
      // Stale tab / replay / missing state: report, answer the browser, keep the live flow waiting.
      options.onInvalidRequest?.({ kind: "state-mismatch" });
      response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
      response.end(
        ERROR_PAGE(
          "Sign-in session mismatch",
          "This link belongs to an older sign-in attempt. Please use the latest MOS 4.0 sign-in window.",
        ),
      );
      return;
    }

    const errorParam = url.searchParams.get("error");
    if (errorParam !== null) {
      respondHtml(response, request.method === "HEAD" ? undefined : DENIED_PAGE, 200);
      finish({ ok: false, reason: "access-denied", message: errorParam });
      return;
    }

    const callback = parseLoopbackCallback(url.searchParams);
    if (!callback.ok) {
      options.onInvalidRequest?.({ kind: "invalid-response" });
      response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
      response.end(
        ERROR_PAGE(
          "Sign-in response incomplete",
          "The redirect was missing the authorization code. Please retry from MOS 4.0.",
        ),
      );
      return;
    }

    respondHtml(response, request.method === "HEAD" ? undefined : SUCCESS_PAGE, 200);
    finish({ ok: true, callback });
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    // 修复原因：OAuth 等待期间不能因 unref 的 server 阻止进程退出，但 close 仍需显式触发。
    server.listen(0, "127.0.0.1", () => resolve());
  });
  server.unref();

  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer();
    throw new Error("loopback server did not return a TCP port");
  }

  return {
    redirectUri: `http://127.0.0.1:${address.port}/`,
    waitForCallback({ timeoutMs } = {}) {
      if (timeoutMs !== undefined && timeoutMs > 0 && !settled && timeoutHandle === null) {
        timeoutHandle = setTimeout(() => {
          finish({ ok: false, reason: "timed-out" });
        }, timeoutMs);
        timeoutHandle.unref?.();
      }
      return waitPromise;
    },
    async dispose() {
      finish({ ok: false, reason: "aborted" });
    },
  };
}

function respondHtml(response: ServerResponse, body: string | undefined, status: number): void {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}
