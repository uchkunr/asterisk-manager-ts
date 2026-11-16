import type { AmiResponse } from './types.js';

/** Base class for every error this library creates. */
export class AmiError extends Error {
  override name = 'AmiError';
}

/** The connection is missing, failed, or closed while a request was in flight. */
export class AmiConnectionError extends AmiError {
  override name = 'AmiConnectionError';
}

/** Nothing arrived within the timeout. An action that timed out may still have run. */
export class AmiTimeoutError extends AmiError {
  override name = 'AmiTimeoutError';
  readonly action: string | undefined;
  readonly actionId: string | undefined;

  constructor(message: string, details: { action?: string; actionId?: string } = {}) {
    super(message);
    this.action = details.action;
    this.actionId = details.actionId;
  }
}

/** Asterisk answered with `Response: Error`. */
export class AmiActionError extends AmiError {
  override name = 'AmiActionError';
  readonly action: string;
  readonly response: AmiResponse;

  constructor(action: string, response: AmiResponse) {
    const message = typeof response.Message === 'string' ? response.Message : 'Unknown error';
    super(`${action} failed: ${message}`);
    this.action = action;
    this.response = response;
  }
}

/** Login was rejected (wrong username or secret, ACL, or MD5 challenge failure). */
export class AmiAuthError extends AmiError {
  override name = 'AmiAuthError';
  readonly response: AmiResponse | undefined;

  constructor(message: string, response?: AmiResponse) {
    super(message);
    this.response = response;
  }
}
