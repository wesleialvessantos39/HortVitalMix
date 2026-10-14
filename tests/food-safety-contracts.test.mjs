import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FoodRuleBodySchema, FoodMaterialBodySchema, FoodAcceptanceSchema } from '../shared/contracts/foodSafety.ts';
import { FOOD_RULE_SEEDS, FOOD_MATERIAL_SEEDS } from '../shared/foodSafetySeeds.ts';
test('the federal starting library has valid sources and actionable checklist items',()=>{
 for(const r of FOOD_RULE_SEEDS)assert.equal(FoodRuleBodySchema.safeParse(r.body).success,true,r.slug);
 for(const m of FOOD_MATERIAL_SEEDS)assert.equal(FoodMaterialBodySchema.safeParse(m).success,true,m.title);
});
test('municipal requirements need a state and municipality; nationwide rules cannot silently target a city',()=>{
 const body=FOOD_RULE_SEEDS[0].body;
 assert.equal(FoodRuleBodySchema.safeParse({...body,scope:'municipality',state:null,municipality:'Ariquemes'}).success,false);
 assert.equal(FoodRuleBodySchema.safeParse({...body,scope:'municipality',state:'RO',municipality:null}).success,false);
 assert.equal(FoodRuleBodySchema.safeParse({...body,scope:'national',state:'RO'}).success,false);
});
test('a published checklist cannot have duplicate item identifiers or lack sources',()=>{
 const body=FOOD_RULE_SEEDS[0].body;
 assert.equal(FoodRuleBodySchema.safeParse({...body,checklist:[body.checklist[0],body.checklist[0]]}).success,false);
 assert.equal(FoodRuleBodySchema.safeParse({...body,sources:[]}).success,false);
});
test('uploaded and YouTube materials require their corresponding asset or validated video link',()=>{
 const m=FOOD_MATERIAL_SEEDS[0];
 assert.equal(FoodMaterialBodySchema.safeParse({...m,kind:'video',assetId:null}).success,false);
 assert.equal(FoodMaterialBodySchema.safeParse({...m,kind:'youtube',url:'https://evil.invalid/watch?v=abcdefghijk'}).success,false);
 assert.equal(FoodMaterialBodySchema.safeParse({...m,kind:'youtube',url:'https://youtu.be/abcdefghijk'}).success,true);
});
test('acceptance cannot omit or decline the two explicit responsibility and terms confirmations',()=>{
 const a={requirementsToken:'a'.repeat(64),checkedKeys:['v:care'],acceptResponsibility:true,acceptTerms:true};
 assert.equal(FoodAcceptanceSchema.safeParse(a).success,true);
 assert.equal(FoodAcceptanceSchema.safeParse({...a,acceptTerms:false}).success,false);
 assert.equal(FoodAcceptanceSchema.safeParse({...a,acceptResponsibility:false}).success,false);
});
