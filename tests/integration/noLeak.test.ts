import { expect } from 'vitest';
import { reportFailure } from '../../server/config/reportFailure';
import { captureConsole, hasSensitiveData } from '../helpers/logCapture';
import { integrationDescribe, integrationIt } from '../helpers/integration';

integrationDescribe('não vazamento',()=>{
  integrationIt('reportFailure não imprime connection string, JWT, CPF ou service role',async()=>{
    const capture=captureConsole();
    try{reportFailure('db_unavailable','00000000-0000-4000-8000-000000000001',new Error('postgresql://u:p@host/db service_role 52998224725 eyJabc.def.ghi'));}
    finally{capture.restore();}
    expect(hasSensitiveData(capture.lines).found).toBe(false);
  });
});
