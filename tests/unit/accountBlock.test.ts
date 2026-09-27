import {expect,it} from 'vitest';
import {effectiveAccountStatus,accountBlockCode} from '../../shared/accountBlock';
const start='2026-09-26T14:00:00Z', end='2026-10-26T14:00:00Z';
it('activates at the inclusive start and releases at the exclusive end',()=>{
 const row={status:'blocked',block_starts_at:start,block_ends_at:end};
 expect(effectiveAccountStatus(row,Date.parse(start)-1)).toBe('active');
 expect(effectiveAccountStatus(row,Date.parse(start))).toBe('blocked');
 expect(effectiveAccountStatus(row,Date.parse(end)-1)).toBe('blocked');
 expect(effectiveAccountStatus(row,Date.parse(end))).toBe('active');
});
it('keeps indefinite and legacy blocks blocked and preserves unrelated statuses',()=>{
 expect(effectiveAccountStatus({status:'blocked'},Date.parse(end))).toBe('blocked');
 expect(accountBlockCode({status:'blocked'})).toBe('ACCOUNT_BLOCKED_INDEFINITE');
 expect(effectiveAccountStatus({status:'suspended',block_ends_at:start},Date.parse(end))).toBe('suspended');
});
