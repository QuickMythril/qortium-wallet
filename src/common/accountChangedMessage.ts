// Home's selected-account change notification, shared by every listener.
//
// Home (electron/qdn-views.ts, getQdnSelectedAccountChangedMessage) posts
// `{ action: 'SELECTED_ACCOUNT_CHANGED', requestedHandler: 'ACCOUNT',
// type: 'qortium:selected-account-changed' }` as a window `message` event on
// page load, on account switch, and on lock/unlock of the selected account.
// The payload carries no lock state, so listeners must re-read whatever they
// derive from the account rather than infer a direction from the message.

export const SELECTED_ACCOUNT_CHANGED_ACTION = 'SELECTED_ACCOUNT_CHANGED';
export const SELECTED_ACCOUNT_CHANGED_TYPE = 'qortium:selected-account-changed';

export function isSelectedAccountChangedMessage(
  event: MessageEvent<unknown>
): boolean {
  if (event.source !== window.parent && event.source !== window) return false;
  const data = event.data;
  if (typeof data !== 'object' || data === null) return false;
  // Home fires action:'SELECTED_ACCOUNT_CHANGED'; also accept the
  // type:'qortium:selected-account-changed' field defensively in case a host
  // sends only that field.
  return (
    (data as { action?: unknown }).action === SELECTED_ACCOUNT_CHANGED_ACTION ||
    (data as { type?: unknown }).type === SELECTED_ACCOUNT_CHANGED_TYPE
  );
}
