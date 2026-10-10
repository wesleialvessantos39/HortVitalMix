import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { backendOrigin, canonicalBackend, classifyChanges, fingerprint, prepare, validateVersion } from './native-build.mjs';
import { certificateDigest } from './cert-proof.mjs';
import { verifyAndroidPackage } from './android-package-proof.mjs';
import { verifyIosIdentity } from './ios-proof.mjs';
import { safeUploadUrl, validatePublication, oidcToken, post } from './publish-release.mjs';
const config = { appId:'br.com.hortivitalmix.app',webDir:'../../dist',server:{cleartext:false},android:{allowMixedContent:false},plugins:{CapacitorHttp:{enabled:false}} };
const gradle = 'defaultConfig { versionCode 1\n versionName "1.0.0" }';
const pbx = 'CURRENT_PROJECT_VERSION = 1;\nMARKETING_VERSION = 1.0.0;\nCURRENT_PROJECT_VERSION = 1;\nMARKETING_VERSION = 1.0.0;';
async function fixture(fn) {
 const root=await mkdtemp(path.join(os.tmpdir(),'hvm-native-'));
 try {
  for (const d of ['packaging/capacitor/android/app','packaging/capacitor/ios/App/App.xcodeproj','shared/contracts']) await mkdir(path.join(root,d),{recursive:true});
  await writeFile(path.join(root,'packaging/capacitor/capacitor.config.json'),JSON.stringify(config));
  await writeFile(path.join(root,'packaging/capacitor/android/app/build.gradle'),gradle);
  await writeFile(path.join(root,'packaging/capacitor/ios/App/App.xcodeproj/project.pbxproj'),pbx);
  await writeFile(path.join(root,'shared/contracts/foundation.ts'),'export const FOUNDATION_SCHEMA_VERSION = 67;');
  await fn(root,path.join(root,'packaging/capacitor'));
 } finally { await rm(root,{recursive:true,force:true}); }
}
test('bundled assets require packages; server and data changes do not',()=>{
 for(const file of ['src/App.tsx','public/favicon.svg','packaging/capacitor/android/app/build.gradle','shared/contracts/cart.ts','package-lock.json']) assert.equal(classifyChanges([file]).nativeRequired,true,file);
 for(const file of ['server/app.ts','supabase/migrations/new.sql','docs/guide.md','LIVRO_RAIZ_HORTIVITALMIX.md']) assert.equal(classifyChanges([file]).nativeRequired,false,file);
});
test('backend origin rejects credentials, insecure/local endpoints and URL paths',()=>{
 assert.equal(backendOrigin(),canonicalBackend);assert.equal(backendOrigin('https://app.example.com'),'https://app.example.com');
 for(const origin of ['http://site.test','https://u:p@site.test','https://site.test:444','https://site.test/api','https://site.test?x=1','https://site.test#x','https://localhost','https://127.0.0.1']) assert.throws(()=>backendOrigin(origin));
});
test('native versions are bounded positive builds and numeric store versions',()=>{
 assert.deepEqual(validateVersion('42','1.0.42'),{buildNumber:42,version:'1.0.42'});
 for(const build of ['0','-1','01','1.2','2147483648','1;echo secret']) assert.throws(()=>validateVersion(build,'1.0.1'));
 for(const version of ['1','1.0','1.0.1-beta','1.0.1\"']) assert.throws(()=>validateVersion('1',version));
});
test('fingerprint remains stable across package version changes and copied web assets',async()=>fixture(async(root,native)=>{
 const before=await fingerprint(native);
 await writeFile(path.join(native,'android/app/build.gradle'),gradle.replace('versionCode 1','versionCode 42').replace('"1.0.0"','"1.0.42"'));
 await writeFile(path.join(native,'ios/App/App.xcodeproj/project.pbxproj'),pbx.replaceAll('= 1;','= 42;').replaceAll('= 1.0.0;','= 1.0.42;'));
 await mkdir(path.join(native,'android/app/src/main/assets/public'),{recursive:true});await writeFile(path.join(native,'android/app/src/main/assets/public/index.html'),'new web assets');
 await writeFile(path.join(native,'native-build.json'),'{"build":42}');
 assert.equal(await fingerprint(native),before);
 await writeFile(path.join(native,'android/variables.gradle'),'minSdkVersion=26');assert.notEqual(await fingerprint(native),before);
}));
test('remote live-reload and global fetch patch cannot pass runtime validation',async()=>fixture(async(root,native)=>{
 for(const altered of [{...config,server:{...config.server,url:canonicalBackend}},{...config,server:{...config.server,allowNavigation:['*']}},{...config,plugins:{CapacitorHttp:{enabled:true}}},{...config,appId:'another.app'}]) {
  await writeFile(path.join(native,'capacitor.config.json'),JSON.stringify(altered));await assert.rejects(fingerprint(native),/NATIVE_RUNTIME_CONFIGURATION_UNSAFE/);
 }
}));
test('prepare stamps Android and iOS consistently using real schema and source SHA',async()=>fixture(async(root,native)=>{
 const metadata=await prepare('42','1.0.42',root,'a'.repeat(40));
 assert.equal(metadata.schemaVersion,67);assert.equal(metadata.ota,'unavailable');assert.equal(metadata.buildNumber,42);assert.match(metadata.runtimeFingerprint,/^[a-f0-9]{64}$/);
 assert.match(await readFile(path.join(native,'android/app/build.gradle'),'utf8'),/versionCode 42/);
 assert.equal((await readFile(path.join(native,'ios/App/App.xcodeproj/project.pbxproj'),'utf8')).match(/CURRENT_PROJECT_VERSION = 42;/g).length,2);
}));
test('invalid native target fails before changing the other project',async()=>fixture(async(root,native)=>{
 await writeFile(path.join(native,'ios/App/App.xcodeproj/project.pbxproj'),'wrong target');
 await assert.rejects(prepare('42','1.0.42',root,'a'.repeat(40)),/IOS_VERSION_TARGET_INVALID/);
 assert.equal(await readFile(path.join(native,'android/app/build.gradle'),'utf8'),gradle);
}));
test('certificate proof requires the actual single signer matching the configured pin',()=>{
 const pin='a'.repeat(64), proof=`Signer #1 certificate SHA-256 digest: ${pin}\n`;
 assert.equal(certificateDigest(proof,pin.toUpperCase()),pin);
 assert.throws(()=>certificateDigest(proof,'b'.repeat(64)));assert.throws(()=>certificateDigest(proof+proof,pin));assert.throws(()=>certificateDigest('',pin));
});
test('APK package proof rejects a validly signed different application or version',()=>{
 const expected={appId:config.appId,buildNumber:42,version:'1.0.42'};
 const proof=`package: name='${config.appId}' versionCode='42' versionName='1.0.42' platformBuildVersionName='16'`;
 assert.equal(verifyAndroidPackage(proof,expected),true);
 for(const changed of [proof.replace(config.appId,'other.app'),proof.replace("versionCode='42'","versionCode='41'"),proof.replace("versionName='1.0.42'","versionName='1.0.41'")]) assert.throws(()=>verifyAndroidPackage(changed,expected));
});
test('IPA proof requires signed team, application and actual version without debugging entitlement',()=>{
 const expected={team:'AB12345678',appId:config.appId,buildNumber:42,version:'1.0.42'};
 const info={CFBundleIdentifier:expected.appId,CFBundleShortVersionString:expected.version,CFBundleVersion:'42'};
 const entitlement={'com.apple.developer.team-identifier':expected.team,'application-identifier':`${expected.team}.${expected.appId}`,'get-task-allow':false};
 const proof=`TeamIdentifier=${expected.team}\n`;
 assert.equal(verifyIosIdentity(info,entitlement,proof,expected),expected.team);
 assert.throws(()=>verifyIosIdentity({...info,CFBundleVersion:'41'},entitlement,proof,expected));
 assert.throws(()=>verifyIosIdentity(info,{...entitlement,'get-task-allow':true},proof,expected));
 assert.throws(()=>verifyIosIdentity(info,entitlement,'TeamIdentifier=ZZ12345678\n',expected));
});
test('signed upload destination is immutable and restricted to the project bucket',()=>{
 const destination='android/42/'+ 'a'.repeat(64)+'.apk';
 const url=`https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/upload/sign/app-downloads/${destination}?token=opaque`;
 assert.equal(safeUploadUrl(url,destination),url);
 for(const unsafe of [url.replace('xipbsazvymkqqfmfegwu.supabase.co','evil.test'),url.replace('app-downloads','other-bucket'),url.replace('?token=opaque',''),url.replace('android/42/','android/41/')]) assert.throws(()=>safeUploadUrl(unsafe,destination));
});
test('publication is bound to the exact source and signer; no arbitrary iOS installation link',()=>{
 const prior=process.env.GITHUB_SHA;process.env.GITHUB_SHA='a'.repeat(40);
 try {
  const metadata={buildNumber:42,version:'1.0.42',runtimeFingerprint:'b'.repeat(64),sourceCommit:process.env.GITHUB_SHA,schemaVersion:67};
  const bytes=Buffer.alloc(1000);
  assert.equal(validatePublication(metadata,bytes,'c'.repeat(64),'android').channel,'apk');
  assert.equal(validatePublication(metadata,bytes,'AB12345678','ios','https://testflight.apple.com/join/ABCD1234').channel,'testflight');
  assert.throws(()=>validatePublication({...metadata,sourceCommit:'d'.repeat(40)},bytes,'c'.repeat(64),'android'));
  assert.throws(()=>validatePublication(metadata,bytes,'not-a-certificate','android'));
  assert.throws(()=>validatePublication(metadata,bytes,'AB12345678','ios','https://evil.test/app.ipa'));
 } finally { if(prior===undefined) delete process.env.GITHUB_SHA;else process.env.GITHUB_SHA=prior; }
});

test('CI callback sends the exact matching origin and bearer without following redirects',async()=>{
 const previous=globalThis.fetch;let received;
 globalThis.fetch=async(url,options)=>{received={url,options};return {ok:true,json:async()=>({status:'verified'})};};
 try {
  await post(canonicalBackend,'uploads',{platform:'android'},'synthetic-oidc-token');
  assert.equal(received.url,canonicalBackend+'/api/v1/mobile-ci/uploads');
  assert.equal(received.options.headers.Origin,canonicalBackend);
  assert.equal(received.options.headers.Authorization,'Bearer synthetic-oidc-token');
  assert.equal(received.options.redirect,'error');
 } finally {globalThis.fetch=previous;}
});
test('OIDC token is requested only from the GitHub-controlled endpoint for the fixed audience',async()=>{
 const previousFetch=globalThis.fetch,priorUrl=process.env.ACTIONS_ID_TOKEN_REQUEST_URL,priorToken=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
 process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN='synthetic-request-token';let received;
 globalThis.fetch=async(url,options)=>{received={url:String(url),options};return {ok:true,json:async()=>({value:'x'.repeat(120)})};};
 try {
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL='https://vstoken.actions.githubusercontent.com/token?id=synthetic';
  assert.equal(await oidcToken(),'x'.repeat(120));
  assert.equal(new URL(received.url).searchParams.get('audience'),canonicalBackend+'/mobile-ci');
  assert.equal(received.options.redirect,'error');
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL='https://evil.test/token';await assert.rejects(oidcToken(),/MOBILE_CI_IDENTITY_UNAVAILABLE/);
 } finally {
  globalThis.fetch=previousFetch;
  if(priorUrl===undefined)delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;else process.env.ACTIONS_ID_TOKEN_REQUEST_URL=priorUrl;
  if(priorToken===undefined)delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;else process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN=priorToken;
 }
});
test('active Actions workflows are absent; native distribution remains preserved',async()=>{
 const { readdir } = await import('node:fs/promises');
 const workflows = await readdir(new URL('../../.github/workflows/',import.meta.url)).catch(error=>{
  if(error.code==='ENOENT')return [];throw error;
 });
 assert.equal(workflows.some(name=>/\.ya?ml$/.test(name)),false);
 for(const file of ['android/app/build.gradle','ios/App/App.xcodeproj/project.pbxproj'])
  assert.ok((await readFile(new URL('../../packaging/capacitor/'+file,import.meta.url),'utf8')).length);
});
