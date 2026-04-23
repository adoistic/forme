import { describe, expect, test } from "vitest";
import {
  isPrivateAddress,
  safeFetchUrl,
  type DnsLookupFn,
  type FetcherFn,
} from "../../../src/main/url-fetch/ssrf-guard.js";

// Tests for SSRF guard — covers the IP-range allowlist, the URL parsing
// gate, and the fetch-side guards (content-type, size, timeout). The
// fetcher + dnsLookup are injected so we don't need real network.

function dns(addresses: string[]): DnsLookupFn {
  return async () =>
    addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
}

function fetcherReturning(response: Response): FetcherFn {
  return async () => response;
}

function imageBody(bytes: Uint8Array, contentType = "image/jpeg"): Response {
  // Wrap in Buffer so the cross-version DOM lib doesn't trip on the
  // Uint8Array<ArrayBufferLike> ↔ BodyInit narrowing.
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-length": String(bytes.byteLength),
    },
  });
}

describe("isPrivateAddress", () => {
  test("rejects IPv4 private ranges", () => {
    expect(isPrivateAddress("10.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.255.255.255")).toBe(true);
    expect(isPrivateAddress("172.16.0.1")).toBe(true);
    expect(isPrivateAddress("172.31.255.254")).toBe(true);
    expect(isPrivateAddress("192.168.1.1")).toBe(true);
  });

  test("rejects IPv4 loopback (127/8)", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("127.10.20.30")).toBe(true);
  });

  test("rejects IPv4 link-local (169.254/16) — includes cloud metadata", () => {
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("169.254.0.1")).toBe(true);
  });

  test("rejects IPv6 loopback ::1", () => {
    expect(isPrivateAddress("::1")).toBe(true);
  });

  test("rejects IPv6 link-local fe80::/10", () => {
    expect(isPrivateAddress("fe80::1")).toBe(true);
  });

  test("rejects IPv6 ULA fc00::/7", () => {
    expect(isPrivateAddress("fc00::1")).toBe(true);
    expect(isPrivateAddress("fd00::1")).toBe(true);
  });

  test("rejects IPv4-mapped IPv6 wrappers around private IPs", () => {
    // ::ffff:10.0.0.1 — common SSRF bypass technique
    expect(isPrivateAddress("::ffff:10.0.0.1")).toBe(true);
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateAddress("::ffff:169.254.169.254")).toBe(true);
  });

  test("rejects unspecified + multicast + broadcast", () => {
    expect(isPrivateAddress("0.0.0.0")).toBe(true);
    expect(isPrivateAddress("224.0.0.1")).toBe(true);
    expect(isPrivateAddress("255.255.255.255")).toBe(true);
  });

  test("allows public IPv4", () => {
    expect(isPrivateAddress("1.1.1.1")).toBe(false);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("142.250.80.46")).toBe(false);
  });

  test("allows public IPv6", () => {
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
  });

  test("invalid string is refused defensively", () => {
    expect(isPrivateAddress("not an ip")).toBe(true);
    expect(isPrivateAddress("")).toBe(true);
  });
});

describe("safeFetchUrl — URL parsing", () => {
  test("rejects file:// scheme", async () => {
    await expect(
      safeFetchUrl("file:///etc/passwd", {
        dnsLookup: dns(["1.1.1.1"]),
        fetcher: fetcherReturning(imageBody(new Uint8Array([0]))),
      })
    ).rejects.toMatchObject({ code: "url_invalid_scheme" });
  });

  test("rejects ftp:// scheme", async () => {
    await expect(
      safeFetchUrl("ftp://example.com/file.png", {
        dnsLookup: dns(["1.1.1.1"]),
        fetcher: fetcherReturning(imageBody(new Uint8Array([0]))),
      })
    ).rejects.toMatchObject({ code: "url_invalid_scheme" });
  });

  test("rejects malformed URL", async () => {
    await expect(
      safeFetchUrl("not://a real url at all", {
        dnsLookup: dns(["1.1.1.1"]),
        fetcher: fetcherReturning(imageBody(new Uint8Array([0]))),
      })
    ).rejects.toMatchObject({ code: "url_invalid_scheme" });
  });
});

describe("safeFetchUrl — DNS / private address rejection", () => {
  test("rejects when DNS resolves to a private IP literal in the URL host", async () => {
    await expect(
      safeFetchUrl("http://10.0.0.1/x.png", {
        dnsLookup: dns(["10.0.0.1"]),
        fetcher: fetcherReturning(imageBody(new Uint8Array([0]))),
      })
    ).rejects.toMatchObject({ code: "url_private_address" });
  });

  test("rejects loopback URL", async () => {
    await expect(
      safeFetchUrl("http://127.0.0.1/x.png", {
        dnsLookup: dns(["127.0.0.1"]),
        fetcher: fetcherReturning(imageBody(new Uint8Array([0]))),
      })
    ).rejects.toMatchObject({ code: "url_private_address" });
  });

  test("rejects cloud metadata URL", async () => {
    await expect(
      safeFetchUrl("http://169.254.169.254/latest/meta-data/", {
        dnsLookup: dns(["169.254.169.254"]),
        fetcher: fetcherReturning(imageBody(new Uint8Array([0]))),
      })
    ).rejects.toMatchObject({ code: "url_private_address" });
  });

  test("rejects IPv6 loopback", async () => {
    await expect(
      safeFetchUrl("http://[::1]/x.png", {
        dnsLookup: dns(["::1"]),
        fetcher: fetcherReturning(imageBody(new Uint8Array([0]))),
      })
    ).rejects.toMatchObject({ code: "url_private_address" });
  });

  test("rejects domain whose DNS resolves to a private IP", async () => {
    // The hostname looks public but the DNS resolver — the canonical
    // SSRF-via-friendly-DNS attack — points at internal infra.
    await expect(
      safeFetchUrl("http://attacker.example/x.png", {
        dnsLookup: dns(["192.168.0.5"]),
        fetcher: fetcherReturning(imageBody(new Uint8Array([0]))),
      })
    ).rejects.toMatchObject({ code: "url_private_address" });
  });

  test("rejects when ANY resolved address is private (round-robin attack)", async () => {
    // First A-record is public, second is private — we still refuse so an
    // attacker can't bypass via DNS round-robin.
    await expect(
      safeFetchUrl("http://multi.example/x.png", {
        dnsLookup: dns(["1.1.1.1", "10.0.0.5"]),
        fetcher: fetcherReturning(imageBody(new Uint8Array([0]))),
      })
    ).rejects.toMatchObject({ code: "url_private_address" });
  });

  test("allows public IP (mock DNS returns 1.1.1.1)", async () => {
    const result = await safeFetchUrl("http://example.com/x.png", {
      dnsLookup: dns(["1.1.1.1"]),
      fetcher: fetcherReturning(imageBody(new Uint8Array([0xff, 0xd8, 0xff]))),
    });
    expect(result.contentType).toBe("image/jpeg");
    expect(result.bytes.byteLength).toBe(3);
    expect(result.filename).toBe("x.png");
  });
});

describe("safeFetchUrl — content-type guard", () => {
  test("rejects text/html response", async () => {
    const response = new Response("<html></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    await expect(
      safeFetchUrl("http://example.com/x.png", {
        dnsLookup: dns(["1.1.1.1"]),
        fetcher: fetcherReturning(response),
      })
    ).rejects.toMatchObject({ code: "url_not_image" });
  });

  test("rejects application/json response", async () => {
    const response = new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    await expect(
      safeFetchUrl("http://example.com/x.png", {
        dnsLookup: dns(["1.1.1.1"]),
        fetcher: fetcherReturning(response),
      })
    ).rejects.toMatchObject({ code: "url_not_image" });
  });

  test("accepts image/png with charset suffix", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const response = new Response(bytes, {
      status: 200,
      headers: { "content-type": "image/png; charset=binary" },
    });
    const result = await safeFetchUrl("http://example.com/x.png", {
      dnsLookup: dns(["1.1.1.1"]),
      fetcher: fetcherReturning(response),
    });
    expect(result.contentType).toBe("image/png");
  });
});

describe("safeFetchUrl — size guard", () => {
  test("rejects when content-length advertises > maxBytes", async () => {
    const response = new Response(new Uint8Array([0]), {
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-length": String(100 * 1024 * 1024),
      },
    });
    await expect(
      safeFetchUrl("http://example.com/x.png", {
        maxBytes: 50 * 1024 * 1024,
        dnsLookup: dns(["1.1.1.1"]),
        fetcher: fetcherReturning(response),
      })
    ).rejects.toMatchObject({ code: "url_too_large" });
  });

  test("rejects when streamed body exceeds maxBytes (lying server)", async () => {
    // No content-length header so the precheck doesn't fire; the streamed
    // body is bigger than maxBytes. We use a ReadableStream that yields
    // chunks across the threshold.
    const totalSize = 200; // bytes
    const chunkSize = 64;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let sent = 0;
        while (sent < totalSize) {
          const remaining = totalSize - sent;
          const size = Math.min(chunkSize, remaining);
          controller.enqueue(new Uint8Array(size));
          sent += size;
        }
        controller.close();
      },
    });
    const response = new Response(body, {
      status: 200,
      headers: { "content-type": "image/png" },
    });
    await expect(
      safeFetchUrl("http://example.com/x.png", {
        maxBytes: 100, // less than totalSize; streaming should bail
        dnsLookup: dns(["1.1.1.1"]),
        fetcher: fetcherReturning(response),
      })
    ).rejects.toMatchObject({ code: "url_too_large" });
  });
});

describe("safeFetchUrl — timeout", () => {
  test("rejects with url_timeout when fetch never resolves before timeoutMs", async () => {
    const fetcher: FetcherFn = (_url, init) =>
      new Promise((_resolve, reject) => {
        // Reject when AbortController fires.
        init.signal.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      });

    await expect(
      safeFetchUrl("http://example.com/x.png", {
        timeoutMs: 50,
        dnsLookup: dns(["1.1.1.1"]),
        fetcher,
      })
    ).rejects.toMatchObject({ code: "url_timeout" });
  });
});

describe("safeFetchUrl — happy path filename derivation", () => {
  test("uses the URL's basename when present", async () => {
    const result = await safeFetchUrl("https://example.com/path/photo.jpg?v=2", {
      dnsLookup: dns(["1.1.1.1"]),
      fetcher: fetcherReturning(imageBody(new Uint8Array([0xff]))),
    });
    expect(result.filename).toBe("photo.jpg");
  });

  test("falls back to host-based name when no extension in path", async () => {
    const result = await safeFetchUrl("https://example.com/share/abc123", {
      dnsLookup: dns(["1.1.1.1"]),
      fetcher: fetcherReturning(imageBody(new Uint8Array([0xff]))),
    });
    expect(result.filename).toBe("example.com-image");
  });
});
