export function isSafePublicHttpUrl(value: string, allowQueryTemplate = false): boolean {
  if (value.length > 2_048) return false;
  try {
    const candidate = allowQueryTemplate ? value.replaceAll("{query}", "market") : value;
    const url = new URL(candidate);
    const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
    return (url.protocol === "http:" || url.protocol === "https:")
      && !url.username
      && !url.password
      && !isLocalHostname(hostname);
  } catch {
    return false;
  }
}

/** Resolves a feed link against its feed URL and drops anything non-public or oversized. */
export function safeHeadlineUrl(value: string, base: string): string | null {
  try {
    const url = new URL(value, base);
    if (!isSafePublicHttpUrl(url.toString())) return null;
    url.hash = "";
    const normalized = url.toString();
    return normalized.length <= 2_048 ? normalized : null;
  } catch {
    return null;
  }
}

function isLocalHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) return true;
  if (hostname.includes(":")) return !/^[23][0-9a-f]{0,3}:/i.test(hostname);
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const [first, second, third] = parts.map(Number);
  if (parts.some((part) => Number(part) > 255)) return false;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0 && (third === 0 || third === 2))
    || (first === 192 && second === 88 && third === 99)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113)
    || first >= 224;
}
