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

function base58CheckDecode(input: string): Base58CheckResult | null {
  const decoded = base58Decode(input);
  if (!decoded || decoded.length < 5) return null;

  const body = decoded.subarray(0, decoded.length - 4);
  const checksum = decoded.subarray(decoded.length - 4);
  const computed = sha256(sha256(body));
  for (let i = 0; i < 4; i++) {
    if (computed[i] !== checksum[i]) return null;
  }

  return { version: body[0], payload: body.subarray(1) };
}

/** True if `address` base58check-decodes with a valid checksum, a 20-byte payload, and a version byte in `versions`. */
function isBase58CheckAddress(address: string, versions: number[]): boolean {
  const decoded = base58CheckDecode(address.trim());
  if (!decoded) return false;
  if (decoded.payload.length !== 20) return false;
  return versions.includes(decoded.version);
}

// ---------------------------------------------------------------------
// Bech32 (BIP173) - segwit v0 addresses only (P2WPKH/P2WSH)
// ---------------------------------------------------------------------

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

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

function bech32VerifyChecksum(hrp: string, data: number[]): boolean {
  return bech32Polymod(bech32HrpExpand(hrp).concat(data)) === 1;
}

function bech32Decode(input: string): { hrp: string; data: number[] } | null {
  // Bech32 is case-insensitive but must not mix upper/lower case.
  if (input !== input.toLowerCase() && input !== input.toUpperCase())
    return null;
  const lower = input.toLowerCase();
  const pos = lower.lastIndexOf('1');
  if (pos < 1 || pos + 7 > lower.length || lower.length > 90) return null;

  const hrp = lower.slice(0, pos);
  const dataPart = lower.slice(pos + 1);
  const data: number[] = [];
  for (let i = 0; i < dataPart.length; i++) {
    const idx = BECH32_CHARSET.indexOf(dataPart[i]);
    if (idx === -1) return null;
    data.push(idx);
  }
  if (!bech32VerifyChecksum(hrp, data)) return null;

  return { hrp, data: data.slice(0, data.length - 6) };
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
  if (decoded.data.length < 1) return false;

  const witnessVersion = decoded.data[0];
  if (witnessVersion > 16) return false;
  // Segwit v0 (the only version any of these coins' wallets issue today)
  // uses plain bech32; v1+ (taproot) would need bech32m instead.
  if (witnessVersion !== 0) return false;

  const program = convertBits(decoded.data.slice(1), 5, 8, false);
  if (!program) return false;
  return program.length === 20 || program.length === 32; // P2WPKH or P2WSH.
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

/** Validate Namecoin (NMC): P2PKH (v52) or P2SH (v13). */
export const validateNmcAddress = (address: string): boolean =>
  isBase58CheckAddress(address.trim(), [52, 13]);

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

/**
 * Validate address based on coin type. `coinType` is the chain's
 * `coinEnum` (e.g. from ChainConfig) - a plain string rather than the
 * qapp-core `Coin` enum, since that enum only covers the coins qapp-core
 * itself knows about and doesn't include DASH/NMC/FIRO.
 */
export const validateAddress = (coinType: string, address: string): boolean => {
  if (!address || address.trim() === EMPTY_STRING) {
    return false;
  }

  switch (coinType) {
    case 'BTC':
      return validateBtcAddress(address);
    case 'DOGE':
      return validateDogeAddress(address);
    case 'LTC':
      return validateLtcAddress(address);
    case 'RVN':
      return validateRvnAddress(address);
    case 'DGB':
      return validateDgbAddress(address);
    case 'DASH':
      return validateDashAddress(address);
    case 'NMC':
      return validateNmcAddress(address);
    case 'FIRO':
      return validateFiroAddress(address);
    case 'ARRR':
      return validateArrrAddress(address);
    case 'QORT':
      return validateQortAddress(address);
    default:
      console.warn(
        `Address validation not implemented for coin type: ${coinType}`
      );
      return false;
  }
};
