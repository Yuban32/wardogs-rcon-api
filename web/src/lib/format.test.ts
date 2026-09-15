/**
 * The error mapping is what keeps a 412 from looking like a 401, so it is worth
 * pinning down: each case below is a different thing for the operator to do.
 */

import {
  WardogsHttpError,
  WardogsNetworkError,
  WardogsParseError,
  WardogsTimeoutError,
} from '@wardogs/api';
import { describe, expect, it } from 'vitest';

import { byteLength, describeError, formatBytes, formatDuration, stringify } from './format';

function httpError(status: number, code = `http_${status}`): WardogsHttpError {
  return new WardogsHttpError(`POST https://h:7776/v1/config failed: HTTP ${status}`, {
    status,
    code,
    body: undefined,
    method: 'POST',
    url: 'https://h:7776/v1/config',
  });
}

describe('formatBytes', () => {
  it('scales', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 kB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.00 MB');
  });
});

describe('formatDuration', () => {
  it('switches to seconds past a thousand milliseconds', () => {
    expect(formatDuration(240)).toBe('240 ms');
    expect(formatDuration(1500)).toBe('1.50 s');
  });
});

describe('stringify', () => {
  it('says so rather than printing nothing for an empty body', () => {
    expect(stringify(undefined)).toBe('(no content)');
  });

  it('pretty-prints', () => {
    expect(stringify({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});

describe('byteLength', () => {
  it('counts bytes, not code units', () => {
    expect(byteLength('abc')).toBe(3);
    expect(byteLength('é')).toBe(2);
  });
});

describe('describeError', () => {
  it('offers the documented recovery for a stale config revision', () => {
    const view = describeError(httpError(412, 'revision_mismatch'));
    expect(view.title).toBe('HTTP 412 · revision_mismatch');
    expect(view.hint).toMatch(/Re-read the config/);
  });

  it('does not confuse a rejected token with a stale revision', () => {
    const view = describeError(httpError(401, 'unauthorized'));
    expect(view.hint).toMatch(/token was rejected/);
  });

  it('names the transport failures by what they are', () => {
    expect(describeError(new WardogsTimeoutError('timed out', { timeoutMs: 15000 })).title).toBe(
      'Timed out',
    );
    expect(describeError(new WardogsNetworkError('no response')).title).toBe('No response');
    expect(describeError(new WardogsParseError('bad json', { body: '<html>' })).title).toBe(
      'Unparseable response',
    );
  });

  it('explains a bare TypeError, which is what a blocked request looks like', () => {
    // A request the browser refused never reaches the library, so there is no
    // status, no code and no response — only this.
    const view = describeError(new TypeError('Failed to fetch'));
    expect(view.title).toBe('The browser blocked the request');
    expect(view.hint).toMatch(/CORS/);
  });

  it('survives a thrown non-Error', () => {
    expect(describeError('something went wrong').detail).toBe('something went wrong');
  });
});
