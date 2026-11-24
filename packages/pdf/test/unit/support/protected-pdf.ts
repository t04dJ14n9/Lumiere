import { createHash } from "node:crypto";

/** RC4, which Node's OpenSSL no longer offers; the encryption of the oldest PDFs. */
function rc4(key: Uint8Array, data: Uint8Array): Buffer {
  const state = Uint8Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + state[i]! + key[i % key.length]!) & 255;
    [state[i], state[j]] = [state[j]!, state[i]!];
  }
  const out = Buffer.alloc(data.length);
  let a = 0;
  let b = 0;
  for (let n = 0; n < data.length; n += 1) {
    a = (a + 1) & 255;
    b = (b + state[a]!) & 255;
    [state[a], state[b]] = [state[b]!, state[a]!];
    out[n] = data[n]! ^ state[(state[a]! + state[b]!) & 255]!;
  }
  return out;
}

/** The permission bit (5) that lets a reader copy text out. */
const COPY_BIT = 1 << 4;
/** Every permission the standard handler can grant (bits 1 and 2 are reserved). */
export const ALL_PERMISSIONS = -4;
export const NO_COPY_PERMISSIONS = ALL_PERMISSIONS & ~COPY_BIT;

/**
 * A page that opens with the user password `password` (default "secret"; an
 * empty one opens without asking), granting `permissions`: a 40-bit RC4
 * standard security handler (V 1, R 2) whose /U entry is computed for it.
 * The page has no strings or streams, so nothing in it needs encrypting.
 */
export function passwordProtectedPdf({
  password = "secret",
  permissions = ALL_PERMISSIONS,
}: { password?: string; permissions?: number } = {}): Buffer {
  const padding = Buffer.from(
    "28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a",
    "hex",
  );
  const owner = Buffer.alloc(32, 7);
  const id = Buffer.from("00112233445566778899aabbccddeeff", "hex");
  const flags = Buffer.alloc(4);
  flags.writeInt32LE(permissions);
  const key = createHash("md5")
    .update(Buffer.concat([Buffer.from(password), padding]).subarray(0, 32))
    .update(owner)
    .update(flags)
    .update(id)
    .digest()
    .subarray(0, 5);
  const user = rc4(key, padding);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] >>",
    `<< /Filter /Standard /V 1 /R 2 /O <${owner.toString("hex")}> /U <${user.toString("hex")}> /P ${permissions} >>`,
  ];
  let out = "%PDF-1.7\n";
  const offsets = objects.map((body, index) => {
    const offset = out.length;
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = out.length;
  out += `xref\n0 5\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size 5 /Root 1 0 R /Encrypt 4 0 R /ID [<${id.toString("hex")}> <${id.toString("hex")}>] >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
