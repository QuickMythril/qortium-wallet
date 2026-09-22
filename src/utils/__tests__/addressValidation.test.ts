import { describe, it, expect } from 'vitest';
import {
  classifyRecipient,
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
    it('accepts a valid bech32 v0 (nc1q..., 20-byte program) address - round 6 fix: Core (BitcoinyChainSpecs.namecoinParams() .segwitAddressHrp("nc")) and Home both accept this; the validator only accepted base58 before.', () => {
      expect(
        validateNmcAddress('nc1qqurswpc8qurswpc8qurswpc8qurswpc8z9xky0')
      ).toBe(true);
    });
    it('accepts a valid bech32 v0 (nc1q..., 32-byte P2WSH program) address', () => {
      expect(
        validateNmcAddress(
          'nc1qqurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurskqqz38'
        )
      ).toBe(true);
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

  // Round 6, item B (owner decision 2026-09-22): classifyRecipient() gives
  // the send form a specific reason instead of a generic "not a valid
  // <TICKER> address", so it can name the unsupported format the user
  // pasted. Every bech32m fixture below (taproot/MWEB/Spark, plus their
  // "wrong variant"/corrupted-checksum counterparts) was generated with a
  // small Node reference script implementing BIP350 bech32/bech32m byte
  // for byte (same polymod generator + hrp-expand this file already uses
  // for BIP173 bech32, which the pre-existing 54 tests above already
  // prove correct against real mainnet addresses, plus the official
  // BIP350 bech32m constant 0x2bc830a3) - not hand-typed strings. The BTC
  // taproot fixture is additionally a real, well-known mainnet Taproot
  // address (independently checksum-verified by that same reference
  // script), so this cross-checks against a genuine BIP350 vector, not
  // just an internally-consistent synthetic one. The CashAddr fixture is
  // the canonical example address from the CashAddr specification itself.
  describe('classifyRecipient', () => {
    describe('TAPROOT_UNSUPPORTED', () => {
      it('BTC: a real, well-known mainnet Taproot (bech32m, witness v1, 32-byte program) address', () => {
        expect(
          classifyRecipient(
            'BTC',
            'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297'
          )
        ).toEqual({ valid: false, reason: 'TAPROOT_UNSUPPORTED' });
      });
      it('LTC: a Taproot-shaped (ltc1p..., bech32m, witness v1) address', () => {
        expect(
          classifyRecipient(
            'LTC',
            'ltc1pqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpq2qs525'
          )
        ).toEqual({ valid: false, reason: 'TAPROOT_UNSUPPORTED' });
      });
      it('DGB: a Taproot-shaped (dgb1p..., bech32m, witness v1) address', () => {
        expect(
          classifyRecipient(
            'DGB',
            'dgb1pqvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcrqvps3uruev'
          )
        ).toEqual({ valid: false, reason: 'TAPROOT_UNSUPPORTED' });
      });
      it('recognises a valid bech32m string as Taproot rather than treating it as a bad checksum', () => {
        const result = classifyRecipient(
          'BTC',
          'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297'
        );
        expect(result.reason).not.toBe('BAD_CHECKSUM');
        expect(result.reason).toBe('TAPROOT_UNSUPPORTED');
      });
    });

    describe('BAD_CHECKSUM for witness v1 encoded with the wrong bech32 variant', () => {
      it('BTC: witness v1 (Taproot-shaped) encoded with plain bech32 instead of the BIP350-required bech32m', () => {
        expect(
          classifyRecipient(
            'BTC',
            'bc1pqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqs3wf0qm'
          )
        ).toEqual({ valid: false, reason: 'BAD_CHECKSUM' });
      });
      it('BTC: a Taproot address with a corrupted checksum (fails both bech32 and bech32m)', () => {
        expect(
          classifyRecipient(
            'BTC',
            'bc1pqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqsyjer96'
          )
        ).toEqual({ valid: false, reason: 'BAD_CHECKSUM' });
      });
    });

    describe('MWEB_UNSUPPORTED', () => {
      it('LTC: an ltcmweb1... (bech32m) MWEB address', () => {
        expect(
          classifyRecipient(
            'LTC',
            'ltcmweb1qszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqsctzsld'
          )
        ).toEqual({ valid: false, reason: 'MWEB_UNSUPPORTED' });
      });
      it('a corrupted MWEB address falls back to BAD_CHECKSUM (right HRP, checksum fails both variants)', () => {
        expect(
          classifyRecipient(
            'LTC',
            'ltcmweb1qszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqsctzslw'
          )
        ).toEqual({ valid: false, reason: 'BAD_CHECKSUM' });
      });
    });

    describe('SPARK_UNSUPPORTED (FIRO)', () => {
      it('a valid sm1... (bech32m) Spark address', () => {
        expect(
          classifyRecipient(
            'FIRO',
            'sm1q5zs2pg9q5zs2pg9q5zs2pg9q5zs2pg9q5zs2pg9q5zs2pg9q5zs7x65tn'
          )
        ).toEqual({ valid: false, reason: 'SPARK_UNSUPPORTED' });
      });
      it('a corrupted Spark address falls back to BAD_CHECKSUM (right HRP, checksum fails both variants)', () => {
        expect(
          classifyRecipient(
            'FIRO',
            'sm1q5zs2pg9q5zs2pg9q5zs2pg9q5zs2pg9q5zs2pg9q5zs2pg9q5zs7x65t5'
          )
        ).toEqual({ valid: false, reason: 'BAD_CHECKSUM' });
      });
      // LELANTUS_UNSUPPORTED (in RecipientInvalidReason) is deliberately
      // untested: Firo's older Lelantus/Sigma privacy mints have no
      // equivalent user-facing "address" format to paste into a send
      // form - a mint is a script the sender's own wallet builds
      // internally, never a string published for someone else to send
      // to (see the NOTE on isSparkAddress() in addressValidation.ts).
      // No input reaches that branch, so there is nothing to fixture.
    });

    describe('CASHADDR_WRONG_COIN', () => {
      it('BTC: the canonical CashAddr specification example address, with its bitcoincash: prefix', () => {
        expect(
          classifyRecipient(
            'BTC',
            'bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a'
          )
        ).toEqual({ valid: false, reason: 'CASHADDR_WRONG_COIN' });
      });
      it('BTC: the same CashAddr address without its prefix (defaults to bitcoincash)', () => {
        expect(
          classifyRecipient('BTC', 'qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a')
        ).toEqual({ valid: false, reason: 'CASHADDR_WRONG_COIN' });
      });
      it('is coin-independent: also recognised when the target coin is QORT', () => {
        expect(
          classifyRecipient(
            'QORT',
            'bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a'
          )
        ).toEqual({ valid: false, reason: 'CASHADDR_WRONG_COIN' });
      });
    });

    describe('WRONG_COIN', () => {
      it('BTC target, a valid LTC P2PKH address', () => {
        expect(
          classifyRecipient('BTC', 'LKKHMBjCU89fyFNgSRprDoD8Jb25N8uWvd')
        ).toEqual({ valid: false, reason: 'WRONG_COIN', otherCoin: 'LTC' });
      });
      it('RVN target, a valid DOGE/DGB-colliding P2PKH address (reported as DOGE)', () => {
        expect(
          classifyRecipient('RVN', 'D5ERdEN1gsouFSs7zsq7VYJxyWP6dP28H1')
        ).toEqual({ valid: false, reason: 'WRONG_COIN', otherCoin: 'DOGE' });
      });
      it('DASH target, a valid NMC P2PKH address', () => {
        expect(
          classifyRecipient('DASH', 'MvfhHcvMJr1BEyw2Y7A8AJJGpc3rCHJoi8')
        ).toEqual({ valid: false, reason: 'WRONG_COIN', otherCoin: 'NMC' });
      });
      it('QORT target, a valid BTC P2PKH address', () => {
        expect(
          classifyRecipient('QORT', '16L5yRNPTuciSgXGHqYwn9N6NeoKqopAu')
        ).toEqual({ valid: false, reason: 'WRONG_COIN', otherCoin: 'BTC' });
      });
      it('FIRO target, a valid DGB-only P2SH address', () => {
        expect(
          classifyRecipient('FIRO', 'SMPL7pCX7q6pEkTyoipdVgHvk9tE5D6XNW')
        ).toEqual({ valid: false, reason: 'WRONG_COIN', otherCoin: 'DGB' });
      });
      it('NMC target, a valid DASH P2PKH address', () => {
        expect(
          classifyRecipient('NMC', 'XanAvE5GMB8CsPH78B9moJq9viEVKvCS4f')
        ).toEqual({ valid: false, reason: 'WRONG_COIN', otherCoin: 'DASH' });
      });
      it('ARRR target, a valid BTC P2PKH address', () => {
        expect(
          classifyRecipient('ARRR', '16L5yRNPTuciSgXGHqYwn9N6NeoKqopAu')
        ).toEqual({ valid: false, reason: 'WRONG_COIN', otherCoin: 'BTC' });
      });
      it('the DOGE/DGB base58 collision stays mutually valid, not WRONG_COIN, for either coin (unchanged round 4 behaviour)', () => {
        expect(
          classifyRecipient('DOGE', 'DLhVrzoqSXssQxcKkXt7Cr1ny8uG9gSCHR')
        ).toEqual({ valid: true });
        expect(
          classifyRecipient('DGB', 'D5ERdEN1gsouFSs7zsq7VYJxyWP6dP28H1')
        ).toEqual({ valid: true });
      });
    });

    describe('BAD_CHECKSUM (base58, right shape, checksum fails)', () => {
      it.each([
        ['BTC', '16L5yRNPTuciSgXGHqYwn9N6NeoKqopAv'],
        ['LTC', 'LKKHMBjCU89fyFNgSRprDoD8Jb25N8uWve'],
        ['DOGE', 'D5ERdEN1gsouFSs7zsq7VYJxyWP6dP28H2'],
        ['RVN', 'R9NXAVJezHiBnT3ijTpg3JUZre7PxhJWtj'],
        ['DGB', 'SMPL7pCX7q6pEkTyoipdVgHvk9tE5D6XNX'],
        ['DASH', 'XanAvE5GMB8CsPH78B9moJq9viEVKvCS4g'],
        ['NMC', 'MvfhHcvMJr1BEyw2Y7A8AJJGpc3rCHJoi9'],
        ['FIRO', 'ZzonpsrzcFuTmz7dGh9gi4Tshjn9ZK3z92'],
        ['QORT', 'QLhKCGi5ZvnS9amYgdA353vzbdbWYBoxD9'],
      ])('%s: %s', (coin, address) => {
        expect(classifyRecipient(coin, address)).toEqual({
          valid: false,
          reason: 'BAD_CHECKSUM',
        });
      });
      it('BTC: a bech32 address with a corrupted checksum', () => {
        expect(
          classifyRecipient('BTC', 'bc1qqypqxpq9qcrsszg2pvxq6rs0zqg3yyc5fcj4z4')
        ).toEqual({ valid: false, reason: 'BAD_CHECKSUM' });
      });
    });

    describe('UNKNOWN_FORMAT', () => {
      it.each(['BTC', 'FIRO', 'ARRR', 'QORT'])(
        '%s: a string with invalid base58 characters (0/O/I/l) that is also not bech32-shaped',
        (coin) => {
          expect(
            classifyRecipient(coin, '0OIlxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')
          ).toEqual({ valid: false, reason: 'UNKNOWN_FORMAT' });
        }
      );
    });

    describe('NMC nc1... bech32 v0 (round 6 fix)', () => {
      it('accepts a valid 20-byte nc1q... address', () => {
        expect(
          classifyRecipient('NMC', 'nc1qqurswpc8qurswpc8qurswpc8qurswpc8z9xky0')
        ).toEqual({ valid: true });
      });
      it('accepts a valid 32-byte (P2WSH) nc1q... address', () => {
        expect(
          classifyRecipient(
            'NMC',
            'nc1qqurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurskqqz38'
          )
        ).toEqual({ valid: true });
      });
    });

    it('empty input returns invalid with no specific reason', () => {
      expect(classifyRecipient('BTC', '')).toEqual({ valid: false });
      expect(classifyRecipient('BTC', '   ')).toEqual({ valid: false });
    });

    it('validateAddress stays a thin boolean wrapper over classifyRecipient', () => {
      const address =
        'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297';
      expect(validateAddress('BTC', address)).toBe(
        classifyRecipient('BTC', address).valid
      );
      expect(validateAddress('BTC', '16L5yRNPTuciSgXGHqYwn9N6NeoKqopAu')).toBe(
        classifyRecipient('BTC', '16L5yRNPTuciSgXGHqYwn9N6NeoKqopAu').valid
      );
    });
  });
});
