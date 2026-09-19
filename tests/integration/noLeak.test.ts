import { expect } from 'vitest';
import { reportFailure } from '../../server/config/reportFailure';
import { captureLogs } from '../helpers/logCapture';
import { integrationDescribe, integrationIt } from '../helpers/integration';

integrationDescribe('Não vazamento de segredos em logs',()=>{
  integrationIt('reportFailure redige DB URL completa',()=>{
    const capture=captureLogs();
    try{
      const dbUrl=process.env.SUPABASE_DB_URL!;
      reportFailure({category:'db_unavailable',detail:`Failed to connect to ${dbUrl}`});
      expect(capture.hasSensitiveData().found).toBe(false);
      expect(capture.logs.stderr.join('\n')).toContain('[REDACTED]');
    }finally{capture.restore();}
  });

  integrationIt('reportFailure redige service role key',()=>{
    const capture=captureLogs();
    try{
      const key=process.env.SUPABASE_SERVICE_ROLE_KEY!;
      reportFailure({category:'unknown',detail:`SUPABASE_SERVICE_ROLE_KEY=${key}`});
      expect(capture.hasSensitiveData().found).toBe(false);
      expect(capture.logs.stderr.join('\n')).toContain('[REDACTED]');
    }finally{capture.restore();}
  });

  integrationIt('bundle do cliente não contém service_role',async()=>{
    const {execSync}=await import('child_process');
    try{execSync('npm run build',{stdio:'pipe'});}catch{return;}
    const {readdirSync,readFileSync}=await import('fs');
    const {join}=await import('path');
    const assetsDir=join(process.cwd(),'dist','assets');
    let found=false;
    try{
      for(const file of readdirSync(assetsDir)){
        if(!file.endsWith('.js'))continue;
        const content=readFileSync(join(assetsDir,file),'utf8');
        if(content.includes('service_role')||content.includes('SUPABASE_SERVICE_ROLE_KEY')){found=true;break;}
      }
    }catch{return;}
    expect(found).toBe(false);
  });
});
