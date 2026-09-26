import { expect, test, type Page } from '@playwright/test';

async function mockPortal(page: Page, role: string, initiallyLogged = true) {
  let logged = initiallyLogged;
  let transient = false;
  let logoutCalls = 0;
  const session = { userId: '11111111-1111-4111-8111-111111111111', email: 'teste@example.com', fullName: 'Pessoa de Teste', roles: [role], activeRole: role, portalKind: role.startsWith('platform_') ? 'administrative' : 'public' };
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'tile.openstreetmap.org') return route.fulfill({ status: 204 });
    if (!url.pathname.includes('/v1/')) return route.continue();
    const path = url.pathname.replace(/^\/(?:api|_hvm_api)/, '');
    const json = (body: unknown, status=200) => route.fulfill({status, contentType:'application/json',body:JSON.stringify(body)});
    if (path === '/v1/auth/session') return transient ? json({error:'DEPENDENCY_UNAVAILABLE'},503) : logged ? json(session) : json({error:'SESSION_REQUIRED'},401);
    if (path === '/v1/auth/login') {
      expect(route.request().postDataJSON()).toMatchObject({portalRole:role,email:session.email,password:'SenhaTeste#2026'});
      logged=true; return json({...session,status:'authenticated'});
    }
    if (path === '/v1/auth/logout') { logged=false; logoutCalls++; return json({status:'signed_out'}); }
    if (path === '/v1/admin/auth/verify-session') return logged ? json({authorized:true,role,sectors:[],requiresReauth:false}) : json({error:'UNAUTHORIZED'},401);
    if (path === '/v1/account/addresses') return json({addresses:[]});
    if (path === '/v1/account/profile') return json({fullName:session.fullName,email:session.email,cpfMasked:'***.***.123-45',phone:'+5569999999999',revision:1});
    if (path === '/v1/config') return json({platformName:'HortiVitalMix',slogan:'Tudo fresco.',defaultMunicipality:'Ariquemes',defaultState:'RO',currency:'BRL',timezone:'America/Porto_Velho',supportEmail:'suporte@example.com',supportPhone:null,revision:1});
    return json({});
  });
  return { outage:()=>{transient=true;}, logoutCount:()=>logoutCalls };
}

for (const role of ['platform_admin','platform_super_admin']) for (const width of [360,1440]) {
  test(`marca e endereços administrativos: ${role} ${width}`,async({page})=>{
    const mocked=await mockPortal(page,role);
    await page.setViewportSize({width,height:900});
    await page.goto('/admin/conta/enderecos');
    await expect(page.getByRole('heading',{name:'Endereços administrativos',level:2})).toBeVisible();
    await page.getByRole('button',{name:'Adicionar um endereço'}).click();
    await expect(page.getByText('Contato administrativo',{exact:true})).toBeVisible();
    await expect(page.getByLabel('Referências e orientações de acesso')).toBeVisible();
    await expect(page.locator('.account-sheet')).not.toContainText(/entrega/i);
    await page.getByRole('button',{name:'Fechar',exact:true}).click();
    await page.locator(width<768?'.admin-mobile-bar .admin-brand':'.admin-sidebar .admin-brand').click();
    await expect(page).toHaveURL(/\/admin\/painel$/);
    await expect(page.locator('.admin-action-grid')).toBeVisible();
    expect(mocked.logoutCount()).toBe(0);
    await page.locator(width<768?'.admin-mobile-bar .admin-brand':'.admin-sidebar .admin-brand').click();
    await expect(page.locator('.admin-action-grid')).toBeVisible();
    expect(mocked.logoutCount()).toBe(0);
    await page.locator(width<768?'.admin-mobile-bar .admin-logout':'.admin-sidebar .admin-logout').click();
    await expect(page).toHaveURL(/\/admin\/entrar$/);
    expect(mocked.logoutCount()).toBe(1);
  });
}
for(const role of ['consumer','producer'] as const) {
  for(const width of [320,1440]) test(`login público com layout completo: ${role} ${width}`,async({page})=>{
    await mockPortal(page,role,false);
    await page.setViewportSize({width,height:900});
    await page.goto(role==='producer'?'/entrar/produtor':'/entrar/consumidor');
    await expect(page.locator('.admin-login-copy')).toBeVisible();
    await expect(page.getByLabel('E-mail')).toBeVisible();
    await expect(page.getByLabel('Senha',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Esqueci minha senha'})).toBeVisible();
    await expect(page.getByRole('button',{name:'Reenviar confirmação'})).toBeVisible();
    await expect(page.getByRole('button',{name:/Criar cadastro de/})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`test-results/login-${role}-${width}.png`,fullPage:true});
  });
  test(`sessão persiste na navegação e cadastro só reaparece ao sair: ${role}`,async({page})=>{
    const mocked=await mockPortal(page,role,false);
    await page.goto(role==='producer'?'/entrar/produtor':'/entrar/consumidor');
    await page.getByLabel('E-mail').fill('teste@example.com');
    await page.getByLabel('Senha',{exact:true}).fill('SenhaTeste#2026');
    await page.getByRole('button',{name:'Entrar',exact:true}).click();
    await expect(page).toHaveURL(/\/conta$/);
    for(const path of ['/','/produtos','/planos','/entrar','/cadastro','/cadastro/produtor','/cadastro/consumidor']) {
      await page.goto(path);
      if(path.startsWith('/cadastro')||path==='/entrar') await expect(page).toHaveURL(/\/conta$/);
      else await expect(page.getByRole('link',{name:'Início',exact:true}).first()).toBeVisible();
      await expect(page.getByRole('button',{name:/Entrar|cadastro|Faça parte/i})).toHaveCount(0);
    }
    mocked.outage();
    await page.evaluate(()=>window.dispatchEvent(new Event('hvm:session-changed')));
    await expect(page.locator('.account-hub')).toBeVisible();
    await page.getByRole('button',{name:'Segurança e sair da conta'}).click();
    await page.getByRole('button',{name:'Sair da conta',exact:true}).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('button',{name:/Conheça as opções de cadastro/})).toBeVisible();
    expect(mocked.logoutCount()).toBe(1);
  });
}
