import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useAssetImageUrl,
  __resetAssetImageUrlCacheForTests,
  __getInFlightCountsForTests,
  __getImageCacheStatsForTests,
  __getImageCacheKeysForTests,
  __setCachedImageResultForTests,
} from '../useAssetImageUrl';

// Fake base64 payloads whose decoded header sniffs as a real image format -
// the hook rejects anything that doesn't decode to one of these signatures
// (round 3b).
function fakeBase64(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes));
}
const PNG_BASE64 = fakeBase64([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  ...Array(16).fill(0),
]);
const JPEG_BASE64 = fakeBase64([0xff, 0xd8, 0xff, 0xe0, ...Array(16).fill(0)]);
const GIF_BASE64 = fakeBase64([
  0x47,
  0x49,
  0x46,
  0x38,
  0x39,
  0x61,
  ...Array(16).fill(0),
]);
const WEBP_BASE64 = fakeBase64([
  0x52,
  0x49,
  0x46,
  0x46,
  0,
  0,
  0,
  0,
  0x57,
  0x45,
  0x42,
  0x50,
  ...Array(8).fill(0),
]);
const SVG_BASE64 = fakeBase64([
  0x3c,
  0x73,
  0x76,
  0x67,
  ...Array(16).fill(0x20),
]);
// A ZIP signature - a real file header, but not an allowed image format.
const NOT_AN_IMAGE_BASE64 = fakeBase64([
  0x50,
  0x4b,
  0x03,
  0x04,
  ...Array(16).fill(0),
]);

// A PNG payload long enough (2000+ trailing bytes) that its corrupted tail
// falls well past the 1024-base64-char MIME-sniff window - proving whole-
// payload validation, not just a bigger sniff sample (round 3b review
// finding 1).
const LONG_PNG_BASE64 = fakeBase64([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  ...Array(2000).fill(0),
]);
// Same length, otherwise-valid base64 - only its final character is not a
// base64 character.
const TRAILING_INVALID_BASE64 = `${LONG_PNG_BASE64.slice(0, -1)}!`;

// A real SVG root element preceded by an XML declaration - must still be
// recognized once the declaration is skipped.
const SVG_WITH_XML_PROLOG_BASE64 = fakeBase64(
  Array.from(
    '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg"></svg>',
    (ch) => ch.charCodeAt(0)
  )
);
// `<svgx...>` is an element named "svgx", not "svg" - must be rejected even
// though it starts with the same four characters.
const SVGX_BASE64 = fakeBase64(
  Array.from('<svgxmlns="not-an-svg-root">', (ch) => ch.charCodeAt(0))
);

const flushMicrotasks = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

beforeEach(() => {
  __resetAssetImageUrlCacheForTests();
});

afterEach(() => {
  delete (globalThis as any).qdnRequest;
  delete (globalThis as any).qortalRequest;
  __resetAssetImageUrlCacheForTests();
});

describe('useAssetImageUrl', () => {
  it('resolves a Qortium asset through qdnRequest with the exact FETCH_QDN_RESOURCE (base64) coordinate, never qortalRequest', async () => {
    const qortalRequestMock = vi.fn();
    (globalThis as any).qortalRequest = qortalRequestMock;

    const qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_PRIMARY_NAME') return 'chip-issuer';
      if (opts.action === 'FETCH_QDN_RESOURCE') {
        expect(opts).toMatchObject({
          action: 'FETCH_QDN_RESOURCE',
          service: 'IMAGE',
          name: 'chip-issuer',
          identifier: 'asset2_CHIP_aavatar',
          encoding: 'base64',
          maxBytes: 2_000_000,
        });
        return PNG_BASE64;
      }
      throw new Error(`unexpected qdnRequest action: ${opts.action}`);
    });
    (globalThis as any).qdnRequest = qdnRequestMock;

    const { result } = renderHook(() =>
      useAssetImageUrl('qortium', {
        assetId: 2,
        name: 'CHIP',
        owner: 'QissuerAddress',
      })
    );

    await waitFor(() =>
      expect(result.current.url).toBe(`data:image/png;base64,${PNG_BASE64}`)
    );
    expect(result.current.issuerName).toBe('chip-issuer');
    expect(
      qdnRequestMock.mock.calls.some(
        ([opts]) => opts.action === 'GET_PRIMARY_NAME'
      )
    ).toBe(true);
    expect(qortalRequestMock).not.toHaveBeenCalled();
  });

  it('resolves a Qortal asset through qortalRequest with the exact FETCH_QDN_RESOURCE (base64) coordinate, never qdnRequest', async () => {
    const qdnRequestMock = vi.fn();
    (globalThis as any).qdnRequest = qdnRequestMock;

    const qortalRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_PRIMARY_NAME') return 'silver-issuer';
      if (opts.action === 'FETCH_QDN_RESOURCE') {
        expect(opts).toMatchObject({
          action: 'FETCH_QDN_RESOURCE',
          service: 'IMAGE',
          name: 'silver-issuer',
          identifier: 'asset11_QORTAL-SILVER_aavatar',
          encoding: 'base64',
          maxBytes: 2_000_000,
        });
        return JPEG_BASE64;
      }
      throw new Error(`unexpected qortalRequest action: ${opts.action}`);
    });
    (globalThis as any).qortalRequest = qortalRequestMock;

    const { result } = renderHook(() =>
      useAssetImageUrl('qortal', {
        assetId: 11,
        name: 'QORTAL-SILVER',
        owner: 'QissuerAddress',
      })
    );

    await waitFor(() =>
      expect(result.current.url).toBe(`data:image/jpeg;base64,${JPEG_BASE64}`)
    );
    expect(qdnRequestMock).not.toHaveBeenCalled();
  });

  it('accepts the response wrapped as {data64: ...} as well as a plain base64 string', async () => {
    const qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_PRIMARY_NAME') return 'chip-issuer';
      if (opts.action === 'FETCH_QDN_RESOURCE') return { data64: PNG_BASE64 };
      throw new Error(`unexpected: ${opts.action}`);
    });
    (globalThis as any).qdnRequest = qdnRequestMock;

    const { result } = renderHook(() =>
      useAssetImageUrl('qortium', {
        assetId: 2,
        name: 'CHIP',
        owner: 'QissuerAddress',
      })
    );

    await waitFor(() =>
      expect(result.current.url).toBe(`data:image/png;base64,${PNG_BASE64}`)
    );
  });

  it('falls back to GET_ACCOUNT_NAMES when GET_PRIMARY_NAME resolves no name', async () => {
    const qortalRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_PRIMARY_NAME') return '';
      if (opts.action === 'GET_ACCOUNT_NAMES') {
        return [{ name: 'fallback-issuer', owner: 'QissuerAddress' }];
      }
      if (opts.action === 'FETCH_QDN_RESOURCE') {
        expect(opts).toMatchObject({ name: 'fallback-issuer' });
        return GIF_BASE64;
      }
      throw new Error(`unexpected action: ${opts.action}`);
    });
    (globalThis as any).qortalRequest = qortalRequestMock;

    const { result } = renderHook(() =>
      useAssetImageUrl('qortal', {
        assetId: 3,
        name: 'SMPL',
        owner: 'QissuerAddress',
      })
    );

    await waitFor(() =>
      expect(result.current.issuerName).toBe('fallback-issuer')
    );
    expect(result.current.url).toBe(`data:image/gif;base64,${GIF_BASE64}`);
  });

  it('resolves to a null image (no throw) when the issuer cannot be resolved at all', async () => {
    const qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_PRIMARY_NAME')
        return Promise.reject(new Error('not found'));
      if (opts.action === 'GET_ACCOUNT_NAMES')
        return Promise.reject(new Error('not found'));
      throw new Error(`unexpected action: ${opts.action}`);
    });
    (globalThis as any).qdnRequest = qdnRequestMock;

    const { result, unmount } = renderHook(() =>
      useAssetImageUrl('qortium', {
        assetId: 1,
        name: 'TIUM',
        owner: 'QunknownOwner',
      })
    );

    await waitFor(() =>
      expect(
        qdnRequestMock.mock.calls.some(
          ([opts]) => opts.action === 'GET_ACCOUNT_NAMES'
        )
      ).toBe(true)
    );

    expect(result.current.url).toBeNull();
    expect(result.current.issuerName).toBeNull();
    unmount();
  });

  it('falls back to the Q-Assets default avatar only on Qortal when no issuer image is published', async () => {
    const qortalRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_PRIMARY_NAME') return 'gold-issuer';
      if (opts.action === 'FETCH_QDN_RESOURCE') {
        if (opts.name === 'gold-issuer') return ''; // never published
        expect(opts).toMatchObject({
          name: 'Q-Assets',
          identifier: 'assetAvatar_default',
        });
        return PNG_BASE64;
      }
      throw new Error(`unexpected action: ${opts.action}`);
    });
    (globalThis as any).qortalRequest = qortalRequestMock;
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useAssetImageUrl('qortal', {
          assetId: 21,
          name: 'QORTAL-GOLD',
          owner: 'QissuerAddress',
        })
      );

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.url).toBe(`data:image/png;base64,${PNG_BASE64}`);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never falls back to the Q-Assets default avatar on Qortium', async () => {
    const qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_PRIMARY_NAME') return 'chip-issuer';
      if (opts.action === 'FETCH_QDN_RESOURCE') return '';
      throw new Error(`unexpected action: ${opts.action}`);
    });
    (globalThis as any).qdnRequest = qdnRequestMock;
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useAssetImageUrl('qortium', {
          assetId: 2,
          name: 'CHIP',
          owner: 'QissuerAddress',
        })
      );

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.url).toBeNull();
      expect(
        qdnRequestMock.mock.calls.some(([opts]) => opts.name === 'Q-Assets')
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not cache a miss - a later mount retries and can resolve once the resource is published', async () => {
    const qdnRequestMock = vi
      .fn()
      .mockImplementation(async (opts: Record<string, unknown>) => {
        if (opts.action === 'GET_PRIMARY_NAME')
          return Promise.reject(new Error('unknown name'));
        if (opts.action === 'GET_ACCOUNT_NAMES')
          return Promise.reject(new Error('unknown name'));
        throw new Error(`unexpected: ${opts.action}`);
      });
    (globalThis as any).qdnRequest = qdnRequestMock;

    const asset = { assetId: 1, name: 'TIUM', owner: 'QOwner' };
    const first = renderHook(() => useAssetImageUrl('qortium', asset));
    await waitFor(() =>
      expect(
        qdnRequestMock.mock.calls.some(
          ([opts]) => opts.action === 'GET_ACCOUNT_NAMES'
        )
      ).toBe(true)
    );
    expect(first.result.current.url).toBeNull();
    first.unmount();

    qdnRequestMock.mockReset();
    qdnRequestMock.mockImplementation(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_PRIMARY_NAME') return 'tium-issuer';
      if (opts.action === 'FETCH_QDN_RESOURCE') return PNG_BASE64;
      throw new Error(`unexpected: ${opts.action}`);
    });

    const second = renderHook(() => useAssetImageUrl('qortium', asset));
    await waitFor(() =>
      expect(second.result.current.url).toBe(
        `data:image/png;base64,${PNG_BASE64}`
      )
    );
  });

  it('caches a resolved image URL - a second mount for the same asset makes no further requests', async () => {
    const qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_PRIMARY_NAME') return 'chip-issuer';
      if (opts.action === 'FETCH_QDN_RESOURCE') return PNG_BASE64;
      throw new Error(`unexpected: ${opts.action}`);
    });
    (globalThis as any).qdnRequest = qdnRequestMock;

    const asset = { assetId: 2, name: 'CHIP', owner: 'QOwner' };
    const { result } = renderHook(() => useAssetImageUrl('qortium', asset));
    await waitFor(() => expect(result.current.url).not.toBeNull());

    const callCountAfterFirst = qdnRequestMock.mock.calls.length;
    const again = renderHook(() => useAssetImageUrl('qortium', asset));
    expect(again.result.current.url).toBe(result.current.url);
    expect(qdnRequestMock.mock.calls.length).toBe(callCountAfterFirst);
  });
});

// Round 3b: rejects any payload that doesn't sniff as a real image, and the
// retry-with-backoff that used to live at the <img onError> level (a data:
// URL never 503s, so there's nothing for onError to retry) now lives here,
// at the fetch level.
describe('useAssetImageUrl - issuer name resolves independently of a slow image fetch (round 3b)', () => {
  it('surfaces issuerName as soon as it resolves, without waiting for the (possibly retried) image fetch', async () => {
    const qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_PRIMARY_NAME') return 'gold-issuer';
      if (opts.action === 'FETCH_QDN_RESOURCE') return ''; // never resolves quickly
      throw new Error(`unexpected: ${opts.action}`);
    });
    (globalThis as any).qdnRequest = qdnRequestMock;
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useAssetImageUrl('qortium', {
          assetId: 21,
          name: 'QORTAL-GOLD',
          owner: 'QissuerAddress',
        })
      );

      // Only the (fast) issuer-name lookup and the image fetch's *first*
      // attempt have had a chance to settle - none of the retry delays
      // have elapsed yet.
      await flushMicrotasks();

      expect(result.current.issuerName).toBe('gold-issuer');
      expect(result.current.url).toBeNull();

      // Let the full retry cycle finish - the final result still carries
      // the same issuer name.
      await act(async () => {
        await vi.runAllTimersAsync();
      });
      expect(result.current).toEqual({ url: null, issuerName: 'gold-issuer' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('useAssetImageUrl - base64 image payload and MIME sniff (round 3b)', () => {
  it.each([
    ['jpeg', JPEG_BASE64, 'image/jpeg'],
    ['gif', GIF_BASE64, 'image/gif'],
    ['webp', WEBP_BASE64, 'image/webp'],
    ['svg', SVG_BASE64, 'image/svg+xml'],
  ])('recognizes a %s payload', async (_label, base64, mime) => {
    const qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_PRIMARY_NAME') return 'chip-issuer';
      if (opts.action === 'FETCH_QDN_RESOURCE') return base64;
      throw new Error(`unexpected: ${opts.action}`);
    });
    (globalThis as any).qdnRequest = qdnRequestMock;

    const { result } = renderHook(() =>
      useAssetImageUrl('qortium', {
        assetId: 2,
        name: 'CHIP',
        owner: 'QOwner',
      })
    );

    await waitFor(() =>
      expect(result.current.url).toBe(`data:${mime};base64,${base64}`)
    );
  });

  it('never renders a payload that does not sniff as an allowed image format (an SVG payload is still only ever handed to <img>, never inlined)', async () => {
    const qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_PRIMARY_NAME') return 'chip-issuer';
      if (opts.action === 'FETCH_QDN_RESOURCE') return NOT_AN_IMAGE_BASE64;
      throw new Error(`unexpected: ${opts.action}`);
    });
    (globalThis as any).qdnRequest = qdnRequestMock;
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useAssetImageUrl('qortium', {
          assetId: 2,
          name: 'CHIP',
          owner: 'QOwner',
        })
      );

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.url).toBeNull();
      expect(__getInFlightCountsForTests()).toEqual({
        issuerName: 0,
        image: 0,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a payload whose base64 is invalid past the MIME-sniff window (trailing corruption)', async () => {
    const qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_PRIMARY_NAME') return 'chip-issuer';
      if (opts.action === 'FETCH_QDN_RESOURCE') return TRAILING_INVALID_BASE64;
      throw new Error(`unexpected: ${opts.action}`);
    });
    (globalThis as any).qdnRequest = qdnRequestMock;
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useAssetImageUrl('qortium', {
          assetId: 2,
          name: 'CHIP',
          owner: 'QOwner',
        })
      );

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // The prefix alone would have sniffed as a valid PNG under a
      // sniff-window-only check - the whole payload must be validated.
      expect(result.current.url).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects an oversized payload (>2 MB decoded) without ever decoding it', async () => {
    // A valid, well-formed base64 string that decodes to ~2,002,500 bytes -
    // over the 2,000,000-byte cap. Length alone (with padding) is enough to
    // reject it; nothing this large should ever reach `atob`.
    const oversizedBase64 = 'A'.repeat(2_670_000);
    const atobSpy = vi.spyOn(globalThis, 'atob');

    const qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_PRIMARY_NAME') return 'chip-issuer';
      if (opts.action === 'FETCH_QDN_RESOURCE') return oversizedBase64;
      throw new Error(`unexpected: ${opts.action}`);
    });
    (globalThis as any).qdnRequest = qdnRequestMock;
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useAssetImageUrl('qortium', {
          assetId: 2,
          name: 'CHIP',
          owner: 'QOwner',
        })
      );

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.url).toBeNull();
      expect(atobSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      atobSpy.mockRestore();
    }
  });

  it('rejects "<svgx...>" - a real element name starting with those four characters, not an <svg> root', async () => {
    const qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_PRIMARY_NAME') return 'chip-issuer';
      if (opts.action === 'FETCH_QDN_RESOURCE') return SVGX_BASE64;
      throw new Error(`unexpected: ${opts.action}`);
    });
    (globalThis as any).qdnRequest = qdnRequestMock;
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useAssetImageUrl('qortium', {
          assetId: 2,
          name: 'CHIP',
          owner: 'QOwner',
        })
      );

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.url).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('recognizes an <svg> root preceded by an XML declaration', async () => {
    const qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_PRIMARY_NAME') return 'chip-issuer';
      if (opts.action === 'FETCH_QDN_RESOURCE')
        return SVG_WITH_XML_PROLOG_BASE64;
      throw new Error(`unexpected: ${opts.action}`);
    });
    (globalThis as any).qdnRequest = qdnRequestMock;

    const { result } = renderHook(() =>
      useAssetImageUrl('qortium', {
        assetId: 2,
        name: 'CHIP',
        owner: 'QOwner',
      })
    );

    await waitFor(() =>
      expect(result.current.url).toBe(
        `data:image/svg+xml;base64,${SVG_WITH_XML_PROLOG_BASE64}`
      )
    );
  });

  it('rejects a payload that fails to base64-decode at all', async () => {
    const qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_PRIMARY_NAME') return 'chip-issuer';
      if (opts.action === 'FETCH_QDN_RESOURCE') return '***not base64***';
      throw new Error(`unexpected: ${opts.action}`);
    });
    (globalThis as any).qdnRequest = qdnRequestMock;
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useAssetImageUrl('qortium', {
          assetId: 2,
          name: 'CHIP',
          owner: 'QOwner',
        })
      );

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.url).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries a transient empty response up to 3 times, at 1.5s/4s/10s, before giving up to the placeholder - and never caches the miss', async () => {
    const qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_PRIMARY_NAME') return 'chip-issuer';
      if (opts.action === 'FETCH_QDN_RESOURCE') return ''; // "still building"
      throw new Error(`unexpected: ${opts.action}`);
    });
    (globalThis as any).qdnRequest = qdnRequestMock;
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useAssetImageUrl('qortium', {
          assetId: 2,
          name: 'CHIP',
          owner: 'QOwner',
        })
      );
      const fetchCalls = () =>
        qdnRequestMock.mock.calls.filter(
          ([opts]) => opts.action === 'FETCH_QDN_RESOURCE'
        ).length;

      await flushMicrotasks();
      expect(fetchCalls()).toBe(1);
      expect(result.current.url).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(fetchCalls()).toBe(2);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });
      expect(fetchCalls()).toBe(3);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });
      expect(fetchCalls()).toBe(4);

      // Retries exhausted (qortium never falls back to Q-Assets) - no
      // further calls, permanently null for this mount, and never cached.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60000);
      });
      expect(fetchCalls()).toBe(4);
      expect(result.current.url).toBeNull();
      expect(__getInFlightCountsForTests()).toEqual({
        issuerName: 0,
        image: 0,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves once a retry succeeds after an initial empty ("still building") response', async () => {
    let fetchCalls = 0;
    const qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_PRIMARY_NAME') return 'chip-issuer';
      if (opts.action === 'FETCH_QDN_RESOURCE') {
        fetchCalls++;
        return fetchCalls === 1 ? '' : PNG_BASE64;
      }
      throw new Error(`unexpected: ${opts.action}`);
    });
    (globalThis as any).qdnRequest = qdnRequestMock;
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useAssetImageUrl('qortium', {
          assetId: 2,
          name: 'CHIP',
          owner: 'QOwner',
        })
      );

      await flushMicrotasks();
      expect(result.current.url).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(result.current.url).toBe(`data:image/png;base64,${PNG_BASE64}`);
      expect(fetchCalls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

// Round 3 review finding 2: an issuer-controlled asset name was
// interpolated straight into the QDN identifier with no preflight, and a
// bridge that threw synchronously (instead of rejecting) skipped the
// cleanup that clears the in-flight maps, leaving that asset's lookup stuck
// forever. These tests cover the fix: a locally-invalid identifier never
// reaches the bridge, a synchronous throw still resolves to the placeholder
// with no unhandled rejection, and the in-flight maps are always empty once
// a lookup settles either way.
describe('useAssetImageUrl - identifier validation and error safety (round 3 review finding 2)', () => {
  it('never calls the bridge for a malformed identifier (embedded whitespace)', async () => {
    const qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_PRIMARY_NAME') return 'chip-issuer';
      if (opts.action === 'FETCH_QDN_RESOURCE') {
        throw new Error(
          `should never be called with a malformed identifier: ${opts.identifier}`
        );
      }
      throw new Error(`unexpected action: ${opts.action}`);
    });
    (globalThis as any).qdnRequest = qdnRequestMock;

    const { result } = renderHook(() =>
      useAssetImageUrl('qortium', {
        assetId: 2,
        name: 'CHIP TOKEN', // embedded space - not a valid QDN identifier
        owner: 'QissuerAddress',
      })
    );

    await waitFor(() => expect(result.current.issuerName).toBe('chip-issuer'));
    expect(result.current.url).toBeNull();
    expect(
      qdnRequestMock.mock.calls.some(
        ([opts]) => opts.action === 'FETCH_QDN_RESOURCE'
      )
    ).toBe(false);
    expect(__getInFlightCountsForTests()).toEqual({ issuerName: 0, image: 0 });
  });

  it('never calls the bridge for a malformed identifier (embedded slash)', async () => {
    const qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_PRIMARY_NAME') return 'chip-issuer';
      if (opts.action === 'FETCH_QDN_RESOURCE') {
        throw new Error('should never be called with a malformed identifier');
      }
      throw new Error(`unexpected action: ${opts.action}`);
    });
    (globalThis as any).qdnRequest = qdnRequestMock;

    const { result } = renderHook(() =>
      useAssetImageUrl('qortium', {
        assetId: 2,
        name: 'CHIP/../escape',
        owner: 'QissuerAddress',
      })
    );

    await waitFor(() => expect(result.current.issuerName).toBe('chip-issuer'));
    expect(result.current.url).toBeNull();
    expect(
      qdnRequestMock.mock.calls.some(
        ([opts]) => opts.action === 'FETCH_QDN_RESOURCE'
      )
    ).toBe(false);
    expect(__getInFlightCountsForTests()).toEqual({ issuerName: 0, image: 0 });
  });

  it('never calls the bridge for an over-length identifier (>64 bytes)', async () => {
    const qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_PRIMARY_NAME') return 'chip-issuer';
      if (opts.action === 'FETCH_QDN_RESOURCE') {
        throw new Error(
          'should never be called with an over-length identifier'
        );
      }
      throw new Error(`unexpected action: ${opts.action}`);
    });
    (globalThis as any).qdnRequest = qdnRequestMock;

    const longName = 'X'.repeat(80); // asset<id>_<name>_aavatar comfortably over 64 chars
    const { result } = renderHook(() =>
      useAssetImageUrl('qortium', {
        assetId: 2,
        name: longName,
        owner: 'QissuerAddress',
      })
    );

    await waitFor(() => expect(result.current.issuerName).toBe('chip-issuer'));
    expect(result.current.url).toBeNull();
    expect(
      qdnRequestMock.mock.calls.some(
        ([opts]) => opts.action === 'FETCH_QDN_RESOURCE'
      )
    ).toBe(false);
    expect(__getInFlightCountsForTests()).toEqual({ issuerName: 0, image: 0 });
  });

  it('a malformed identifier still falls back to the Q-Assets default on Qortal', async () => {
    const qortalRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_PRIMARY_NAME') return 'gold-issuer';
      if (opts.action === 'FETCH_QDN_RESOURCE') {
        expect(opts).toMatchObject({
          name: 'Q-Assets',
          identifier: 'assetAvatar_default',
        });
        return PNG_BASE64;
      }
      throw new Error(`unexpected action: ${opts.action}`);
    });
    (globalThis as any).qortalRequest = qortalRequestMock;

    const { result } = renderHook(() =>
      useAssetImageUrl('qortal', {
        assetId: 21,
        name: 'QORTAL GOLD', // embedded space
        owner: 'QissuerAddress',
      })
    );

    await waitFor(() =>
      expect(result.current.url).toBe(`data:image/png;base64,${PNG_BASE64}`)
    );
  });

  it('a bridge that throws synchronously still resolves to the placeholder, with no unhandled rejection and an empty in-flight map afterwards', async () => {
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      // A host bridge that throws synchronously instead of returning a
      // rejected promise - not an async function, so this throw happens
      // before any Promise even exists.
      (globalThis as any).qdnRequest = vi.fn(() => {
        throw new Error('synchronous bridge failure');
      });

      const { result } = renderHook(() =>
        useAssetImageUrl('qortium', {
          assetId: 1,
          name: 'TIUM',
          owner: 'QOwner',
        })
      );

      await waitFor(() =>
        expect(result.current).toEqual({ url: null, issuerName: null })
      );

      // Give any microtask-queued unhandled rejection a chance to surface.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(unhandledRejections).toEqual([]);
      expect(__getInFlightCountsForTests()).toEqual({
        issuerName: 0,
        image: 0,
      });
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('a synchronous bridge throw does not leave the lookup stuck - a later mount (e.g. after a fix or bridge-state change) can still resolve', async () => {
    (globalThis as any).qdnRequest = vi.fn(() => {
      throw new Error('synchronous bridge failure');
    });

    const asset = { assetId: 1, name: 'TIUM', owner: 'QOwner' };
    const first = renderHook(() => useAssetImageUrl('qortium', asset));
    await waitFor(() => expect(first.result.current.url).toBeNull());
    first.unmount();

    expect(__getInFlightCountsForTests()).toEqual({ issuerName: 0, image: 0 });

    (globalThis as any).qdnRequest = vi.fn(
      async (opts: Record<string, unknown>) => {
        if (opts.action === 'GET_PRIMARY_NAME') return 'tium-issuer';
        if (opts.action === 'FETCH_QDN_RESOURCE') return PNG_BASE64;
        throw new Error(`unexpected: ${opts.action}`);
      }
    );

    const second = renderHook(() => useAssetImageUrl('qortium', asset));
    await waitFor(() =>
      expect(second.result.current.url).toBe(
        `data:image/png;base64,${PNG_BASE64}`
      )
    );
  });
});

// Round 3b review finding 3: the resolved-image cache was an unbounded Map -
// a long-lived session viewing many distinct assets would grow it forever,
// each entry potentially a couple of MB of base64 text. It's now capped on
// both entry count and total tracked byte size, with LRU eviction. These
// tests drive the real insert/eviction path directly via
// `__setCachedImageResultForTests` (the same function `fetchAssetImage`
// calls) rather than a full async hook resolution per entry, so a
// capacity test doesn't need to simulate dozens of bridge round-trips.
describe('useAssetImageUrl - bounded image cache with LRU eviction (round 3b review finding 3)', () => {
  it('evicts the oldest entry once more than 40 distinct assets are cached, keeping the entry count at the cap', () => {
    for (let i = 0; i < 41; i++) {
      __setCachedImageResultForTests(`qortium:${i}`, {
        url: `data:image/png;base64,entry-${i}`,
        issuerName: null,
      });
    }

    const stats = __getImageCacheStatsForTests();
    expect(stats.maxEntries).toBe(40);
    expect(stats.entries).toBe(40);

    const keys = __getImageCacheKeysForTests();
    // Entry 0 was the oldest (first inserted) - it must be the one evicted.
    expect(keys).not.toContain('qortium:0');
    expect(keys).toContain('qortium:1');
    expect(keys).toContain('qortium:40');
    expect(keys[0]).toBe('qortium:1');
  });

  it('re-reading an entry marks it most-recently-used, so it survives an eviction that would otherwise remove it', () => {
    for (let i = 0; i < 40; i++) {
      __setCachedImageResultForTests(`qortium:${i}`, {
        url: `data:image/png;base64,entry-${i}`,
        issuerName: null,
      });
    }
    // Touch the oldest entry via the same read-through path the hook uses -
    // it should move to the most-recently-used end.
    const { result } = renderHook(() =>
      useAssetImageUrl('qortium', { assetId: 0, name: 'X', owner: 'Q' })
    );
    expect(result.current.url).toBe('data:image/png;base64,entry-0');

    // Adding one more entry now evicts entry 1 (the new oldest), not entry
    // 0 (just touched).
    __setCachedImageResultForTests('qortium:40', {
      url: 'data:image/png;base64,entry-40',
      issuerName: null,
    });

    const keys = __getImageCacheKeysForTests();
    expect(keys).toContain('qortium:0');
    expect(keys).not.toContain('qortium:1');
  });

  it('evicts oldest entries once the 24 MB base64-byte cap is exceeded, even with far fewer than 40 entries', () => {
    // ~3,000,025 chars each ("data:image/png;base64," + 3,000,000 chars +
    // an index suffix) - 9 of these exceed the 24 MB (25,165,824-byte) cap,
    // 8 do not.
    const bigUrl = (n: number) =>
      `data:image/png;base64,${'A'.repeat(3_000_000)}#${n}`;
    for (let i = 0; i < 9; i++) {
      __setCachedImageResultForTests(`qortium:big${i}`, {
        url: bigUrl(i),
        issuerName: null,
      });
    }

    const stats = __getImageCacheStatsForTests();
    expect(stats.maxBytes).toBe(24 * 1024 * 1024);
    expect(stats.bytes).toBeLessThanOrEqual(stats.maxBytes);
    expect(stats.entries).toBe(8);

    const keys = __getImageCacheKeysForTests();
    expect(keys).not.toContain('qortium:big0');
    expect(keys).toContain('qortium:big1');
    expect(keys).toContain('qortium:big8');
  });
});
