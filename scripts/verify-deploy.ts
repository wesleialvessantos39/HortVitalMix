function readArg(name:string):string|undefined {
  const args=process.argv.slice(2);
  const equals=args.find((value)=>value.startsWith(`--${name}=`));
  if(equals)return equals.slice(name.length+3);
  const index=args.indexOf(`--${name}`);
  return index>=0?args[index+1]:undefined;
}

const base=readArg('url') ?? process.env.APP_URL ?? process.argv.find((v,i)=>i>1&&!v.startsWith('--'));
const expectedSha=readArg('sha');
const expectedSchema=Number(readArg('schema') ?? 8);
if(!base){console.error('Uso: npm run verify:deploy -- --url=<deployment> --sha=<40hex> [--schema=8]');process.exit(1)}

let failures=0;
async function json(path:string){
  const response=await fetch(new URL(path,base));
  let body:unknown=null;
  try{body=await response.json()}catch{body=null}
  return {response,body:body as Record<string,unknown>|null};
}

const health=await json('/api/health');
console.log('/api/health',health.response.status,health.body?.status);
if(health.response.status!==200||health.body?.status!=='ok')failures++;

const ready=await json('/api/ready');
console.log('/api/ready',ready.response.status,ready.body?.status,ready.body?.schemaVersion);
if(ready.response.status!==200||ready.body?.databaseConnected!==true||ready.body?.schemaVersion!==expectedSchema)failures++;
if(expectedSha){
  const short=expectedSha.slice(0,7);
  const tag=String(ready.body?.releaseTag??'');
  if(!tag.includes(short)&&!tag.includes(expectedSha)){console.error(`/api/ready releaseTag não contém SHA esperado ${short}`);failures++;}
}

const config=await json('/api/v1/config');
console.log('/api/v1/config',config.response.status,config.body?.platformName,config.body?.revision);
if(config.response.status!==200||typeof config.body?.platformName!=='string'||Number(config.body?.revision)<1)failures++;

if(failures){console.error(`verify:deploy falhou: ${failures} item(ns).`);process.exit(1)}
console.log('verify:deploy: aprovado');
