import { describe, expect, it } from 'vitest';
import { normalizeCPF } from '../../shared/contracts/auth';
describe('normalização',()=>{
  it('remove máscara de CPF',()=>expect(normalizeCPF('529.982.247-25')).toBe('52998224725'));
  it('é idempotente',()=>expect(normalizeCPF(normalizeCPF('529.982.247-25'))).toBe('52998224725'));
});
