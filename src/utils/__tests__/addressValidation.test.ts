import { describe, it, expect } from 'vitest';
import {
  validateAddress,
  validateArrrAddress,
  validateBtcAddress,
  validateDashAddress,
  validateDgbAddress,
  validateDogeAddress,
  validateFiroAddress,
  validateLtcAddress,
  validateNmcAddress,
  validateQortAddress,
  validateRvnAddress,
} from '../addressValidation';

// Round 4, item B: these validators moved from a leading-character regex to
// a real base58check decode (checksum + version byte) for every base58
// coin, plus a real bech32 (BIP173) decode + checksum for the segwit
// chains. Every fixture below is a genuinely checksummed address (computed
// with the same version bytes Core's BitcoinyChainSpecs.java declares) -
// not a hand-typed string that merely matches a character-class pattern,
// since that's exactly what the old regex-only validators would have
// wrongly accepted.

describe('addressValidation', () => {
  describe('validateBtcAddress', () => {
    it('accepts a valid P2PKH (v0) address', () => {
      expect(validateBtcAddress('16L5yRNPTuciSgXGHqYwn9N6NeoKqopAu')).toBe(
        true
      );
    });
    it('accepts a valid P2SH (v5) address', () => {
      expect(validateBtcAddress('31nM1WuowNDzocNxPPW9NQWJEtwWpjfcLj')).toBe(
        true
      );
    });
    it('accepts a valid bech32 address', () => {
      expect(
        validateBtcAddress('bc1qqypqxpq9qcrsszg2pvxq6rs0zqg3yyc5fcj4z3')
      ).toBe(true);
    });
    it('accepts leading/trailing whitespace', () => {
      expect(validateBtcAddress('  16L5yRNPTuciSgXGHqYwn9N6NeoKqopAu  ')).toBe(
        true
      );
    });
    it('rejects a wrong-checksum address', () => {
      expect(validateBtcAddress('16L5yRNPTuciSgXGHqYwn9N6NeoKqopAv')).toBe(
        false
      );
    });
    it('rejects a wrong-checksum bech32 address', () => {
      expect(
        validateBtcAddress('bc1qqypqxpq9qcrsszg2pvxq6rs0zqg3yyc5fcj4z4')
      ).toBe(false);
    });
    it('rejects an address with a valid checksum but the wrong version byte', () => {
      // Litecoin P2PKH (v48) - correctly checksummed, just not a Bitcoin version.
      expect(validateBtcAddress('LKKHMBjCU89fyFNgSRprDoD8Jb25N8uWvd')).toBe(
        false
      );
    });
    it("rejects another coin's bech32 address", () => {
      expect(
        validateBtcAddress('ltc1qqypqxpq9qcrsszg2pvxq6rs0zqg3yyc5dyg36p')
      ).toBe(false);
    });
    it('accepts a valid P2WSH (32-byte program) bech32 address', () => {
      // Home 2 (this wallet's actual send path) builds/signs foreign
      // transactions itself and supports P2WSH outputs - Core's
      // P2PKH/P2SH/P2WPKH-only gate is enforced only by a legacy REST
      // endpoint Home 2 never uses. See the NOTE on isSegwitAddress() in
      // addressValidation.ts (round 4 review item 1, corrected).
      expect(
        validateBtcAddress(
          'bc1qqypqxpq9qcrsszg2pvxq6rs0zqg3yyc5z5tpwxqergd3c8g7rusqyp0mu0'
        )
      ).toBe(true);
    });
    it('rejects empty/garbage input', () => {
      expect(validateBtcAddress('')).toBe(false);
      expect(validateBtcAddress('notanaddress')).toBe(false);
    });
  });

  describe('validateLtcAddress', () => {
    it('accepts a valid P2PKH (v48, L...) address', () => {
      expect(validateLtcAddress('LKKHMBjCU89fyFNgSRprDoD8Jb25N8uWvd')).toBe(
        true
      );
    });
    it('accepts a valid legacy P2SH (v5, 3...) address', () => {
      expect(validateLtcAddress('33XAHRifHvZoWj3G4XQhrGhUwbvr2j7ppB')).toBe(
        true
      );
    });
    it('accepts a valid current P2SH (v50, M...) address', () => {
      expect(validateLtcAddress('M7zVKQKmtV5Rc7erVGVVC3khZbXxsS5HEX')).toBe(
        true
      );
    });
    it('accepts a valid bech32 address', () => {
      expect(
        validateLtcAddress('ltc1qqypqxpq9qcrsszg2pvxq6rs0zqg3yyc5dyg36p')
      ).toBe(true);
    });
    it('rejects a wrong-checksum address', () => {
      expect(validateLtcAddress('LKKHMBjCU89fyFNgSRprDoD8Jb25N8uWve')).toBe(
        false
      );
    });
    it("rejects another coin's address (Bitcoin P2PKH)", () => {
      expect(validateLtcAddress('16L5yRNPTuciSgXGHqYwn9N6NeoKqopAu')).toBe(
        false
      );
    });
    it('accepts a valid P2WSH (32-byte program) bech32 address', () => {
      // See the BTC test above for the full rationale.
      expect(
        validateLtcAddress(
          'ltc1qqypqxpq9qcrsszg2pvxq6rs0zqg3yyc5z5tpwxqergd3c8g7rusq89ptx2'
        )
      ).toBe(true);
    });
  });

  describe('validateDogeAddress', () => {
    it('accepts a valid P2PKH (v30) address', () => {
      expect(validateDogeAddress('D5ERdEN1gsouFSs7zsq7VYJxyWP6dP28H1')).toBe(
        true
      );
    });
    it('rejects a wrong-checksum address', () => {
      expect(validateDogeAddress('D5ERdEN1gsouFSs7zsq7VYJxyWP6dP28H2')).toBe(
        false
      );
    });
    it("rejects another coin's address (Ravencoin P2PKH)", () => {
      expect(validateDogeAddress('R9NXAVJezHiBnT3ijTpg3JUZre7PxhJWti')).toBe(
        false
      );
    });
    it('KNOWN COLLISION (round 4 review item 3): accepts a valid DigiByte P2PKH address too - Core declares the same v30 P2PKH version byte for both DOGE and DGB, so this is inherent to the address format and not distinguishable by decoding alone. See the NOTE on validateDogeAddress() in addressValidation.ts.', () => {
      expect(validateDogeAddress('DLhVrzoqSXssQxcKkXt7Cr1ny8uG9gSCHR')).toBe(
        true
      );
    });
  });

  describe('validateRvnAddress', () => {
    it('accepts a valid P2PKH (v60) address', () => {
      expect(validateRvnAddress('R9NXAVJezHiBnT3ijTpg3JUZre7PxhJWti')).toBe(
        true
      );
    });
    it('rejects a wrong-checksum address', () => {
      expect(validateRvnAddress('R9NXAVJezHiBnT3ijTpg3JUZre7PxhJWtj')).toBe(
        false
      );
    });
    it("rejects another coin's address (Dogecoin P2PKH)", () => {
      expect(validateRvnAddress('D5ERdEN1gsouFSs7zsq7VYJxyWP6dP28H1')).toBe(
        false
      );
    });
  });

  describe('validateDgbAddress', () => {
    it('accepts a valid P2PKH (v30) address', () => {
      expect(validateDgbAddress('DLhVrzoqSXssQxcKkXt7Cr1ny8uG9gSCHR')).toBe(
        true
      );
    });
    it('accepts a valid P2SH (v63) address', () => {
      expect(validateDgbAddress('SMPL7pCX7q6pEkTyoipdVgHvk9tE5D6XNW')).toBe(
        true
      );
    });
    it('accepts a valid bech32 address', () => {
      expect(
        validateDgbAddress('dgb1qqypqxpq9qcrsszg2pvxq6rs0zqg3yyc57rkd6l')
      ).toBe(true);
    });
    it('rejects a wrong-checksum address', () => {
      expect(validateDgbAddress('SMPL7pCX7q6pEkTyoipdVgHvk9tE5D6XNX')).toBe(
        false
      );
    });
    it("rejects another coin's address (Bitcoin P2SH)", () => {
      expect(validateDgbAddress('31nM1WuowNDzocNxPPW9NQWJEtwWpjfcLj')).toBe(
        false
      );
    });
    it('KNOWN COLLISION (round 4 review item 3): accepts a valid Dogecoin P2PKH address too - see the matching test on validateDogeAddress above.', () => {
      expect(validateDgbAddress('D5ERdEN1gsouFSs7zsq7VYJxyWP6dP28H1')).toBe(
        true
      );
    });
    it('accepts a valid P2WSH (32-byte program) bech32 address', () => {
      // See the BTC test above for the full rationale.
      expect(
        validateDgbAddress(
          'dgb1qqypqxpq9qcrsszg2pvxq6rs0zqg3yyc5z5tpwxqergd3c8g7rusqetters'
        )
      ).toBe(true);
    });
  });

  describe('validateDashAddress', () => {
    it('accepts a valid P2PKH (v76, X...) address', () => {
      expect(validateDashAddress('XanAvE5GMB8CsPH78B9moJq9viEVKvCS4f')).toBe(
        true
      );
    });
    it('accepts a valid P2SH (v16, 7...) address', () => {
      expect(validateDashAddress('7SVyqiBykMKdoNuuf1AehnVxASmtdfqsFF')).toBe(
        true
      );
    });
    it('rejects a wrong-checksum address', () => {
      expect(validateDashAddress('XanAvE5GMB8CsPH78B9moJq9viEVKvCS4g')).toBe(
        false
      );
    });
    it("rejects another coin's address (Namecoin P2PKH)", () => {
      expect(validateDashAddress('MvfhHcvMJr1BEyw2Y7A8AJJGpc3rCHJoi8')).toBe(
        false
      );
    });
  });

  describe('validateNmcAddress', () => {
    it('accepts a valid P2PKH (v52) address', () => {
      expect(validateNmcAddress('MvfhHcvMJr1BEyw2Y7A8AJJGpc3rCHJoi8')).toBe(
        true
      );
    });
    it('accepts a valid P2SH (v13) address', () => {
      expect(validateNmcAddress('6EVAtPJ7cow1M5VeakAhFQgbGw14ZjbzDa')).toBe(
        true
      );
    });
    it('rejects a wrong-checksum address', () => {
      expect(validateNmcAddress('MvfhHcvMJr1BEyw2Y7A8AJJGpc3rCHJoi9')).toBe(
        false
      );
    });
    it("rejects another coin's address (Dash P2PKH)", () => {
      expect(validateNmcAddress('XanAvE5GMB8CsPH78B9moJq9viEVKvCS4f')).toBe(
        false
      );
    });
  });

  describe('validateFiroAddress', () => {
    it('accepts a valid P2PKH (v82) address', () => {
      expect(validateFiroAddress('ZzonpsrzcFuTmz7dGh9gi4Tshjn9ZK3z91')).toBe(
        true
      );
    });
    it('accepts a valid P2SH (v7) address', () => {
      expect(validateFiroAddress('3pTYyjWPMj9kSUf8SEAnLf3sVuTQDZHba6')).toBe(
        true
      );
    });
    it('rejects a wrong-checksum address', () => {
      expect(validateFiroAddress('ZzonpsrzcFuTmz7dGh9gi4Tshjn9ZK3z92')).toBe(
        false
      );
    });
    it("rejects another coin's address (Bitcoin P2SH)", () => {
      expect(validateFiroAddress('31nM1WuowNDzocNxPPW9NQWJEtwWpjfcLj')).toBe(
        false
      );
    });
  });

  describe('validateQortAddress', () => {
    it('accepts a valid account (v58, Q...) address', () => {
      expect(validateQortAddress('QLhKCGi5ZvnS9amYgdA353vzbdbWYBoxD8')).toBe(
        true
      );
    });
    it('accepts a valid AT (v23, A...) address', () => {
      expect(validateQortAddress('AFsCjUGzicZmXQtWpwVt6fQTZyaVe7bfEk')).toBe(
        true
      );
    });
    it('rejects a wrong-checksum address', () => {
      expect(validateQortAddress('QLhKCGi5ZvnS9amYgdA353vzbdbWYBoxD9')).toBe(
        false
      );
    });
    it("rejects another coin's address (Bitcoin P2PKH)", () => {
      expect(validateQortAddress('16L5yRNPTuciSgXGHqYwn9N6NeoKqopAu')).toBe(
        false
      );
    });
  });

  describe('validateArrrAddress (format-only; unchanged)', () => {
    it('accepts a well-formed shielded address', () => {
      expect(validateArrrAddress('zs1' + 'a'.repeat(75))).toBe(true);
    });
    it('rejects the wrong length', () => {
      expect(validateArrrAddress('zs1' + 'a'.repeat(74))).toBe(false);
    });
    it('rejects a non-ARRR prefix', () => {
      expect(validateArrrAddress('16L5yRNPTuciSgXGHqYwn9N6NeoKqopAu')).toBe(
        false
      );
    });
  });

  describe('validateAddress (factory)', () => {
    it('routes to the correct per-coin validator', () => {
      expect(validateAddress('BTC', '16L5yRNPTuciSgXGHqYwn9N6NeoKqopAu')).toBe(
        true
      );
      expect(
        validateAddress('DASH', 'XanAvE5GMB8CsPH78B9moJq9viEVKvCS4f')
      ).toBe(true);
      expect(validateAddress('NMC', 'MvfhHcvMJr1BEyw2Y7A8AJJGpc3rCHJoi8')).toBe(
        true
      );
      expect(
        validateAddress('FIRO', 'ZzonpsrzcFuTmz7dGh9gi4Tshjn9ZK3z91')
      ).toBe(true);
      expect(
        validateAddress('QORT', 'QLhKCGi5ZvnS9amYgdA353vzbdbWYBoxD8')
      ).toBe(true);
    });
    it('rejects a mismatched coin/address pair through the factory too', () => {
      expect(validateAddress('BTC', 'XanAvE5GMB8CsPH78B9moJq9viEVKvCS4f')).toBe(
        false
      );
    });
    it('rejects empty input for any coin', () => {
      expect(validateAddress('BTC', '')).toBe(false);
      expect(validateAddress('BTC', '   ')).toBe(false);
    });
    it('returns false and warns for an unknown coin type', () => {
      expect(validateAddress('NOT_A_COIN', 'whatever')).toBe(false);
    });
  });
});
