import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { createApp } from './server/app';

function expressSameOrigin():Plugin{return{name:'hortivitalmix-express-same-origin',configureServer(server){server.middlewares.use(createApp())}}}
export default defineConfig(({mode})=>{const env=loadEnv(mode,process.cwd(),'');Object.assign(process.env,env);return{plugins:[react(),tailwindcss(),expressSameOrigin()],resolve:{alias:{'@':path.resolve(__dirname,'.')}},server:{port:3000,host:'0.0.0.0',hmr:process.env.DISABLE_HMR!=='true',watch:process.env.DISABLE_HMR==='true'?null:{}},build:{sourcemap:false}}});
