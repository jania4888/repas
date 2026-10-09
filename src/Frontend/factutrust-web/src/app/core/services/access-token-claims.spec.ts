import {
  AccessTokenContext,
  isUserPayloadCoherentWithToken,
  readAccessTokenContext
} from './access-token-claims';

function makeToken(payload: Record<string, unknown>): string {
  const body = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `header.${body}.signature`;
}

const delegatedContext: AccessTokenContext = {
  accessMode: 'delegated',
  contextTenantId: '00000000-0000-0000-0000-000000000003'
};

describe('access-token-claims', () => {
  describe('readAccessTokenContext', () => {
    it('reads a delegated token', () => {
      const token = makeToken({
        access_mode: 'delegated',
        context_tenant_id: '00000000-0000-0000-0000-000000000003'
      });
      expect(readAccessTokenContext(token)).toEqual(delegatedContext);
    });

    it('reads a native token', () => {
      expect(readAccessTokenContext(makeToken({ access_mode: 'native' }))).toEqual({
        accessMode: 'native',
        contextTenantId: undefined
      });
    });

    it('returns null for an absent or unreadable token', () => {
      expect(readAccessTokenContext(null)).toBeNull();
      expect(readAccessTokenContext('')).toBeNull();
      expect(readAccessTokenContext('not-a-jwt')).toBeNull();
      expect(readAccessTokenContext('header.%%%.signature')).toBeNull();
    });
  });

  describe('isUserPayloadCoherentWithToken', () => {
    it('rejects a native payload while the token is delegated', () => {
      expect(isUserPayloadCoherentWithToken({ accessMode: 'native' }, delegatedContext)).toBe(false);
      expect(isUserPayloadCoherentWithToken({}, delegatedContext)).toBe(false);
    });

    it('rejects a payload pointing at another dossier', () => {
      const payload = {
        accessMode: 'delegated',
        contextTenantId: '00000000-0000-0000-0000-000000000099'
      };
      expect(isUserPayloadCoherentWithToken(payload, delegatedContext)).toBe(false);
    });

    it('accepts a payload that matches the token', () => {
      const payload = {
        accessMode: 'delegated',
        contextTenantId: '00000000-0000-0000-0000-000000000003'
      };
      expect(isUserPayloadCoherentWithToken(payload, delegatedContext)).toBe(true);
      expect(
        isUserPayloadCoherentWithToken({ accessMode: 'native' }, { accessMode: 'native' })
      ).toBe(true);
    });

    it('rejects a delegated payload while the token is native', () => {
      const payload = {
        accessMode: 'delegated',
        contextTenantId: '00000000-0000-0000-0000-000000000003'
      };
      expect(isUserPayloadCoherentWithToken(payload, { accessMode: 'native' })).toBe(false);
    });

    it('stays out of the way when the token cannot be read', () => {
      expect(isUserPayloadCoherentWithToken({ accessMode: 'native' }, null)).toBe(true);
    });
  });
});
