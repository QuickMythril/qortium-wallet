import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useAssetImageUrl,
  __resetAssetImageUrlCacheForTests,
  __getInFlightCountsForTests,
} from '../useAssetImageUrl';

beforeEach(() => {
  __resetAssetImageUrlCacheForTests();
});

afterEach(() => {
  delete (globalThis as any).qdnRequest;
  delete (globalThis as any).qortalRequest;
  __resetAssetImageUrlCacheForTests();
});

describe('useAssetImageUrl', () => {
  it('resolves a Qortium asset through qdnRequest with the exact IMAGE coordinate, never qortalRequest', async () => {
    const qortalRequestMock = vi.fn();
    (globalThis as any).qortalRequest = qortalRequestMock;

    const qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_PRIMARY_NAME') return 'chip-issuer';
      if (opts.action === 'GET_QDN_RESOURCE_URL') {
        expect(opts).toMatchObject({
          action: 'GET_QDN_RESOURCE_URL',
          service: 'IMAGE',
          name: 'chip-issuer',
          identifier: 'asset2_CHIP_aavatar',
        });
        return '/render/IMAGE/chip-issuer/asset2_CHIP_aavatar';
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
      expect(result.current.url).toBe(
        `${window.location.origin}/render/IMAGE/chip-issuer/asset2_CHIP_aavatar`
      )
    );
    expect(result.current.issuerName).toBe('chip-issuer');
    expect(
      qdnRequestMock.mock.calls.some(
        ([opts]) => opts.action === 'GET_PRIMARY_NAME'
      )
    ).toBe(true);
    expect(qortalRequestMock).not.toHaveBeenCalled();
  });

  it('resolves a Qortal asset through qortalRequest with the exact IMAGE coordinate, never qdnRequest', async () => {
    const qdnRequestMock = vi.fn();
    (globalThis as any).qdnRequest = qdnRequestMock;

    const qortalRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_PRIMARY_NAME') return 'silver-issuer';
      if (opts.action === 'GET_QDN_RESOURCE_URL') {
        expect(opts).toMatchObject({
          action: 'GET_QDN_RESOURCE_URL',
          service: 'IMAGE',
          name: 'silver-issuer',
          identifier: 'asset11_QORTAL-SILVER_aavatar',
        });
        return '/render/IMAGE/silver-issuer/asset11_QORTAL-SILVER_aavatar';
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
      expect(result.current.url).toBe(
        `${window.location.origin}/render/IMAGE/silver-issuer/asset11_QORTAL-SILVER_aavatar`
      )
    );
    expect(qdnRequestMock).not.toHaveBeenCalled();
  });

  it('falls back to GET_ACCOUNT_NAMES when GET_PRIMARY_NAME resolves no name', async () => {
    const qortalRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_PRIMARY_NAME') return '';
      if (opts.action === 'GET_ACCOUNT_NAMES') {
        return [{ name: 'fallback-issuer', owner: 'QissuerAddress' }];
      }
      if (opts.action === 'GET_QDN_RESOURCE_URL') {
        expect(opts).toMatchObject({ name: 'fallback-issuer' });
        return '/render/IMAGE/fallback-issuer/asset3_SMPL_aavatar';
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
    expect(result.current.url).toBe(
      `${window.location.origin}/render/IMAGE/fallback-issuer/asset3_SMPL_aavatar`
    );
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
      if (opts.action === 'GET_QDN_RESOURCE_URL') {
        if (opts.name === 'gold-issuer') {
          return Promise.reject(new Error('not published'));
        }
        expect(opts).toMatchObject({
          name: 'Q-Assets',
          identifier: 'assetAvatar_default',
        });
        return '/render/IMAGE/Q-Assets/assetAvatar_default';
      }
      throw new Error(`unexpected action: ${opts.action}`);
    });
    (globalThis as any).qortalRequest = qortalRequestMock;

    const { result } = renderHook(() =>
      useAssetImageUrl('qortal', {
        assetId: 21,
        name: 'QORTAL-GOLD',
        owner: 'QissuerAddress',
      })
    );

    await waitFor(() =>
      expect(result.current.url).toBe(
        `${window.location.origin}/render/IMAGE/Q-Assets/assetAvatar_default`
      )
    );
  });

  it('never falls back to the Q-Assets default avatar on Qortium', async () => {
    const qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_PRIMARY_NAME') return 'chip-issuer';
      if (opts.action === 'GET_QDN_RESOURCE_URL') {
        return Promise.reject(new Error('not published'));
      }
      throw new Error(`unexpected action: ${opts.action}`);
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
      expect(
        qdnRequestMock.mock.calls.filter(
          ([opts]) => opts.action === 'GET_QDN_RESOURCE_URL'
        )
      ).toHaveLength(1)
    );

    expect(result.current.url).toBeNull();
    expect(
      qdnRequestMock.mock.calls.some(([opts]) => opts.name === 'Q-Assets')
    ).toBe(false);
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
      if (opts.action === 'GET_QDN_RESOURCE_URL')
        return '/render/IMAGE/tium-issuer/asset1_TIUM_aavatar';
      throw new Error(`unexpected: ${opts.action}`);
    });

    const second = renderHook(() => useAssetImageUrl('qortium', asset));
    await waitFor(() =>
      expect(second.result.current.url).toBe(
        `${window.location.origin}/render/IMAGE/tium-issuer/asset1_TIUM_aavatar`
      )
    );
  });

  it('caches a resolved image URL - a second mount for the same asset makes no further requests', async () => {
    const qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_PRIMARY_NAME') return 'chip-issuer';
      if (opts.action === 'GET_QDN_RESOURCE_URL')
        return '/render/IMAGE/chip-issuer/asset2_CHIP_aavatar';
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
      if (opts.action === 'GET_QDN_RESOURCE_URL') {
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
        ([opts]) => opts.action === 'GET_QDN_RESOURCE_URL'
      )
    ).toBe(false);
    expect(__getInFlightCountsForTests()).toEqual({ issuerName: 0, image: 0 });
  });

  it('never calls the bridge for a malformed identifier (embedded slash)', async () => {
    const qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_PRIMARY_NAME') return 'chip-issuer';
      if (opts.action === 'GET_QDN_RESOURCE_URL') {
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
        ([opts]) => opts.action === 'GET_QDN_RESOURCE_URL'
      )
    ).toBe(false);
    expect(__getInFlightCountsForTests()).toEqual({ issuerName: 0, image: 0 });
  });

  it('never calls the bridge for an over-length identifier (>64 bytes)', async () => {
    const qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_PRIMARY_NAME') return 'chip-issuer';
      if (opts.action === 'GET_QDN_RESOURCE_URL') {
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
        ([opts]) => opts.action === 'GET_QDN_RESOURCE_URL'
      )
    ).toBe(false);
    expect(__getInFlightCountsForTests()).toEqual({ issuerName: 0, image: 0 });
  });

  it('a malformed identifier still falls back to the Q-Assets default on Qortal', async () => {
    const qortalRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_PRIMARY_NAME') return 'gold-issuer';
      if (opts.action === 'GET_QDN_RESOURCE_URL') {
        expect(opts).toMatchObject({
          name: 'Q-Assets',
          identifier: 'assetAvatar_default',
        });
        return '/render/IMAGE/Q-Assets/assetAvatar_default';
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
      expect(result.current.url).toBe(
        `${window.location.origin}/render/IMAGE/Q-Assets/assetAvatar_default`
      )
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
        expect(result.current).toEqual({
          url: null,
          issuerName: null,
        })
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
        if (opts.action === 'GET_QDN_RESOURCE_URL')
          return '/render/IMAGE/tium-issuer/asset1_TIUM_aavatar';
        throw new Error(`unexpected: ${opts.action}`);
      }
    );

    const second = renderHook(() => useAssetImageUrl('qortium', asset));
    await waitFor(() =>
      expect(second.result.current.url).toBe(
        `${window.location.origin}/render/IMAGE/tium-issuer/asset1_TIUM_aavatar`
      )
    );
  });
});
