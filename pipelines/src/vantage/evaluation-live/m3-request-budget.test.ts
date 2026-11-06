import {describe,it,expect}from'vitest';
import {m3PlanSchema,m3PlanHash,m3IntentSchema,M3_PROJECT,M3_BUDGET_VERSION,assertM3DraftCanFinalize,type M3BudgetSnapshot}from'./m3-request-budget';
const h='a'.repeat(64);
const plan=()=>({schemaVersion:M3_BUDGET_VERSION,project:M3_PROJECT,mode:'offline' as const,totalLimit:2 as const,limits:{generation:1 as const,judge:1 as const,embedding:0 as const,retrieval:0 as const,research:0 as const},maxRetries:0 as const,maxRepairs:0 as const,redirect:'manual' as const,bindings:{inputHash:h,configHash:h,sourceFreezeHash:h,implementationHash:h,promptSchemaHash:h,judgeRubricHash:h,judgeBuilderHash:h},models:{generation:{wireModelId:'offline-generation',family:'fixture-gen',modelConfigHash:h,endpointHash:h},judge:{wireModelId:'offline-judge',family:'fixture-judge',modelConfigHash:h,endpointHash:h}}});
describe('M3 fixed request budget plan contract',()=>{
 it('accepts the bounded offline plan',()=>expect(m3PlanSchema.parse(plan()).totalLimit).toBe(2));
 it('hashes canonical property order',()=>{const p=plan();expect(m3PlanHash(p)).toBe(m3PlanHash({...p,models:{judge:p.models.judge,generation:p.models.generation}}));});
 it('binds the complete policy and model config',()=>{const p=plan();expect(m3PlanHash(p)).not.toBe(m3PlanHash({...p,models:{...p.models,judge:{...p.models.judge,modelConfigHash:'b'.repeat(64)}}}));});
 it('rejects cap increases and optional request allowance',()=>{expect(()=>m3PlanSchema.parse({...plan(),totalLimit:3})).toThrow();expect(()=>m3PlanSchema.parse({...plan(),limits:{...plan().limits,embedding:1}})).toThrow();});
 it('rejects SDK retries, repairs, and redirects',()=>{for(const patch of[{maxRetries:1},{maxRepairs:1},{redirect:'follow'}])expect(()=>m3PlanSchema.parse({...plan(),...patch})).toThrow();});
 it('requires an exact per-dispatch hash envelope',()=>{expect(()=>m3IntentSchema.parse({requestId:'invalid',kind:'generation',purpose:'initial'})).toThrow();});
});

describe('draft finalization never arms or resets a used budget',()=>{
 const draft=()=>{const p=plan();return {...p,mode:'live' as const,bindings:{...p.bindings,inputHash:null}};};
 const state=():M3BudgetSnapshot=>({budgetKey:'finance-live-pilot',planHash:m3PlanHash(draft()),plan:draft(),approvalState:'unapproved',approvalManifest:null,reserved:0,totalLimit:2,requests:[]});
 it('allows only a complete live binding of pristine unapproved zero-slot draft',()=>expect(()=>assertM3DraftCanFinalize(state(),{...plan(),mode:'live'})).not.toThrow());
 it('rejects approved, used, already bound, and offline state',()=>{for(const patch of [{approvalState:'approved-live' as const},{reserved:1},{approvalManifest:{approvalState:'approved'}},{plan:{...plan(),mode:'live' as const}},{plan:plan()}])expect(()=>assertM3DraftCanFinalize({...state(),...patch},{...plan(),mode:'live'})).toThrow();});
});
