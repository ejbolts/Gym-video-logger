import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import {
  authErrorMessage,
  submitAuthForm,
  validateAuthForm,
  type AuthApi,
  type AuthFormValues,
} from './authForm';
import type { AuthConfig, User } from './types';

const user: User = {
  id: 'user-1',
  email: 'lifter@example.com',
  display_name: 'Lifter',
  is_admin: false,
  can_upload_videos: true,
  created_at: '2026-10-01T10:00:00Z',
};
const open: AuthConfig = { registration_open: true, invite_code_required: false };
const invited: AuthConfig = { registration_open: true, invite_code_required: true };
const values: AuthFormValues = {
  displayName: '  Lifter ',
  email: ' lifter@example.com ',
  password: 'correct horse battery',
  inviteCode: '',
};

function endpoints(overrides: Partial<AuthApi> = {}): AuthApi {
  return {
    login: vi.fn().mockResolvedValue(user),
    register: vi.fn().mockResolvedValue(user),
    ...overrides,
  };
}

describe('authErrorMessage', () => {
  it.each([
    ['invalid_credentials', 401, 'do not match'],
    ['too_many_attempts', 429, 'Too many attempts'],
    ['email_taken', 409, 'already exists'],
    ['registration_closed', 403, 'not being accepted'],
    ['setup_required', 403, 'not set up yet'],
    ['invalid_invite_code', 403, 'invite code is not valid'],
    ['invalid_password', 400, 'not correct'],
    ['account_disabled', 403, 'has been disabled'],
  ])('explains %s', (code, status, expected) => {
    expect(authErrorMessage(new ApiError('server text', code, status))).toContain(expected);
  });

  it('reports an unreachable server for network failures', () => {
    expect(authErrorMessage(new TypeError('Failed to fetch'))).toContain('Cannot reach the server');
    expect(authErrorMessage(new ApiError('offline'))).toContain('Cannot reach the server');
  });

  it('falls back to the server message for unknown client errors', () => {
    expect(authErrorMessage(new ApiError('Nope', 'something_else', 400))).toBe('Nope');
    expect(authErrorMessage(new ApiError('Boom', 'internal', 500))).toContain(
      'server had a problem',
    );
  });
});

describe('validateAuthForm', () => {
  it('only requires an email and password to sign in', () => {
    expect(validateAuthForm('sign-in', { ...values, password: 'short' }, open)).toEqual({});
    expect(validateAuthForm('sign-in', { ...values, email: 'nope', password: '' }, open)).toEqual({
      email: 'Enter a valid email address.',
      password: 'Enter your password.',
    });
  });

  it('enforces the ten character minimum, a name, and a required invite code', () => {
    expect(
      validateAuthForm(
        'create-account',
        { displayName: ' ', email: 'a@b.co', password: '123456789', inviteCode: '' },
        invited,
      ),
    ).toEqual({
      displayName: 'Enter a name to show in the app.',
      password: 'Use at least 10 characters.',
      inviteCode: 'Enter your invite code.',
    });
    expect(validateAuthForm('create-account', values, open)).toEqual({});
  });
});

describe('submitAuthForm', () => {
  it('signs in with the trimmed email and returns the user', async () => {
    const api = endpoints();

    const result = await submitAuthForm('sign-in', values, open, api);

    expect(result).toEqual({ ok: true, user });
    expect(api.login).toHaveBeenCalledWith({
      email: 'lifter@example.com',
      password: 'correct horse battery',
    });
    expect(api.register).not.toHaveBeenCalled();
  });

  it('registers with a null invite code when none was entered', async () => {
    const api = endpoints();

    await submitAuthForm('create-account', values, open, api);
    await submitAuthForm('create-account', { ...values, inviteCode: ' abc ' }, invited, api);

    expect(api.register).toHaveBeenNthCalledWith(1, {
      email: 'lifter@example.com',
      password: 'correct horse battery',
      display_name: 'Lifter',
      invite_code: null,
    });
    expect(api.register).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ invite_code: 'abc' }),
    );
  });

  it('does not call the server when validation fails', async () => {
    const api = endpoints();

    const result = await submitAuthForm(
      'create-account',
      { ...values, password: 'short' },
      open,
      api,
    );

    expect(result).toMatchObject({ ok: false, fieldErrors: { password: expect.any(String) } });
    expect(api.register).not.toHaveBeenCalled();
  });

  it('shows a friendly message for bad credentials and rate limiting', async () => {
    const bad = endpoints({
      login: vi.fn().mockRejectedValue(new ApiError('x', 'invalid_credentials', 401)),
    });
    const limited = endpoints({
      login: vi.fn().mockRejectedValue(new ApiError('x', 'too_many_attempts', 429)),
    });

    expect(await submitAuthForm('sign-in', values, open, bad)).toMatchObject({
      ok: false,
      message: expect.stringContaining('do not match'),
    });
    expect(await submitAuthForm('sign-in', values, open, limited)).toMatchObject({
      ok: false,
      message: expect.stringContaining('Too many attempts'),
    });
  });

  it('flags the email when taken and asks for an invite code when it is rejected', async () => {
    const taken = endpoints({
      register: vi.fn().mockRejectedValue(new ApiError('x', 'email_taken', 409)),
    });
    const rejected = endpoints({
      register: vi.fn().mockRejectedValue(new ApiError('x', 'invalid_invite_code', 403)),
    });

    expect(await submitAuthForm('create-account', values, open, taken)).toMatchObject({
      ok: false,
      fieldErrors: { email: expect.any(String) },
    });
    expect(await submitAuthForm('create-account', values, open, rejected)).toMatchObject({
      ok: false,
      needsInviteCode: true,
      fieldErrors: { inviteCode: expect.any(String) },
    });
  });
});
