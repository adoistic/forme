import dnsPromises from "node:dns/promises";
import path from "node:path";
import ipaddr from "ipaddr.js";
import { makeError } from "@shared/errors/structured.js";

// SSRF-safe URL fetcher per CEO plan 4G + G5 (codex tension SSRF). Used by the
// hero-image-from-URL path in `hero:upload-url`. Two-layer defense:
//
//   1. URL parsing rejects non-http/https schemes outright.
//   2. DNS lookup runs BEFORE the request and every resolved address is
//      checked against private / loopback / link-local / ULA ranges. The
//      link-local check covers cloud metadata (169.254.169.254 / fd00::).
//
// Electron's `net.fetch` is used in production (vs. global fetch) so the
// request goes through Electron's network stack — respects user proxies +
// system cert chain. We don't import `electron` at module scope so unit
// tests can run under plain Node without crashing on the missing dep; the
// fetcher is injected lazily and the production wiring lives in
// `safeFetchUrl` itself via `defaultFetcher()` below.

export interface FetchUrlResult {
  bytes: Buffer;
  contentType: string;
  filename: string;
}

export type DnsLookupResult = { address: string; family: number };
export type DnsLookupFn = (hostname: string) => Promise<DnsLookupResult[]>;

export type FetcherFn = (
  url: string,
  init: { signal: AbortSignal; redirect?: "error" | "follow" | "manual" }
) => Promise<Response>;

export interface FetchUrlOptions {
  /** Hard timeout — default 30s. Counts the entire request including body. */
  timeoutMs?: number;
  /** Hard cap on response size — default 50MB. Streamed read aborts past this. */
  maxBytes?: number;
  /** Override DNS lookup (used by tests). Defaults to `node:dns/promises.lookup`. */
  dnsLookup?: DnsLookupFn;
  /** Override fetcher (used by tests). Defaults to Electron `net.fetch`. */
  fetcher?: FetcherFn;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Production fetcher — lazily imports Electron so unit tests under plain
 * Node don't crash at module load. Throws a clear error if `electron` is
 * unavailable in a non-test environment (e.g. someone calls safeFetchUrl
 * outside the main process).
 */
async function defaultFetcher(
  url: string,
  init: { signal: AbortSignal; redirect?: "error" | "follow" | "manual" }
): Promise<Response> {
  const { net } = await import("electron");
  return net.fetch(url, init);
}

const defaultDnsLookup: DnsLookupFn = (hostname) => dnsPromises.lookup(hostname, { all: true });

/**
 * Fetch a URL with SSRF guards. Throws a StructuredError with one of the
 * `url_*` codes (see `@shared/errors/registry.ts`) on any rejection so the
 * caller can surface the operator-facing message directly.
 */
export async function safeFetchUrl(
  url: string,
  opts: FetchUrlOptions = {}
): Promise<FetchUrlResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const dnsLookup = opts.dnsLookup ?? defaultDnsLookup;
  const fetcher = opts.fetcher ?? defaultFetcher;

  // ---- Layer 1: URL parsing ----
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw makeError("url_invalid_scheme", "error", { url });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw makeError("url_invalid_scheme", "error", { scheme: parsed.protocol, url });
  }

  // ---- Layer 2: DNS resolution + private-range rejection ----
  // Resolve ALL addresses so we can refuse hosts that round-robin between
  // public and private IPs (a DNS-pinning bypass via secondary records).
  // If the hostname is itself an IP literal, the lookup short-circuits but
  // we still run isPrivateAddress on the resolved value.
  let addresses: DnsLookupResult[];
  try {
    addresses = await dnsLookup(parsed.hostname);
  } catch (cause: unknown) {
    throw makeError("url_fetch_failed", "error", { url, reason: errorMsg(cause) });
  }
  if (addresses.length === 0) {
    throw makeError("url_fetch_failed", "error", { reason: "no_dns_records", url });
  }
  for (const addr of addresses) {
    if (isPrivateAddress(addr.address)) {
      throw makeError("url_private_address", "error", { url, address: addr.address });
    }
  }

  // ---- Layer 3: fetch with abort + timeout + size guard ----
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort(new Error("timeout"));
  }, timeoutMs);

  let response: Response;
  try {
    response = await fetcher(url, {
      signal: controller.signal,
      // Don't follow redirects automatically — the redirect target could be a
      // private address. The 30x response surfaces as `url_fetch_failed`.
      redirect: "error",
    });
  } catch (cause: unknown) {
    clearTimeout(timeoutHandle);
    if (controller.signal.aborted) {
      throw makeError("url_timeout", "error", { url, timeoutMs });
    }
    throw makeError("url_fetch_failed", "error", { url, reason: errorMsg(cause) });
  }

  if (!response.ok) {
    clearTimeout(timeoutHandle);
    throw makeError("url_fetch_failed", "error", { url, status: response.status });
  }

  // Content-length precheck (cheap reject before we read a byte of body).
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const advertised = Number(contentLengthHeader);
    if (Number.isFinite(advertised) && advertised > maxBytes) {
      clearTimeout(timeoutHandle);
      throw makeError("url_too_large", "error", { url, advertised, maxBytes });
    }
  }

  // Content-type check — reject non-image responses early.
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  // Strip any "; charset=…" suffix before the prefix check.
  const baseType = contentType.split(";")[0]?.trim() ?? "";
  if (!baseType.startsWith("image/")) {
    clearTimeout(timeoutHandle);
    throw makeError("url_not_image", "error", { url, contentType });
  }

  // ---- Stream-read body with running size guard ----
  // We read in chunks and bail the moment we cross maxBytes so a malicious
  // server can't waste 50MB+ of memory by lying in content-length.
  const body = response.body;
  if (!body) {
    clearTimeout(timeoutHandle);
    throw makeError("url_fetch_failed", "error", { url, reason: "no_body" });
  }

  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      if (received > maxBytes) {
        controller.abort(new Error("max_bytes"));
        throw makeError("url_too_large", "error", { url, received, maxBytes });
      }
      chunks.push(value);
    }
  } catch (cause: unknown) {
    if (cause && typeof cause === "object" && "code" in cause) {
      throw cause;
    }
    if (controller.signal.aborted) {
      throw makeError("url_timeout", "error", { url, timeoutMs });
    }
    throw makeError("url_fetch_failed", "error", { url, reason: errorMsg(cause) });
  } finally {
    clearTimeout(timeoutHandle);
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }

  const bytes = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  const filename = filenameFromUrl(parsed);

  return { bytes, contentType: baseType, filename };
}

/**
 * True if the given IP literal is in any range we refuse to fetch from.
 * Covers IPv4 private/loopback/link-local + IPv6 loopback/link-local/ULA.
 * Link-local (169.254.0.0/16) catches cloud metadata 169.254.169.254.
 */
export function isPrivateAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) {
    // Unparseable — refuse defensively. (Shouldn't happen post-DNS-lookup.)
    return true;
  }
  const parsed = ipaddr.parse(address);

  if (parsed.kind() === "ipv4") {
    const v4 = parsed as ipaddr.IPv4;
    const range = v4.range();
    // ipaddr.js range names cover the categories we care about. We
    // explicitly enumerate so accidental allowlist drift via library
    // updates is loud, not silent.
    return (
      range === "private" || // 10/8, 172.16/12, 192.168/16
      range === "loopback" || // 127/8
      range === "linkLocal" || // 169.254/16 — includes 169.254.169.254 cloud metadata
      range === "carrierGradeNat" || // 100.64/10
      range === "broadcast" || // 255.255.255.255
      range === "multicast" || // 224/4
      range === "unspecified" || // 0.0.0.0
      range === "reserved" // 240/4
    );
  }

  // IPv6
  const v6 = parsed as ipaddr.IPv6;
  // IPv4-mapped (::ffff:1.2.3.4) needs to be unwrapped so we don't bypass the
  // private check by writing a private IPv4 in IPv6 syntax.
  if (v6.isIPv4MappedAddress()) {
    return isPrivateAddress(v6.toIPv4Address().toString());
  }
  const range = v6.range();
  return (
    range === "loopback" || // ::1
    range === "linkLocal" || // fe80::/10
    range === "uniqueLocal" || // fc00::/7 (ULA)
    range === "multicast" ||
    range === "unspecified" ||
    range === "reserved"
  );
}

function filenameFromUrl(parsed: URL): string {
  const last = parsed.pathname.split("/").filter(Boolean).pop() ?? "";
  if (last) {
    // Strip query string; if there's no extension, fall through to host-based name.
    const cleaned = decodeURIComponent(last);
    if (path.extname(cleaned)) return cleaned;
  }
  return `${parsed.hostname}-image`;
}

function errorMsg(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
