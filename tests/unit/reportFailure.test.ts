import { describe,it,expect } from 'vitest';import { scrub } from '../../server/config/reportFailure';
describe('scrub',()=>{it('remove connection string e tokens',()=>{const s=JSON.stringify(scrub({message:'postgresql://u:p@host/db',authorization:'Bearer secret'}));expect(s).not.toContain('u:p');expect(s).not.toContain('Bearer secret')})});
