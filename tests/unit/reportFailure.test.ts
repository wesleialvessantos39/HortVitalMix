import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifyDbError, reportFailure } from '../../server/config/reportFailure';

describe('reportFailure',()=>{
  let captured:string[]=[];
  const original=console.error;

  beforeEach(()=>{
    captured=[];
    console.error=(...args:unknown[])=>{captured.push(args.map(String).join(' '));};
  });

  afterEach(()=>{console.error=original;});

  it('redige connection string PostgreSQL',()=>{
    reportFailure({category:'db_unavailable',requestId:'00000000-0000-4000-8000-000000000001',detail:'connect failed: postgresql://postgres:senha@host:5432/db'});
    const log=captured.join('\n');
    expect(log).not.toContain('senha');
    expect(log).toContain('[REDACTED]');
  });

  it('redige JWT, CPF, email e telefone',()=>{
    reportFailure({
      category:'validation_error',
      detail:'Bearer eyJabc.def.ghi CPF 529.982.247-25 user@example.com +55 (69) 99999-9999',
    });
    const log=captured.join('\n');
    expect(log).not.toContain('529.982.247-25');
    expect(log).not.toContain('user@example.com');
    expect(log).not.toContain('99999-9999');
    expect(log).not.toContain('eyJabc');
  });
});

describe('classifyDbError',()=>{
  it('classifica rede',()=>expect(classifyDbError({code:'ENOTFOUND'})).toBe('db_unavailable'));
  it('classifica migration ausente',()=>expect(classifyDbError({code:'42P01'})).toBe('db_migration_missing'));
  it('classifica conflito',()=>expect(classifyDbError({code:'23505'})).toBe('conflict'));
  it('classifica autorização',()=>expect(classifyDbError({code:'42501'})).toBe('authorization_denied'));
  it('usa unknown no restante',()=>{expect(classifyDbError(new Error('x'))).toBe('unknown');expect(classifyDbError(null)).toBe('unknown');});
});
