import { describe, expect, it } from 'vitest';
import {
  isSelectedAccountChangedMessage,
  SELECTED_ACCOUNT_CHANGED_ACTION,
  SELECTED_ACCOUNT_CHANGED_TYPE,
} from '../accountChangedMessage';

const homeMessage = {
  action: SELECTED_ACCOUNT_CHANGED_ACTION,
  requestedHandler: 'ACCOUNT',
  type: SELECTED_ACCOUNT_CHANGED_TYPE,
};

function message(data: unknown, source: MessageEventSource | null = window) {
  return new MessageEvent('message', { data, source });
}

describe('isSelectedAccountChangedMessage', () => {
  it('accepts the exact message Home posts on lock, unlock, switch and load', () => {
    expect(isSelectedAccountChangedMessage(message(homeMessage))).toBe(true);
  });

  it('accepts either the action or the type field on its own', () => {
    expect(
      isSelectedAccountChangedMessage(
        message({ action: SELECTED_ACCOUNT_CHANGED_ACTION })
      )
    ).toBe(true);
    expect(
      isSelectedAccountChangedMessage(
        message({ type: SELECTED_ACCOUNT_CHANGED_TYPE })
      )
    ).toBe(true);
  });

  it('ignores messages from a source other than the host window', () => {
    expect(isSelectedAccountChangedMessage(message(homeMessage, null))).toBe(
      false
    );
    const port = new MessageChannel().port1;
    expect(isSelectedAccountChangedMessage(message(homeMessage, port))).toBe(
      false
    );
  });

  it('ignores other bridge messages and malformed payloads', () => {
    expect(
      isSelectedAccountChangedMessage(
        message({ action: 'UI_STYLE_CHANGED', requestedHandler: 'UI' })
      )
    ).toBe(false);
    expect(isSelectedAccountChangedMessage(message(null))).toBe(false);
    expect(
      isSelectedAccountChangedMessage(message(SELECTED_ACCOUNT_CHANGED_ACTION))
    ).toBe(false);
    expect(isSelectedAccountChangedMessage(message({}))).toBe(false);
  });
});
