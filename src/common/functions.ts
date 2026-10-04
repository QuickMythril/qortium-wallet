import { walletRequestValue } from './walletRequest';
import { EMPTY_STRING, ONE_SPACE } from './constants';

export function requestQdn(options: QdnRequestOptions): Promise<any> {
  return qdnRequest(
    walletRequestValue(
      options as Record<string, unknown> & { action: string }
    ) as QdnRequestOptions
  );
}

export function requestWithTimeout(
  options: QdnRequestOptions,
  timeoutMs: number
): Promise<any> {
  return Promise.race([
    requestQdn(options),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), timeoutMs)
    ),
  ]);
}

const timeSegments = [
  3.154e10,
  2.628e9,
  6.048e8,
  8.64e7,
  3.6e6,
  60000,
  -Infinity,
];

const makeTimeString =
  (unit: string, singularString: string) =>
  (timeSegment: number, time: number) =>
    time >= 2 * timeSegment
      ? `${Math.floor(time / timeSegment)} ${unit}s ago`
      : singularString;

const timeFunctions = [
  makeTimeString('year', '1 year ago'),
  makeTimeString('month', '1 month ago'),
  makeTimeString('week', '1 week ago'),
  makeTimeString('day', '1 day ago'),
  makeTimeString('hour', 'an hour ago'),
  makeTimeString('minute', 'a minute ago'),
  () => 'just now',
];

export function epochToAgo(epoch: number) {
  const timeDifference = Date.now() - epoch;
  const index = timeSegments.findIndex((time) => timeDifference >= time);
  const timeAgo = timeFunctions[index](timeSegments[index], timeDifference);
  return timeAgo;
}

export function secondsToDhms(seconds: number) {
  seconds = Number(seconds);

  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  const dDisplay = d > 0 ? d + (d == 1 ? 'd ' : 'd ') : EMPTY_STRING;
  const hDisplay = h > 0 ? h + (h == 1 ? 'h ' : 'h ') : EMPTY_STRING;
  const mDisplay = m > 0 ? m + (m == 1 ? 'm ' : 'm ') : EMPTY_STRING;
  const sDisplay = s > 0 ? s + (s == 1 ? 's' : 's') : EMPTY_STRING;

  return dDisplay + hDisplay + mDisplay + sDisplay;
}

export function timeoutDelay(delay: number) {
  return new Promise((res) => setTimeout(res, delay));
}

export function cropString(str: string, max_length: number = 24) {
  const one_third: number = max_length / 3;
  return str.length > max_length
    ? str.substring(0, one_third) +
        '...' +
        str.substring(str.length - one_third)
    : str;
}

export function humanFileSize(
  bytes: number,
  si: boolean = false,
  dp: number = 1
): string {
  const thresh = si ? 1000 : 1024;

  if (Math.abs(bytes) < thresh) {
    return bytes + ' B';
  }

  const units = si
    ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
    : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
  let u = -1;
  const r = 10 ** dp;

  do {
    bytes /= thresh;
    ++u;
  } while (
    Math.round(Math.abs(bytes) * r) / r >= thresh &&
    u < units.length - 1
  );

  return bytes.toFixed(dp) + ONE_SPACE + units[u];
}

export function formatFiat(value: number, currency: string): string {
  const cur = currency.toUpperCase();
  // Sub-cent values round to 0.00 at standard 2dp, hiding real dust/meme-coin
  // prices. Extend precision to show ~2 significant digits instead, capped so
  // near-zero dust doesn't produce an absurdly long string.
  const decimals =
    value > 0 && value < 0.01
      ? Math.min(8, Math.max(2, -Math.floor(Math.log10(value)) + 1))
      : 2;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: cur,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  } catch {
    return `${cur} ${value.toFixed(decimals)}`;
  }
}

export async function copyToClipboard(text: string): Promise<void> {
  // Try modern clipboard API first
  let processed: boolean = false;
  try {
    await navigator.clipboard.writeText(text);
    processed = true;
  } catch (error) {
    console.error(error);
  }
  if (processed) return;

  console.info('Using clipboard legacy fallback');

  // Fallback for older browsers or non-HTTPS contexts
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  textArea.style.top = '-999999px';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    const successful = document.execCommand('copy');
    if (!successful) {
      throw new Error('execCommand copy failed');
    }
  } catch (error) {
    console.error(error);
  } finally {
    document.body.removeChild(textArea);
  }
}
