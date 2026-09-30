import { expect, test } from '@playwright/test';
for (const role of ['platform_admin','platform_super_admin']) {
 test(`${role}: password login opens dashboard without another session round trip`,async({page})=>{
  let verificationCalls=0;
  await page.route('**/*',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(!path.includes('/v1/'))return route.continue();
   let body:unknown={},status=200;
   if(path.endsWith('/account/profile'))body={fullName:'Weslei Alves Santos'};
   else if(path.endsWith('/admin/auth/login'))body={status:'session_created',role,sectors:[]};
   else if(path.endsWith('/admin/auth/verify-session')){verificationCalls++;body={authorized:true,role,sectors:[],requiresReauth:false};}
   else if(path.endsWith('/auth/session')){status=401;body={error:'SESSION_REQUIRED'};}
   else if(path.endsWith('/bootstrap/status'))body={status:'closed'};
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto(role==='platform_admin'?'/entrar/administrador':'/entrar/super-administrador');
  await page.getByLabel('E-mail',{exact:true}).fill('fixture@example.invalid');
  await page.getByLabel('Senha',{exact:true}).fill('fixture-password');
  await page.getByRole('button',{name:/^Entrar como/}).click();
  await expect(page.getByRole('heading',{name:/Bom dia, Weslei Alves Santos|Boa tarde, Weslei Alves Santos|Boa noite, Weslei Alves Santos/})).toBeVisible();
  expect(verificationCalls).toBe(0);
  await expect(page.getByText('Segundo fator do Super administrador')).toHaveCount(0);
 });
 test(`${role}: refresh spins only while the request is pending`,async({page})=>{
  let requests=0;let complete:()=>void=()=>{};
  const pending=new Promise<void>(resolve=>{complete=resolve});
  await page.route('**/*',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(!path.includes('/v1/'))return route.continue();
   let body:unknown={},status=200;
   if(path.endsWith('/admin/auth/verify-session'))body={authorized:true,role,sectors:[],requiresReauth:false};
   else if(path.endsWith('/admin/users')){requests++;if(requests>1)await pending;body={users:[]};}
   else if(path.endsWith('/auth/session')){status=401;body={error:'SESSION_REQUIRED'};}
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto('/admin/usuarios');
  const button=page.getByRole('button',{name:'Atualizar',exact:true});
  await expect(button).toBeEnabled();await button.click();
  const loading=page.getByRole('button',{name:'Atualizando…',exact:true});
  await expect(loading).toBeDisabled();
  await expect(loading.locator('svg')).toHaveClass(/hvm-sync-spinning/);
  complete();await expect(button).toBeEnabled();
  await expect(button.locator('svg')).not.toHaveClass(/hvm-sync-spinning/);
 });
}
