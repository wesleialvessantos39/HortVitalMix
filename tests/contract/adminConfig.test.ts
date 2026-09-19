import { describe, expect, it } from 'vitest';
import { UpdateGlobalConfigSchema } from '../../shared/contracts/adminConfig';
describe('UpdateGlobalConfigSchema',()=>{
  it('aceita revisão + commandId + payload permitido',()=>expect(UpdateGlobalConfigSchema.safeParse({expectedRevision:1,commandId:'00000000-0000-4000-8000-000000000001',payload:{slogan:'Slogan válido'}}).success).toBe(true));
  it('rejeita campo administrativo extra',()=>expect(UpdateGlobalConfigSchema.safeParse({expectedRevision:1,commandId:'00000000-0000-4000-8000-000000000001',payload:{trustLevel:5}}).success).toBe(false));
});
