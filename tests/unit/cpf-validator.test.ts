import { describe, expect, it } from 'vitest';
import { isValidCPF } from '../../shared/contracts/auth';
describe('CPF',()=>{
  it('aceita CPF com DV válido',()=>expect(isValidCPF('52998224725')).toBe(true));
  it('rejeita DV inválido',()=>expect(isValidCPF('52998224724')).toBe(false));
  it('rejeita sequência repetida',()=>expect(isValidCPF('11111111111')).toBe(false));
});
