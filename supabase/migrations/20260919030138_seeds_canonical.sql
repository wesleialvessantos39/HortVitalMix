-- HortiVitalMix v10 / Trilha 01. Errata autorizada em 2026-09-19.
INSERT INTO public.app_roles(code,name,description,is_public) VALUES
('consumer','Consumidor','Compra e recebe produtos na plataforma',true),
('producer','Produtor Rural','Produz, embala e comercializa alimentos',true),
('platform_admin','Administrador Setorial','Gerencia módulos operacionais em setor atribuído',false),
('platform_super_admin','Super Administrador','Controle irrestrito da plataforma',false)
ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,is_public=EXCLUDED.is_public;
INSERT INTO public.app_global_config(platform_name,slogan,default_municipality,default_state,currency,timezone,support_email) VALUES('HortiVitalMix','Tudo fresco. Tudo da sua região.','Ariquemes','RO','BRL','America/Porto_Velho','hortivitalmix@gmail.com') ON CONFLICT(singleton_guard) DO NOTHING;
