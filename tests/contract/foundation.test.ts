import { describe,it,expect } from 'vitest';
import { GlobalConfigPublicSchema } from '../../shared/contracts/foundation';
describe('GlobalConfigPublicSchema',()=>{it('aceita configuração canônica',()=>expect(GlobalConfigPublicSchema.safeParse({platformName:'HortiVitalMix',slogan:'Tudo fresco. Tudo da sua região.',defaultMunicipality:'Ariquemes',defaultState:'RO',currency:'BRL',timezone:'America/Porto_Velho',supportEmail:'hortivitalmix@gmail.com',supportPhone:null,revision:1}).success).toBe(true));});
