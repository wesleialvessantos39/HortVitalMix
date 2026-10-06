import {test,expect} from '@playwright/test';
test.use({ isMobile: true, hasTouch: true });
for(const role of ['consumer','producer','platform_admin','platform_super_admin'])test('iPhone viewport and touch: '+role,async({page})=>{
 let logged=false;
 await page.route('**/*',async r=>{const u=new URL(r.request().url());if(!u.pathname.includes('/v1/'))return r.continue();const path=u.pathname.replace(/^\/(api|_hvm_api)/,'');
 const json=(body:unknown,status=200)=>r.fulfill({status,json:body});
 if(path==='/v1/auth/session')return logged?json({userId:'11111111-1111-4111-8111-111111111111',email:'person@example.com',fullName:'Pessoa',roles:[role],activeRole:role,portalKind:role.startsWith('platform_')?'administrative':'public'}):json({error:'SESSION_REQUIRED'},401);
 if(path==='/v1/admin/auth/verify-session')return json({authorized:true,role,sectors:['document_verification'],requiresReauth:false});
 if(path==='/v1/admin/users')return json({users:[]});
 if(path.includes('properties'))return json({properties:[]});
 if(path==='/v1/account/addresses')return json({addresses:[]});
 if(path==='/v1/account/profile')return json({fullName:'Pessoa',email:'person@example.com',revision:1});
 if(path==='/v1/config')return json({platformName:'HortiVitalMix',slogan:'Tudo fresco.',defaultMunicipality:'Ariquemes',defaultState:'RO',currency:'BRL',timezone:'America/Porto_Velho',supportEmail:'support@example.com',supportPhone:null,revision:1});
 return json({});});
 const login=role==='consumer'?'/entrar/consumidor':role==='producer'?'/entrar/produtor':role==='platform_admin'?'/entrar/administrador':'/entrar/super-administrador';
 for(const viewport of [{width:375,height:812},{width:390,height:844},{width:430,height:932},{width:844,height:390}]){
 await page.setViewportSize(viewport);logged=false;await page.goto(login);await expect(page.locator('input[type="email"]')).toBeVisible();
 expect(await page.locator('input[type="email"]').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 logged=true;const path=role.startsWith('platform_')?'/admin/usuarios':role==='producer'?'/produtor/propriedades/novo':'/conta';
 await page.goto(path);await expect(page.locator('h1').first()).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if(viewport.width===390)await page.screenshot({path:'/tmp/iphone-'+role+'.png',fullPage:true});
 }
});
