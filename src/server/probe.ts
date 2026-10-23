import "server-only";
import tls from "node:tls";
import { performance } from "node:perf_hooks";
import { Agent, request } from "undici";
import { statusMatches, type ProbeResult } from "@/lib/rules";
import { assertFetchableUrl, BlockedAddressError, guardedLookup } from "./net-guard";

export type ProbeTarget = {
  url: string;
  method: "GET" | "HEAD";
  expectedStatus: string;
  keyword: string | null;
  keywordMode: "contains" | "absent";
  timeoutMs: number;
};

export type ProbeOptions = { allowPrivate?: boolean };

const MAX_REDIRECTS = 5;
const MAX_BODY = 512 * 1024;
const USER_AGENT = "NabdMonitor/1.0 (+uptime check; https://github.com/darkxgs/nabd)";

/** Finds the most specific error code in an error and its causes. */
function codeOf(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur; i++) {
    const c = (cur as { code?: unknown }).code;
    if (typeof c === "string" && c !== "UND_ERR_SOCKET") return c;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

/** A short cause people can act on, instead of a stack trace. */
export function describeError(e: unknown, timeoutMs: number): string {
  if (e instanceof BlockedAddressError) return "Address not allowed (private network)";
  const code = codeOf(e);
  const name = (e as { name?: string })?.name;
  if (name === "AbortError" || code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT" || code === "ETIMEDOUT")
    return `Timed out after ${Math.round(timeoutMs / 1000)} s`;
  switch (code) {
    case "EBLOCKED":
      return "Address not allowed (private network)";
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "Domain not found (DNS)";
    case "ECONNREFUSED":
      return "Connection refused";
    case "ECONNRESET":
    case "UND_ERR_CLOSED":
      return "Connection reset";
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return "Host unreachable";
    case "CERT_HAS_EXPIRED":
      return "SSL certificate expired";
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return "SSL certificate doesn't match the domain";
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
      return "Self-signed SSL certificate";
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "UNABLE_TO_GET_ISSUER_CERT_LOCALLY":
      return "SSL certificate chain incomplete";
  }
  const msg = (e as Error)?.message ?? String(e);
  return msg.length > 120 ? `${msg.slice(0, 117)}…` : msg;
}

/**
 * One check: request the URL (following up to five redirects, each re-checked
 * against the network guard), time it to the final response, and judge the
 * status code and optional keyword.
 */
export async function probe(t: ProbeTarget, opts: ProbeOptions = {}): Promise<ProbeResult> {
  const allowPrivate = !!opts.allowPrivate;
  const dispatcher = new Agent({
    connect: { lookup: guardedLookup(allowPrivate) as never, timeout: t.timeoutMs },
    keepAliveTimeout: 1,
    keepAliveMaxTimeout: 1,
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), t.timeoutMs);
  const started = performance.now();
  try {
    let url = assertFetchableUrl(t.url, allowPrivate);
    for (let hop = 0; ; hop++) {
      const res = await request(url, {
        method: t.method,
        dispatcher,
        signal: ctrl.signal,
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/json;q=0.9,*/*;q=0.8" },
        headersTimeout: t.timeoutMs,
        bodyTimeout: t.timeoutMs,
      });
      const location = res.headers.location;
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && location && hop < MAX_REDIRECTS) {
        await res.body.dump();
        url = assertFetchableUrl(new URL(String(location), url).toString(), allowPrivate);
        continue;
      }
      const latencyMs = Math.round(performance.now() - started);
      const code = res.statusCode;
      if (!statusMatches(t.expectedStatus, code)) {
        await res.body.dump();
        return { ok: false, statusCode: code, latencyMs, error: `HTTP ${code}` };
      }
      if (t.keyword && t.method !== "HEAD") {
        const text = await readText(res.body, MAX_BODY);
        const found = text.toLowerCase().includes(t.keyword.toLowerCase());
        if (t.keywordMode === "contains" && !found) return { ok: false, statusCode: code, latencyMs, error: `"${t.keyword}" not on the page` };
        if (t.keywordMode === "absent" && found) return { ok: false, statusCode: code, latencyMs, error: `"${t.keyword}" found on the page` };
      } else {
        await res.body.dump();
      }
      return { ok: true, statusCode: code, latencyMs, error: null };
    }
  } catch (e) {
    return { ok: false, statusCode: null, latencyMs: null, error: describeError(e, t.timeoutMs) };
  } finally {
    clearTimeout(timer);
    dispatcher.close().catch(() => {});
  }
}

async function readText(body: AsyncIterable<Uint8Array> & { destroy?: () => void }, max: number) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    chunks.push(chunk);
    size += chunk.byteLength;
    if (size >= max) break;
  }
  body.destroy?.();
  return Buffer.concat(chunks).subarray(0, max).toString("utf8");
}

export type CertInfo = { expiresAt: Date; issuer: string | null; valid: boolean };

/** Reads the certificate a site presents (even an invalid one) to track its expiry. */
export function readCertificate(rawUrl: string, timeoutMs = 8000, opts: ProbeOptions = {}): Promise<CertInfo | null> {
  return new Promise((resolve) => {
    let url: URL;
    try {
      url = assertFetchableUrl(rawUrl, opts.allowPrivate);
    } catch {
      return resolve(null);
    }
    if (url.protocol !== "https:") return resolve(null);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const socket = tls.connect({
      host,
      port: Number(url.port || 443),
      servername: host,
      rejectUnauthorized: false,
      lookup: guardedLookup(!!opts.allowPrivate) as never,
      timeout: timeoutMs,
    });
    const done = (v: CertInfo | null) => {
      socket.destroy();
      resolve(v);
    };
    socket.once("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      if (!cert || !cert.valid_to) return done(null);
      const issuer = (cert.issuer && (cert.issuer.O || cert.issuer.CN)) || null;
      done({ expiresAt: new Date(cert.valid_to), issuer: Array.isArray(issuer) ? issuer[0] : issuer, valid: socket.authorized });
    });
    socket.once("timeout", () => done(null));
    socket.once("error", () => done(null));
  });
}
