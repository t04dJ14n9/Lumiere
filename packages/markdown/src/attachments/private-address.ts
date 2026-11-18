/**
 * Which addresses a download must not reach: this machine and the networks
 * it sits in. A note's image link can name any URL, so a link such as
 * `http://127.0.0.1:8080/admin` or `http://169.254.169.254/latest/meta-data`
 * must not make the editor ask one of them for something and save the answer
 * in the vault.
 *
 * Only the address as written is judged: a public name that resolves to a
 * private address (or changes to one between this check and the request) is
 * not caught, since no DNS answer is available here.
 */

/** Names that are always this machine or a private network (RFC 6761, 6762, 8375). */
const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

/** Whether a request to `url` would reach a private destination, or `url` cannot be read. */
export function isBlockedDestination(url: string): boolean {
  let host: string;
  try {
    // The URL parser turns `127.1`, `0x7f000001` and `2130706433` into `127.0.0.1`.
    host = new URL(url).hostname.toLowerCase().replace(/\.$/u, "");
  } catch {
    return true;
  }
  if (!host) {
    return true;
  }
  if (host.startsWith("[")) {
    const words = ipv6Words(host);
    return !words || isBlockedIpv6(words);
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host)) {
    return isBlockedIpv4(host.split(".").map(Number));
  }
  return (
    host === "localhost" ||
    PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))
  );
}

const addressNumber = (octets: readonly number[]): number =>
  octets.reduce((sum, octet) => sum * 256 + octet, 0);

/** The first and last address of each block that is not the public internet. */
const NON_PUBLIC_IPV4 = [
  "0.0.0.0/8", // this network
  "10.0.0.0/8",
  "100.64.0.0/10", // carrier-grade NAT
  "127.0.0.0/8", // loopback
  "169.254.0.0/16", // link-local, where cloud metadata services are
  "172.16.0.0/12",
  "192.168.0.0/16",
  "198.18.0.0/15", // benchmarking
  "224.0.0.0/3", // multicast and reserved, up to the broadcast address
].map((block) => {
  const [address = "", bits = "0"] = block.split("/");
  const first = addressNumber(address.split(".").map(Number));
  return { first, last: first + 2 ** (32 - Number(bits)) - 1 };
});

function isBlockedIpv4(octets: readonly number[]): boolean {
  const address = addressNumber(octets);
  return NON_PUBLIC_IPV4.some(
    ({ first, last }) => address >= first && address <= last,
  );
}

/** The eight 16-bit words of a bracketed IPv6 host, or undefined when it is not one. */
function ipv6Words(host: string): number[] | undefined {
  const halves = host.slice(1, -1).split("::");
  if (halves.length > 2) {
    return undefined;
  }
  const words = (part: string) =>
    part === ""
      ? []
      : part
          .split(":")
          .map((word) =>
            /^[0-9a-f]{1,4}$/u.test(word) ? parseInt(word, 16) : NaN,
          );
  const head = words(halves[0]!);
  const tail = halves.length === 2 ? words(halves[1]!) : [];
  if ([...head, ...tail].some(Number.isNaN)) {
    return undefined;
  }
  if (halves.length === 1) {
    return head.length === 8 ? head : undefined;
  }
  const gap = 8 - head.length - tail.length;
  return gap >= 1
    ? [...head, ...Array<number>(gap).fill(0), ...tail]
    : undefined;
}

function isBlockedIpv6(words: readonly number[]): boolean {
  const [first = 0, second = 0] = words;
  const isZero = (word: number) => word === 0;
  // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d) and NAT64
  // (64:ff9b::/96) carry an IPv4 address in their last two words.
  const carriesIpv4 =
    (words.slice(0, 5).every(isZero) &&
      (words[5] === 0xffff || words[5] === 0)) ||
    (first === 0x64 && second === 0xff9b && words.slice(2, 6).every(isZero));
  const embedded = [
    words[6]! >> 8,
    words[6]! & 255,
    words[7]! >> 8,
    words[7]! & 255,
  ];
  return (
    // ::1 is carried IPv4 0.0.0.1, which is blocked as "this network".
    (carriesIpv4 && isBlockedIpv4(embedded)) ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00
  );
}
