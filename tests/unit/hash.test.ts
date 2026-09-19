import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';

function hashIP(ip:string,pepper:string):string{
  return createHash('sha256').update(ip+pepper).digest('hex');
}

describe('Hash de IP',()=>{
  it('produz 64 caracteres hexadecimais',()=>expect(hashIP('192.168.1.1','pepper-secreto-32chars-minimo-ok')).toMatch(/^[0-9a-f]{64}$/));
  it('varia por IP',()=>expect(hashIP('192.168.1.1','pepper')).not.toBe(hashIP('192.168.1.2','pepper')));
  it('varia por pepper',()=>expect(hashIP('192.168.1.1','pepper-A')).not.toBe(hashIP('192.168.1.1','pepper-B')));
  it('é determinístico',()=>expect(hashIP('10.0.0.1','fixo')).toBe(hashIP('10.0.0.1','fixo')));
});
