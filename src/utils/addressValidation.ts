import { EMPTY_STRING } from '../common/constants';

/**
 * Per-coin recipient address validation (round 4, item B).
 *
 * Every base58 address below (BTC/DOGE/LTC/RVN/DGB/DASH/NMC/FIRO/QORT) uses
 * the same Bitcoin-style "base58check" envelope: a single version byte, a
 * 20-byte payload, and a 4-byte double-SHA256 checksum. This module decodes
 * that envelope for real - checking the checksum and the decoded version
 * byte - rather than matching a leading-character regex, which accepts
 * plenty of strings that aren't valid addresses at all (wrong checksum, or
 * a version byte belonging to a different coin that just happens to render
 * with a similar-looking leading letter).
 *
 * Segwit (bech32) addresses (BTC bc1..., LTC ltc1..., DGB dgb1...) get the
 * equivalent treatment: a real BIP173 bech32 decode with checksum
 * verification, not a character-class regex.
 *
 * Version bytes for BTC/LTC/DOGE/DGB/RVN/DASH/NMC/FIRO are taken from
 * Core's org.qortium.crosschain.BitcoinyChainSpecs.java (addressHeaders()
 * calls), which is the actual source of truth Core validates sends
 * against. QORT's version bytes (58 = account, 23 = AT contract) are from
 * org.qortium.crypto.Crypto.java (ADDRESS_VERSION / AT_ADDRESS_VERSION),
 * which uses this exact same base58check envelope.
 *
 * No dependency is added for this - base58 decoding only needs BigInt
 * (native), and the checksum only needs SHA-256, so both are implemented
 * here directly rather than pulling in a base58/crypto library for a
 * handful of lines of well-defined, easily-tested math.
 */

// ---------------------------------------------------------------------
// SHA-256 (dependency-free; only used to verify a 4-byte checksum here)
// ---------------------------------------------------------------------

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function sha256(bytes: Uint8Array): Uint8Array {
  let h0 = 0x6a09e667,
    h1 = 0xbb67ae85,
    h2 = 0x3c6ef372,
    h3 = 0xa54ff53a,
    h4 = 0x510e527f,
    h5 = 0x9b05688c,
    h6 = 0x1f83d9ab,
    h7 = 0x5be0cd19;

  const len = bytes.length;
  const withPadding = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  withPadding.set(bytes);
  withPadding[len] = 0x80;
  const bitLen = BigInt(len) * 8n;
  const dv = new DataView(withPadding.buffer);
  dv.setUint32(withPadding.length - 4, Number(bitLen & 0xffffffffn));
  dv.setUint32(withPadding.length - 8, Number((bitLen >> 32n) & 0xffffffffn));

  const w = new Uint32Array(64);
  for (let offset = 0; offset < withPadding.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }

    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4,
      f = h5,
      g = h6,
      h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  const out = new Uint8Array(32);
  const outDv = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((v, i) =>
    outDv.setUint32(i * 4, v >>> 0)
  );
  return out;
}

// ---------------------------------------------------------------------
// Base58 / base58check
// ---------------------------------------------------------------------

const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_MAP: Record<string, number> = {};
for (let i = 0; i < BASE58_ALPHABET.length; i++) {
  BASE58_MAP[BASE58_ALPHABET[i]] = i;
}

function base58Decode(input: string): Uint8Array | null {
  if (input.length === 0) return null;

  let num = 0n;
  for (let i = 0; i < input.length; i++) {
    const digit = BASE58_MAP[input[i]];
    if (digit === undefined) return null;
    num = num * 58n + BigInt(digit);
  }

  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num & 0xffn));
    num >>= 8n;
  }

  // Each leading '1' character encodes one leading zero byte.
  for (let i = 0; i < input.length && input[i] === '1'; i++) {
    bytes.unshift(0);
  }

  return new Uint8Array(bytes);
}

interface Base58CheckResult {
  version: number;
  payload: Uint8Array;
}

/**
 * Round 6: like `base58CheckDecode` below, but distinguishes WHY a
 * string didn't decode - a real base58check envelope whose checksum
 * doesn't match ('bad-checksum', likely a typo) versus something that
 * isn't shaped like base58check at all ('invalid') - so
 * classifyRecipient() can tell "right shape, checksum failed" apart from
 * "unrecognised format" (round 6, item B).
 */
type Base58CheckOutcome =
  | { kind: 'ok'; version: number; payload: Uint8Array }
  | { kind: 'bad-checksum' }
  | { kind: 'invalid' };

function base58CheckDecodeDetailed(input: string): Base58CheckOutcome {
  const decoded = base58Decode(input);
  if (!decoded || decoded.length < 5) return { kind: 'invalid' };

  const body = decoded.subarray(0, decoded.length - 4);
  const checksum = decoded.subarray(decoded.length - 4);
  const computed = sha256(sha256(body));
  for (let i = 0; i < 4; i++) {
    if (computed[i] !== checksum[i]) return { kind: 'bad-checksum' };
  }

  return { kind: 'ok', version: body[0], payload: body.subarray(1) };
}

function base58CheckDecode(input: string): Base58CheckResult | null {
  const outcome = base58CheckDecodeDetailed(input);
  return outcome.kind === 'ok'
    ? { version: outcome.version, payload: outcome.payload }
    : null;
}

/** True if `address` base58check-decodes with a valid checksum, a 20-byte payload, and a version byte in `versions`. */
function isBase58CheckAddress(address: string, versions: number[]): boolean {
  const decoded = base58CheckDecode(address.trim());
  if (!decoded) return false;
  if (decoded.payload.length !== 20) return false;
  return versions.includes(decoded.version);
}

// ---------------------------------------------------------------------
// Bech32 (BIP173) / Bech32m (BIP350) - segwit v0 addresses (P2WPKH/P2WSH)
// plus recognition (not acceptance) of segwit v1+ (taproot) and other
// bech32m-family formats used for the round 6 format-specific messaging
// below (classifyRecipient).
// ---------------------------------------------------------------------

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
// BIP350 bech32m constant - the polymod target for a bech32m-encoded
// string, in place of bech32's target of 1.
const BECH32M_CONST = 0x2bc830a3;

type Bech32Variant = 'bech32' | 'bech32m';

function bech32Polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((b >> i) & 1) chk ^= BECH32_GEN[i];
    }
  }
  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

// BIP173 caps a bech32 string at 90 characters, which every segwit
// address (and taproot/Spark, whose 32-byte programs/payloads still fit
// comfortably under it) respects. Litecoin's MWEB addresses (LIP-0002)
// don't: encoding two 33-byte pubkeys pushes them well past 90
// characters, so MWEB detection below decodes with a relaxed cap instead
// of the standard one - real MWEB addresses would otherwise be rejected
// as structurally invalid before ever reaching the HRP/variant check.
const BECH32_MAX_LENGTH_STANDARD = 90;
const BECH32_MAX_LENGTH_RELAXED = 1000;

/**
 * Structural-only bech32 parse: valid charset, HRP, and separator
 * position, but no checksum check yet. `data` still includes the
 * trailing 6 checksum symbols - callers that only want the payload use
 * `bech32Decode` below instead.
 */
function bech32DecodeRaw(
  input: string,
  maxLength: number = BECH32_MAX_LENGTH_STANDARD
): { hrp: string; data: number[] } | null {
  // Bech32(m) is case-insensitive but must not mix upper/lower case.
  if (input !== input.toLowerCase() && input !== input.toUpperCase())
    return null;
  const lower = input.toLowerCase();
  const pos = lower.lastIndexOf('1');
  if (pos < 1 || pos + 7 > lower.length || lower.length > maxLength)
    return null;

  const hrp = lower.slice(0, pos);
  const dataPart = lower.slice(pos + 1);
  const data: number[] = [];
  for (let i = 0; i < dataPart.length; i++) {
    const idx = BECH32_CHARSET.indexOf(dataPart[i]);
    if (idx === -1) return null;
    data.push(idx);
  }
  return { hrp, data };
}

/** Which of the two checksum constants (if either) `hrp`+`data` (including its trailing checksum symbols) satisfies. */
function bech32ChecksumVariant(
  hrp: string,
  data: number[]
): Bech32Variant | null {
  const polymod = bech32Polymod(bech32HrpExpand(hrp).concat(data));
  if (polymod === 1) return 'bech32';
  if (polymod === BECH32M_CONST) return 'bech32m';
  return null;
}

/**
 * Full bech32/bech32m decode: structure, charset, AND checksum. Returns
 * which variant matched, so callers can tell a genuine bech32m string
 * (e.g. a taproot or Spark address) apart from a bech32 string that
 * merely resembles one, or from a checksum failure (round 6, item B).
 */
function bech32Decode(
  input: string,
  maxLength: number = BECH32_MAX_LENGTH_STANDARD
): { hrp: string; data: number[]; variant: Bech32Variant } | null {
  const raw = bech32DecodeRaw(input, maxLength);
  if (!raw) return null;
  const variant = bech32ChecksumVariant(raw.hrp, raw.data);
  if (!variant) return null;
  return {
    hrp: raw.hrp,
    data: raw.data.slice(0, raw.data.length - 6),
    variant,
  };
}

function convertBits(
  data: number[],
  fromBits: number,
  toBits: number,
  pad: boolean
): number[] | null {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << toBits) - 1;
  for (const value of data) {
    if (value < 0 || value >> fromBits !== 0) return null;
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) ret.push((acc << (toBits - bits)) & maxv);
  } else if (bits >= fromBits || (acc << (toBits - bits)) & maxv) {
    return null;
  }
  return ret;
}

/**
 * True if `address` is a valid bech32-checksummed segwit v0 address for
 * `expectedHrp` (bc/ltc/dgb) - either a 20-byte (P2WPKH) or 32-byte
 * (P2WSH) witness program.
 *
 * Both lengths are accepted deliberately (round 4 review item 1, then
 * corrected): Core's org.qortium.crosschain.Bitcoiny.isValidAddress()
 * (which only allows P2PKH/P2SH/P2WPKH) is enforced only by Core's legacy
 * xprv `/crosschain/.../send` REST endpoint
 * (CrossChainBitcoinyResource.java) - Home 2, which is what this wallet
 * actually sends through, builds and signs foreign transactions itself
 * and its transaction builder explicitly supports P2WSH outputs
 * (qortium-home electron/foreign-wallet-transaction.ts - `supportedSegwit`
 * includes 'P2WSH', with its own witness-script handling), and Core's own
 * BitcoinyScript builds a witness-v0 script for P2WSH too. So a P2WSH
 * recipient is a real, sendable address for this wallet's actual send
 * path, not one this form should reject.
 */
function isSegwitAddress(address: string, expectedHrp: string): boolean {
  const decoded = bech32Decode(address.trim());
  if (!decoded || decoded.hrp !== expectedHrp) return false;
  // Segwit v0 (the only version any of these coins' wallets issue today)
  // MUST use plain bech32 (BIP350); v1+ (taproot) MUST use bech32m. A
  // witness-v0-shaped payload encoded with the wrong variant is not a
  // valid address either way, so this alone would already fail below -
  // but checking it explicitly here keeps this function's job to exactly
  // "segwit v0", now that bech32Decode also recognises bech32m strings
  // (round 6, item B) for the taproot/MWEB/Spark checks elsewhere.
  if (decoded.variant !== 'bech32') return false;
  if (decoded.data.length < 1) return false;

  const witnessVersion = decoded.data[0];
  if (witnessVersion > 16) return false;
  if (witnessVersion !== 0) return false;

  const program = convertBits(decoded.data.slice(1), 5, 8, false);
  if (!program) return false;
  return program.length === 20 || program.length === 32; // P2WPKH or P2WSH.
}

// ---------------------------------------------------------------------
// Unsupported-format recognisers (round 6, item B)
//
// Owner decision 2026-09-22: no Taproot support yet, but the send form
// must say WHICH unsupported format was pasted instead of a generic
// "not a valid <TICKER> address". These functions recognise (but never
// validate as sendable) the specific formats this wallet can't send to
// yet, so classifyRecipient() below can return a precise reason.
// ---------------------------------------------------------------------

/**
 * True if `address` is a segwit v1 (taproot, BIP341) bech32m address for
 * `expectedHrp` (bc/ltc/dgb) - a 32-byte witness program, correctly
 * bech32m-checksummed. Recognised so the send form can say "Taproot
 * isn't supported yet" instead of a generic invalid-address error; still
 * never a valid send target (owner decision 2026-09-22).
 */
function isTaprootAddress(address: string, expectedHrp: string): boolean {
  const decoded = bech32Decode(address.trim());
  if (!decoded || decoded.hrp !== expectedHrp || decoded.variant !== 'bech32m')
    return false;
  if (decoded.data.length < 1 || decoded.data[0] !== 1) return false;
  const program = convertBits(decoded.data.slice(1), 5, 8, false);
  return !!program && program.length === 32;
}

/**
 * True if `address` is shaped like a witness v1 program for `expectedHrp`
 * but was encoded with plain bech32 instead of the bech32m BIP350
 * requires for v1+ - a recognisable, specific "wrong checksum variant"
 * case (round 6: "witness v1 with bech32 (wrong variant) -> BAD_CHECKSUM").
 */
function isWrongVariantWitnessV1(
  address: string,
  expectedHrp: string
): boolean {
  const decoded = bech32Decode(address.trim());
  if (!decoded || decoded.hrp !== expectedHrp || decoded.variant !== 'bech32')
    return false;
  return decoded.data.length >= 1 && decoded.data[0] === 1;
}

/**
 * True if `address` is a Litecoin MWEB (LIP-0002/0004) address: bech32m
 * with HRP `ltcmweb` - e.g. `ltcmweb1...`. MWEB addresses aren't segwit
 * witness programs (no witness-version discriminator byte), so this only
 * checks HRP + bech32m, not a program length.
 */
function isMwebAddress(address: string): boolean {
  const decoded = bech32Decode(address.trim(), BECH32_MAX_LENGTH_RELAXED);
  return (
    !!decoded && decoded.hrp === 'ltcmweb' && decoded.variant === 'bech32m'
  );
}

/**
 * True if `address` is a Firo Spark address: bech32m with HRP `sm`
 * (mainnet) - e.g. `sm1...`. Verified against firoorg/firo source
 * (2026-09-21, master branch): `src/libspark/util.h` defines
 * `ADDRESS_ENCODING_PREFIX = 's'` and `ADDRESS_NETWORK_MAINNET = 'm'`
 * (testnet is `'t'`, i.e. `st1...` - that's what Firo's own wiki example
 * uses), and `src/libspark/keys.cpp`'s `Address::encode()`/`decode()`
 * exclusively use `bech32::Encoding::BECH32M`, rejecting plain bech32.
 * So this HRP+variant check is a real, source-verified match, not a
 * guessed prefix.
 *
 * NOTE: Firo's older Lelantus/Sigma privacy mints (`LELANTUS_UNSUPPORTED`
 * in `RecipientInvalidReason`) have no equivalent user-facing "address"
 * format to recognise here - a mint is built by the sender's own wallet
 * from an internal commitment/script (`OP_LELANTUSMINT`/`OP_SIGMAMINT`),
 * never published as a string someone else pastes into a recipient
 * field, unlike Spark's dedicated `spark::Address` type. `LELANTUS_
 * UNSUPPORTED` is kept in the reason union per spec (and shares Spark's
 * message below) for forward-compatibility, but no input currently
 * classifies as it.
 */
function isSparkAddress(address: string): boolean {
  const decoded = bech32Decode(address.trim());
  return !!decoded && decoded.hrp === 'sm' && decoded.variant === 'bech32m';
}

// ---------------------------------------------------------------------
// CashAddr (Bitcoin Cash) detection
//
// Real 40-bit checksum verification (not a leading-character regex) so
// an unrelated string can't be misclassified as BCH. Spec: CashAddr
// (cashaddr.org / bitcoincashorg/bitcoincash.org) - same 5-bit charset
// as BIP173 bech32, but its own checksum polynomial/constant (not
// bech32's or bech32m's) and no "1" separator: prefix and payload are
// joined by ":", or the prefix is omitted and defaults to "bitcoincash"
// for mainnet.
// ---------------------------------------------------------------------

const CASHADDR_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const CASHADDR_GENERATOR = [
  0x98f2bc8e61n,
  0x79b76d99e2n,
  0xf33e5fb3c4n,
  0xae2eabe2a8n,
  0x1e4f43e470n,
];
const CASHADDR_PREFIXES = [
  'bitcoincash',
  'bchtest',
  'bchreg',
  'simpleledger',
  'slptest',
  'slpreg',
];

function cashAddrPolymod(values: number[]): bigint {
  let c = 1n;
  for (const d of values) {
    const c0 = Number(c >> 35n) & 0xff;
    c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(d);
    if (c0 & 0x01) c ^= CASHADDR_GENERATOR[0];
    if (c0 & 0x02) c ^= CASHADDR_GENERATOR[1];
    if (c0 & 0x04) c ^= CASHADDR_GENERATOR[2];
    if (c0 & 0x08) c ^= CASHADDR_GENERATOR[3];
    if (c0 & 0x10) c ^= CASHADDR_GENERATOR[4];
  }
  return c ^ 1n;
}

function cashAddrPrefixExpand(prefix: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < prefix.length; i++) out.push(prefix.charCodeAt(i) & 0x1f);
  out.push(0);
  return out;
}

/**
 * True if `address` is a real, checksum-valid CashAddr (Bitcoin Cash)
 * address - with or without its `bitcoincash:`/`bchtest:`/... prefix.
 * The minimum/maximum payload length (in 5-bit symbols, checksum
 * included) brackets the sizes CashAddr defines for its smallest
 * (20-byte hash, version byte + hash = 21 bytes -> 34 symbols + 8
 * checksum = 42) and largest (64-byte hash -> 104 + 8 = 112) address
 * types.
 */
function isCashAddrAddress(address: string): boolean {
  const trimmed = address.trim();
  if (trimmed !== trimmed.toLowerCase() && trimmed !== trimmed.toUpperCase())
    return false;
  const lower = trimmed.toLowerCase();

  const colonIndex = lower.indexOf(':');
  let prefix: string;
  let payload: string;
  if (colonIndex === -1) {
    prefix = 'bitcoincash';
    payload = lower;
  } else {
    prefix = lower.slice(0, colonIndex);
    payload = lower.slice(colonIndex + 1);
    if (!CASHADDR_PREFIXES.includes(prefix)) return false;
  }

  if (payload.length < 42 || payload.length > 112) return false;

  const data: number[] = [];
  for (let i = 0; i < payload.length; i++) {
    const idx = CASHADDR_CHARSET.indexOf(payload[i]);
    if (idx === -1) return false;
    data.push(idx);
  }

  return cashAddrPolymod(cashAddrPrefixExpand(prefix).concat(data)) === 0n;
}

// ---------------------------------------------------------------------
// Per-coin validators
// ---------------------------------------------------------------------

/** Validate Bitcoin (BTC): P2PKH (v0), P2SH (v5), or bech32 (bc1...). */
export const validateBtcAddress = (address: string): boolean => {
  const trimmed = address.trim();
  return (
    isSegwitAddress(trimmed, 'bc') || isBase58CheckAddress(trimmed, [0, 5])
  );
};

/**
 * Validate Dogecoin (DOGE): P2PKH (v30) or P2SH (v22).
 *
 * NOTE (round 4 review item 3): Core declares DigiByte's P2PKH version as
 * 30 too (see validateDgbAddress below and BitcoinyChainSpecs.java's
 * dogecoinParams()/digibyteParams() addressHeaders() calls) - this is an
 * inherent collision in the address format itself, not a bug here: a
 * genuinely valid, correctly-checksummed "D..." address cannot be told
 * apart as Dogecoin vs. DigiByte by decoding alone, since both networks
 * use the exact same version byte for that address type. Every such
 * address passes both validateDogeAddress() and validateDgbAddress().
 * Do not try to "fix" this with heuristics - the send form instead shows
 * a soft, non-blocking reminder for these two coins
 * (send_dialog.doge_dgb_look_alike in CoinDetail.tsx).
 */
export const validateDogeAddress = (address: string): boolean =>
  isBase58CheckAddress(address.trim(), [30, 22]);

/**
 * Validate Litecoin (LTC): P2PKH (v48), P2SH, or bech32 (ltc1...).
 * P2SH is accepted in both the legacy ('3...', v5, shared with Bitcoin) and
 * current ('M...', v50) forms - Core's own normalizeLitecoinAddress()
 * converts between them, so both are valid send targets.
 */
export const validateLtcAddress = (address: string): boolean => {
  const trimmed = address.trim();
  return (
    isSegwitAddress(trimmed, 'ltc') ||
    isBase58CheckAddress(trimmed, [48, 5, 50])
  );
};

/** Validate Ravencoin (RVN): P2PKH (v60) or P2SH (v122). */
export const validateRvnAddress = (address: string): boolean =>
  isBase58CheckAddress(address.trim(), [60, 122]);

/**
 * Validate DigiByte (DGB): P2PKH (v30), P2SH (v63), or bech32 (dgb1...).
 * See the NOTE on validateDogeAddress() above - P2PKH version 30 is
 * shared with Dogecoin, so a valid DOGE "D..." address is also a valid
 * DGB address by this decode, and vice versa. Inherent to the format.
 */
export const validateDgbAddress = (address: string): boolean => {
  const trimmed = address.trim();
  return (
    isSegwitAddress(trimmed, 'dgb') || isBase58CheckAddress(trimmed, [30, 63])
  );
};

/** Validate Dash (DASH): P2PKH (v76, 'X...') or P2SH (v16, '7...'). */
export const validateDashAddress = (address: string): boolean =>
  isBase58CheckAddress(address.trim(), [76, 16]);

/**
 * Validate Namecoin (NMC): P2PKH (v52), P2SH (v13), or bech32 (nc1...).
 *
 * Round 6 fix: this validator only accepted base58 while Core
 * (BitcoinyChainSpecs.java's namecoinParams() - `.segwitAddressHrp("nc")`)
 * and Home both accept segwit v0 `nc1q...` too - a real, sendable NMC
 * address this form was wrongly rejecting.
 */
export const validateNmcAddress = (address: string): boolean => {
  const trimmed = address.trim();
  return (
    isSegwitAddress(trimmed, 'nc') || isBase58CheckAddress(trimmed, [52, 13])
  );
};

/** Validate Firo (FIRO): P2PKH (v82) or P2SH (v7). */
export const validateFiroAddress = (address: string): boolean =>
  isBase58CheckAddress(address.trim(), [82, 7]);

/**
 * Validate Pirate Chain (ARRR) shielded (Sapling, zs1...) addresses.
 * Sapling addresses use a different bech32-family encoding (F4Jumble +
 * a non-standard checksum) that isn't worth a dependency-free
 * reimplementation here - format-only, as before.
 */
export const validateArrrAddress = (address: string): boolean => {
  const pattern = /^(zs1[a-zA-Z0-9]{75})$/;
  return pattern.test(address.trim());
};

/**
 * Validate Qortal (QORT) addresses: the same base58check envelope as the
 * coins above, version 58 for a normal account address or 23 for an AT
 * (smart contract) address - see Crypto.java's ADDRESS_VERSION /
 * AT_ADDRESS_VERSION and toAddress()/isValidTypedAddress().
 */
export const validateQortAddress = (address: string): boolean =>
  isBase58CheckAddress(address.trim(), [58, 23]);

// ---------------------------------------------------------------------
// classifyRecipient (round 6, item B)
// ---------------------------------------------------------------------

/**
 * Why a recipient address was rejected, when it's more specific than
 * "doesn't look like a `<TICKER>` address at all":
 * - `TAPROOT_UNSUPPORTED` / `MWEB_UNSUPPORTED` / `SPARK_UNSUPPORTED` /
 *   `LELANTUS_UNSUPPORTED`: a real address in a format this wallet
 *   doesn't support sending to yet (owner decision 2026-09-22 - no
 *   Taproot support yet either).
 * - `CASHADDR_WRONG_COIN`: a Bitcoin Cash CashAddr address - a distinct
 *   coin this wallet never supports, not a malformed one of ours.
 * - `WRONG_COIN`: a genuinely valid address, but for a different
 *   supported coin.
 * - `BAD_CHECKSUM`: right shape for this coin's address format, but the
 *   checksum doesn't match (most often a typo).
 * - `UNKNOWN_FORMAT`: doesn't match any format this module recognises.
 */
export type RecipientInvalidReason =
  | 'TAPROOT_UNSUPPORTED'
  | 'MWEB_UNSUPPORTED'
  | 'SPARK_UNSUPPORTED'
  | 'LELANTUS_UNSUPPORTED'
  | 'CASHADDR_WRONG_COIN'
  | 'WRONG_COIN'
  | 'BAD_CHECKSUM'
  | 'UNKNOWN_FORMAT';

export interface RecipientClassification {
  valid: boolean;
  /** Only set when `valid` is false and a more specific reason than "invalid" is known. */
  reason?: RecipientInvalidReason;
  /** Only set for `WRONG_COIN`: the ticker of the other supported coin this address is actually valid for. */
  otherCoin?: string;
}

interface BitcoinyCoinSpec {
  ticker: string;
  versions: number[];
  segwitHrp?: string;
  taproot?: boolean;
  mweb?: boolean;
}

const BTC_SPEC: BitcoinyCoinSpec = {
  ticker: 'BTC',
  versions: [0, 5],
  segwitHrp: 'bc',
  taproot: true,
};
const LTC_SPEC: BitcoinyCoinSpec = {
  ticker: 'LTC',
  versions: [48, 5, 50],
  segwitHrp: 'ltc',
  taproot: true,
  mweb: true,
};
const DOGE_SPEC: BitcoinyCoinSpec = { ticker: 'DOGE', versions: [30, 22] };
const RVN_SPEC: BitcoinyCoinSpec = { ticker: 'RVN', versions: [60, 122] };
const DGB_SPEC: BitcoinyCoinSpec = {
  ticker: 'DGB',
  versions: [30, 63],
  segwitHrp: 'dgb',
  taproot: true,
};
const DASH_SPEC: BitcoinyCoinSpec = { ticker: 'DASH', versions: [76, 16] };
const NMC_SPEC: BitcoinyCoinSpec = {
  ticker: 'NMC',
  versions: [52, 13],
  segwitHrp: 'nc',
};
const FIRO_SPEC: BitcoinyCoinSpec = { ticker: 'FIRO', versions: [82, 7] };
const QORT_SPEC: BitcoinyCoinSpec = { ticker: 'QORT', versions: [58, 23] };

/** Every other supported coin's real validator, used for `WRONG_COIN` detection - run every coin's validator, keep the DOGE/DGB base58 collision as a mutual "both valid" case (not WRONG_COIN for either). */
const OTHER_COIN_VALIDATORS: Array<{
  ticker: string;
  validate: (address: string) => boolean;
}> = [
  { ticker: 'BTC', validate: validateBtcAddress },
  { ticker: 'LTC', validate: validateLtcAddress },
  { ticker: 'DOGE', validate: validateDogeAddress },
  { ticker: 'RVN', validate: validateRvnAddress },
  { ticker: 'DGB', validate: validateDgbAddress },
  { ticker: 'DASH', validate: validateDashAddress },
  { ticker: 'NMC', validate: validateNmcAddress },
  { ticker: 'FIRO', validate: validateFiroAddress },
  { ticker: 'QORT', validate: validateQortAddress },
  { ticker: 'ARRR', validate: validateArrrAddress },
];

function findWrongCoinMatch(
  trimmed: string,
  selfTicker: string
): string | undefined {
  return OTHER_COIN_VALIDATORS.find(
    (other) => other.ticker !== selfTicker && other.validate(trimmed)
  )?.ticker;
}

/** Shared "right shape, wrong checksum vs. unrecognised entirely" fallback once every specific format/wrong-coin check above has already missed. */
function classifyBase58Fallback(trimmed: string): RecipientClassification {
  const detail = base58CheckDecodeDetailed(trimmed);
  if (detail.kind === 'bad-checksum') {
    return { valid: false, reason: 'BAD_CHECKSUM' };
  }
  // detail.kind === 'ok' here means a valid base58check envelope whose
  // version byte matched no known coin at all (not even one caught by
  // findWrongCoinMatch above) - genuinely unrecognised, not a checksum
  // problem.
  return { valid: false, reason: 'UNKNOWN_FORMAT' };
}

function classifyBitcoinyCoin(
  spec: BitcoinyCoinSpec,
  trimmed: string
): RecipientClassification {
  if (
    (spec.segwitHrp && isSegwitAddress(trimmed, spec.segwitHrp)) ||
    isBase58CheckAddress(trimmed, spec.versions)
  ) {
    return { valid: true };
  }

  if (spec.taproot && spec.segwitHrp) {
    if (isTaprootAddress(trimmed, spec.segwitHrp)) {
      return { valid: false, reason: 'TAPROOT_UNSUPPORTED' };
    }
    if (isWrongVariantWitnessV1(trimmed, spec.segwitHrp)) {
      return { valid: false, reason: 'BAD_CHECKSUM' };
    }
  }
  if (spec.mweb && isMwebAddress(trimmed)) {
    return { valid: false, reason: 'MWEB_UNSUPPORTED' };
  }
  if (isCashAddrAddress(trimmed)) {
    return { valid: false, reason: 'CASHADDR_WRONG_COIN' };
  }

  const otherCoin = findWrongCoinMatch(trimmed, spec.ticker);
  if (otherCoin) {
    return { valid: false, reason: 'WRONG_COIN', otherCoin };
  }

  // Right HRP, but the checksum matched neither bech32 nor bech32m.
  if (spec.segwitHrp) {
    const raw = bech32DecodeRaw(trimmed);
    if (raw && raw.hrp === spec.segwitHrp) {
      return { valid: false, reason: 'BAD_CHECKSUM' };
    }
  }
  if (spec.mweb) {
    const raw = bech32DecodeRaw(trimmed, BECH32_MAX_LENGTH_RELAXED);
    if (raw && raw.hrp === 'ltcmweb') {
      return { valid: false, reason: 'BAD_CHECKSUM' };
    }
  }

  return classifyBase58Fallback(trimmed);
}

function classifyFiro(trimmed: string): RecipientClassification {
  if (isBase58CheckAddress(trimmed, FIRO_SPEC.versions)) {
    return { valid: true };
  }
  if (isSparkAddress(trimmed)) {
    return { valid: false, reason: 'SPARK_UNSUPPORTED' };
  }
  // Spark-shaped (HRP "sm") but the checksum matched neither bech32 nor
  // bech32m - still recognisably a (mistyped) Spark address.
  const raw = bech32DecodeRaw(trimmed);
  if (raw && raw.hrp === 'sm') {
    return { valid: false, reason: 'BAD_CHECKSUM' };
  }
  if (isCashAddrAddress(trimmed)) {
    return { valid: false, reason: 'CASHADDR_WRONG_COIN' };
  }
  const otherCoin = findWrongCoinMatch(trimmed, 'FIRO');
  if (otherCoin) {
    return { valid: false, reason: 'WRONG_COIN', otherCoin };
  }
  return classifyBase58Fallback(trimmed);
}

function classifyArrr(trimmed: string): RecipientClassification {
  if (validateArrrAddress(trimmed)) {
    return { valid: true };
  }
  if (isCashAddrAddress(trimmed)) {
    return { valid: false, reason: 'CASHADDR_WRONG_COIN' };
  }
  const otherCoin = findWrongCoinMatch(trimmed, 'ARRR');
  if (otherCoin) {
    return { valid: false, reason: 'WRONG_COIN', otherCoin };
  }
  return { valid: false, reason: 'UNKNOWN_FORMAT' };
}

/**
 * Classify a recipient address for `coin` - not just whether it's valid,
 * but (when it's not) WHY, so the send form can tell the user which
 * unsupported format they pasted instead of a generic "not a valid
 * `<TICKER>` address" (round 6, item B / owner decision 2026-09-22).
 * `validateAddress` below is a thin wrapper over this for callers that
 * only need the boolean.
 */
export const classifyRecipient = (
  coin: string,
  address: string
): RecipientClassification => {
  if (!address || address.trim() === EMPTY_STRING) {
    return { valid: false };
  }
  const trimmed = address.trim();

  switch (coin) {
    case 'BTC':
      return classifyBitcoinyCoin(BTC_SPEC, trimmed);
    case 'LTC':
      return classifyBitcoinyCoin(LTC_SPEC, trimmed);
    case 'DGB':
      return classifyBitcoinyCoin(DGB_SPEC, trimmed);
    case 'NMC':
      return classifyBitcoinyCoin(NMC_SPEC, trimmed);
    case 'DOGE':
      return classifyBitcoinyCoin(DOGE_SPEC, trimmed);
    case 'RVN':
      return classifyBitcoinyCoin(RVN_SPEC, trimmed);
    case 'DASH':
      return classifyBitcoinyCoin(DASH_SPEC, trimmed);
    case 'QORT':
      return classifyBitcoinyCoin(QORT_SPEC, trimmed);
    case 'FIRO':
      return classifyFiro(trimmed);
    case 'ARRR':
      return classifyArrr(trimmed);
    default:
      console.warn(`Address validation not implemented for coin type: ${coin}`);
      return { valid: false };
  }
};

/**
 * Validate address based on coin type. `coinType` is the chain's
 * `coinEnum` (e.g. from ChainConfig) - a plain string rather than the
 * qapp-core `Coin` enum, since that enum only covers the coins qapp-core
 * itself knows about and doesn't include DASH/NMC/FIRO.
 *
 * Thin boolean wrapper over `classifyRecipient` (round 6) - existing
 * callers/tests that only need "is this valid" keep working unchanged.
 */
export const validateAddress = (coinType: string, address: string): boolean =>
  classifyRecipient(coinType, address).valid;
