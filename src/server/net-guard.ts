import "server-only";
// Nabd fetches URLs that users type in. Without a guard, "http://169.254.169.254/"
// or "http://localhost:5432" would let anyone probe the server's own network
// (server-side request forgery). Every connection the checker makes goes through
// a DNS lookup that refuses private, loopback, link-local and reserved addresses,
// so a hostname that resolves to one is blocked too, even after a redirect.
import dns from "node:dns";
import net from "node:net";

export class BlockedAddressError extends Error {
  code = "EBLOCKED";
  constructor(public address: string) {
    super(`Address not allowed: ${address}`);
  }
}

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

const v4ToInt = (ip: string) => ip.split(".").reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;

function v4Blocked(ip: string) {
  const n = v4ToInt(ip);
  return V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (v4ToInt(base) & mask);
  });
}

function expandV6(ip: string): number[] | null {
  const [head, tail] = ip.split("::");
  const parse = (s: string) => (s ? s.split(":") : []);
  let h = parse(head);
  let t = tail !== undefined ? parse(tail) : [];
  // An embedded IPv4 tail ("::ffff:1.2.3.4") becomes two hextets.
  const fixV4 = (arr: string[]) => {
    const last = arr[arr.length - 1];
    if (last && last.includes(".")) {
      const n = v4ToInt(last);
      arr = [...arr.slice(0, -1), ((n >>> 16) & 0xffff).toString(16), (n & 0xffff).toString(16)];
    }
    return arr;
  };
  if (tail !== undefined) t = fixV4(t);
  else h = fixV4(h);
  const missing = 8 - h.length - t.length;
  if (tail === undefined && missing !== 0) return null;
  const all = [...h, ...Array(Math.max(0, missing)).fill("0"), ...t];
  if (all.length !== 8) return null;
  return all.map((x) => parseInt(x || "0", 16));
}

function v6Blocked(ip: string) {
  const h = expandV6(ip.split("%")[0]);
  if (!h) return true;
  const zero = h.every((x) => x === 0);
  if (zero) return true; // ::
  if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return true; // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible: judge the IPv4 part.
  if (h.slice(0, 5).every((x) => x === 0) && (h[5] === 0xffff || h[5] === 0)) {
    const v4 = `${h[6] >> 8}.${h[6] & 0xff}.${h[7] >> 8}.${h[7] & 0xff}`;
    return v4Blocked(v4);
  }
  if ((h[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((h[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((h[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true; // documentation
  if (h[0] === 0x64 && h[1] === 0xff9b) return true; // NAT64
  return false;
}

/** True for addresses on the public internet. */
export function isPublicAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return !v4Blocked(ip);
  if (family === 6) return !v6Blocked(ip);
  return false;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

/** A dns.lookup replacement that refuses non-public answers. */
export function guardedLookup(allowPrivate = false) {
  return (hostname: string, options: dns.LookupOptions, cb: LookupCb) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return cb(err, "");
      const list = addresses as dns.LookupAddress[];
      if (!list.length) return cb(Object.assign(new Error("No addresses"), { code: "ENOTFOUND" }), "");
      if (!allowPrivate) {
        const bad = list.find((a) => !isPublicAddress(a.address));
        if (bad) return cb(new BlockedAddressError(bad.address), "");
      }
      if (options.all) return cb(null, list);
      cb(null, list[0].address, list[0].family);
    });
  };
}

/** Checks a URL before any connection: scheme, credentials, and literal IP hosts. */
export function assertFetchableUrl(raw: string, allowPrivate = false): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Not a valid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http and https URLs can be monitored");
  if (u.username || u.password) throw new Error("URLs with a username or password aren't supported");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivate) {
    if (net.isIP(host) && !isPublicAddress(host)) throw new BlockedAddressError(host);
    if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw new BlockedAddressError(host);
  }
  return u;
}
