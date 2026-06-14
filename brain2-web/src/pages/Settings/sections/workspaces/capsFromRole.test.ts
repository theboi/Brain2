import { describe, it, expect } from 'vitest';
import { capsFromRole } from './mockData';

describe('capsFromRole', () => {
  it('owner can do everything', () => {
    const c = capsFromRole('owner');
    expect(c).toEqual({
      canManageMembers: true,
      canManageVaults: true,
      canMoveVaults: true,
      canAddAdmins: true,
      canDelete: true,
      readOnly: false,
    });
  });

  it('admin manages members and vaults but cannot add admins or delete', () => {
    const c = capsFromRole('admin');
    expect(c.canManageMembers).toBe(true);
    expect(c.canManageVaults).toBe(true);
    expect(c.canMoveVaults).toBe(true);
    expect(c.canAddAdmins).toBe(false);
    expect(c.canDelete).toBe(false);
    expect(c.readOnly).toBe(false);
  });

  it('member is read-only', () => {
    const c = capsFromRole('member');
    expect(c).toEqual({
      canManageMembers: false,
      canManageVaults: false,
      canMoveVaults: false,
      canAddAdmins: false,
      canDelete: false,
      readOnly: true,
    });
  });
});
