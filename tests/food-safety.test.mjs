import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foodRuleMatches, foodAcceptanceState, youtubeVideoId, safeFoodLink } from '../shared/foodSafety.ts';
import { hasAdminPermission } from '../shared/adminPermissions.ts';
const nationwide={scope:'national',state:null,municipality:null,families:[],processes:[],categoryIds:[]};
const food={family:'leafy',process:'washed_cut',categoryId:'cat',state:'RO',municipality:'Ariquemes'};
test('national requirements reach products from every state',()=>{for(const state of ['RO','MT','SP','AC'])assert.equal(foodRuleMatches(nationwide,{...food,state}),true);});
test('state and municipal rules do not spill into other jurisdictions',()=>{
 const r={...nationwide,scope:'municipality',state:'RO',municipality:'  ARIQUEMES  '};
 assert.equal(foodRuleMatches(r,food),true);assert.equal(foodRuleMatches(r,{...food,state:'MT'}),false);assert.equal(foodRuleMatches(r,{...food,municipality:'Porto Velho'}),false);
 assert.equal(foodRuleMatches({...r,municipality:'São Paulo',state:'SP'},{...food,state:'SP',municipality:'Sao Paulo'}),true);
});
test('food, processing and category restrictions must all match',()=>{
 const r={...nationwide,families:['leafy'],processes:['washed_cut'],categoryIds:['cat']};
 assert.equal(foodRuleMatches(r,food),true);for(const patch of [{family:'juices_pulps'},{process:'fresh'},{categoryId:'another'}])assert.equal(foodRuleMatches(r,{...food,...patch}),false);
});
test('beverage rules reach juices by family and extracted drinks by processing without duplicate rules',()=>{
 const r={...nationwide,families:['juices_pulps'],processes:['pressed_pulped'],matchMode:'any'};
 assert.equal(foodRuleMatches(r,{...food,family:'juices_pulps',process:'frozen'}),true);
 assert.equal(foodRuleMatches(r,{...food,family:'fruits',process:'pressed_pulped'}),true);
 assert.equal(foodRuleMatches(r,food),false);
});
const requirements={token:'current',keys:['rule-v1:hygiene','rule-v2:cold'],held:false,classified:true};
const accepted={requirementsToken:'current',checkedKeys:[...requirements.keys],acceptResponsibility:true,acceptTerms:true};
test('only complete, explicit acceptance of the current checklist is valid',()=>{
 assert.equal(foodAcceptanceState(requirements,accepted),'valid');
 for(const patch of [{checkedKeys:[]},{checkedKeys:[requirements.keys[0]]},{acceptTerms:false},{acceptResponsibility:false}])assert.equal(foodAcceptanceState(requirements,{...accepted,...patch}),'incomplete');
});
test('duplicate and foreign checkbox keys cannot impersonate a completed checklist',()=>{
 assert.equal(foodAcceptanceState(requirements,{...accepted,checkedKeys:[requirements.keys[0],requirements.keys[0]]}),'incomplete');
 assert.equal(foodAcceptanceState(requirements,{...accepted,checkedKeys:[...requirements.keys,'foreign']}),'incomplete');
});
test('a new rule version rejects the previous acceptance',()=>{assert.equal(foodAcceptanceState({...requirements,token:'new-version'},accepted),'stale');});
test('holds and missing classification block acceptance even with checked boxes',()=>{
 assert.equal(foodAcceptanceState({...requirements,held:true},accepted),'held');assert.equal(foodAcceptanceState({...requirements,classified:false},accepted),'classification');
});
test('an empty checklist cannot be accepted as a substitute for legal requirements',()=>{assert.equal(foodAcceptanceState({...requirements,keys:[]},{...accepted,checkedKeys:[]}),'incomplete');});
test('YouTube links are reduced to validated video identifiers',()=>{
 for(const url of ['https://youtu.be/abcdefghijk','https://www.youtube.com/watch?v=abcdefghijk&feature=share','https://www.youtube.com/shorts/abcdefghijk'])assert.equal(youtubeVideoId(url),'abcdefghijk');
 for(const url of ['https://youtube.com.evil.invalid/watch?v=abcdefghijk','javascript:alert(1)','https://user@www.youtube.com/watch?v=abcdefghijk','https://www.youtube.com/watch?v=%3Cscript%3E'])assert.equal(youtubeVideoId(url),null);
});
test('teaching links reject executable schemes, credentials and private literal addresses',()=>{
 assert.equal(safeFoodLink('https://www.gov.br/anvisa/pt-br/assuntos/alimentos/legislacao'),true);
 for(const url of ['javascript:alert(1)','data:text/html,hello','http://www.gov.br','https://user:secret@example.com','https://127.0.0.1/file','https://[::1]/file','https://localhost/file'])assert.equal(safeFoodLink(url),false);
});
test('food department access requires its own permission and respects explicit denial even for superadministrators',()=>{
 assert.equal(hasAdminPermission({role:'platform_admin',sectors:['catalog_moderation']},'food_legislation'),false);
 assert.equal(hasAdminPermission({role:'platform_admin',sectors:['food_legislation']},'food_legislation'),true);
 assert.equal(hasAdminPermission({role:'platform_super_admin',sectors:[]},'food_legislation'),true);
 assert.equal(hasAdminPermission({role:'platform_super_admin',sectors:[],deniedSectors:['food_legislation']},'food_legislation'),false);
});
