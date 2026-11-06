import {createHash} from "node:crypto";
import type {SqlClient as Sql} from "@launchstack/store/client";
import {z} from "zod";
export const M3_PROJECT="vantage-grounding-m3-20261106" as const;
export const M3_BUDGET_VERSION="vantage-m3-request-budget/v1" as const;
const hash=z.string().regex(/^[a-f0-9]{64}$/), id=z.string().uuid();
export const m3PlanSchema=z.object({schemaVersion:z.literal(M3_BUDGET_VERSION),project:z.literal(M3_PROJECT),mode:z.enum(["offline","live"]),totalLimit:z.literal(2),limits:z.object({generation:z.literal(1),judge:z.literal(1),embedding:z.literal(0),retrieval:z.literal(0),research:z.literal(0)}).strict(),maxRetries:z.literal(0),maxRepairs:z.literal(0),redirect:z.literal("manual"),bindings:z.object({inputHash:hash.nullable(),configHash:hash.nullable(),sourceFreezeHash:hash.nullable(),implementationHash:hash.nullable(),promptSchemaHash:hash.nullable(),judgeRubricHash:hash.nullable(),judgeBuilderHash:hash.nullable()}).strict(),models:z.object({generation:z.object({wireModelId:z.string().min(1),family:z.string().min(1),modelConfigHash:hash.nullable(),endpointHash:hash.nullable()}).strict(),judge:z.object({wireModelId:z.string().min(1),family:z.string().min(1),modelConfigHash:hash.nullable(),endpointHash:hash.nullable()}).strict()}).strict()}).strict();
export type M3BudgetPlan=z.infer<typeof m3PlanSchema>;
export type M3RequestKind="generation"|"judge"|"embedding"|"retrieval"|"research";
export const m3IntentSchema=z.object({requestId:id,kind:z.enum(["generation","judge","embedding","retrieval","research"]),purpose:z.enum(["initial","retry","repair"]),planHash:hash,inputHash:hash,configHash:hash,modelConfigHash:hash,endpointHash:hash,wireModelId:z.string().min(1),promptHash:hash,requestBodyHash:hash,dependsOn:z.object({requestId:id,responseHash:hash}).strict().optional()}).strict();
export type M3RequestIntent=z.infer<typeof m3IntentSchema>;
export interface M3Reservation {requestId:string;ordinal:number;mode:"offline"|"live";planHash:string;budgetKey:string}
export interface M3Completion {requestId:string;status:"responded"|"failed"|"timeout";httpStatus?:number;responseHash?:string}
export interface M3VerifyInput {planHash:string;inputHash:string;configHash:string;generationRequestId:string;judgeRequestId:string;generationResponseHash?:string;judgeResponseHash?:string}
export type M3Query=(text:string,parameters:unknown[])=>Promise<Record<string,unknown>[]>;
export interface M3Receipt {mode:"offline"|"live";planHash:string;inputHash:string;configHash:string;generationRequestId:string;judgeRequestId:string;generationResponseHash:string;judgeResponseHash:string;reserved:2;totalLimit:2}
export interface M3BudgetSnapshot {budgetKey:string;planHash:string;plan:M3BudgetPlan;approvalState:"unapproved"|"approved-offline"|"approved-live";approvalManifest:unknown;reserved:number;totalLimit:2;requests:PersistedRequest[]}
export interface M3RequestBudget {beforeDispatch(intent:M3RequestIntent):Promise<M3Reservation>;completion(receipt:M3Completion):Promise<void>;snapshot():Promise<M3BudgetSnapshot>;verifyReceipt(input:M3VerifyInput,scope?:{query:M3Query;lock?:boolean}):Promise<M3Receipt>}
interface PersistedRequest {request_id:string;ordinal:number;intent:M3RequestIntent;status:"reserved"|"responded"|"failed"|"timeout";http_status:number|null;response_hash:string|null}
interface BudgetRow {budget_key:string;schema_version:string;plan_hash:string;plan:unknown;approval_state:M3BudgetSnapshot["approvalState"];approval_manifest:unknown;reserved_count:number;total_limit:number}
export const M3_REQUEST_BUDGET_SCHEMA_SQL=`
CREATE TABLE IF NOT EXISTS pdr_ai_v2_vantage_m3_request_budgets(
 budget_key text PRIMARY KEY,schema_version text NOT NULL,plan_hash text NOT NULL,plan jsonb NOT NULL,
 approval_state text NOT NULL CHECK(approval_state IN('unapproved','approved-offline','approved-live')),
 approval_manifest jsonb,reserved_count integer NOT NULL DEFAULT 0 CHECK(reserved_count BETWEEN 0 AND 2),
 total_limit integer NOT NULL CHECK(total_limit=2),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pdr_ai_v2_vantage_m3_plan_revisions(id bigserial PRIMARY KEY,budget_key text NOT NULL REFERENCES pdr_ai_v2_vantage_m3_request_budgets(budget_key),previous_plan_hash text NOT NULL,next_plan_hash text NOT NULL,previous_plan jsonb NOT NULL,next_plan jsonb NOT NULL,reason text NOT NULL CHECK(reason='bind-unapproved-draft'),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pdr_ai_v2_vantage_m3_requests(
 request_id uuid PRIMARY KEY,budget_key text NOT NULL REFERENCES pdr_ai_v2_vantage_m3_request_budgets(budget_key),
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 2),intent jsonb NOT NULL,
 status text NOT NULL CHECK(status IN('reserved','responded','failed','timeout')),
 http_status integer,response_hash text,reserved_at timestamptz NOT NULL DEFAULT now(),terminal_at timestamptz,
 UNIQUE(budget_key,ordinal));`;
function fail(code:string):never{throw new Error(`M3 request budget: ${code}`);}
function decodedJson(value:unknown):unknown {if(typeof value!=="string")return value;try{return JSON.parse(value);}catch{fail("corrupt JSON encoding");}}
function canonical(value:unknown):string {if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';const encoded=JSON.stringify(value);if(encoded===undefined)fail('non-JSON plan value');return encoded;}
export const m3PlanHash=(plan:M3BudgetPlan):string=>createHash('sha256').update(canonical(m3PlanSchema.parse(plan))).digest('hex');
function keyGuard(key:string,mode:"offline"|"live"){if(mode==='live'&&key!=='finance-live-pilot')fail('live budget key is fixed');if(mode==='offline'&&!/^offline-[a-zA-Z0-9-]{1,120}$/.test(key))fail('offline budget key must be explicitly disjoint');}
function completeBindings(plan:M3BudgetPlan){return Object.values(plan.bindings).every(Boolean)&&Object.values(plan.models).every(m=>m.endpointHash&&m.modelConfigHash);}
async function identity(sql:Sql){const [row]=await sql`SELECT current_database() AS name,current_user AS username,(SELECT marker FROM _vantage_integration_identity) AS marker`;if(row?.name!=='vantage_grounding_m3_20261106'||row.username!=='vantage_grounding_m3'||row.marker!==M3_PROJECT)fail('owned database identity mismatch');}
/** Initialization never approves a live plan. Existing budgets cannot be reset or replaced. */
export async function assertM3BudgetDatabase(sql:Sql):Promise<void>{await identity(sql);}
export async function initializeM3Budget(sql:Sql,input:{budgetKey:string;plan:M3BudgetPlan}):Promise<string>{
 const plan=m3PlanSchema.parse(input.plan),planHash=m3PlanHash(plan);keyGuard(input.budgetKey,plan.mode);await identity(sql);
 await sql.begin(async tx=>{await tx`SET LOCAL synchronous_commit='on'`;const [fsync]=await tx`SHOW fsync`;if(fsync?.fsync!=='on')fail('durable WAL fsync is disabled');
  const existing=await tx`SELECT plan_hash FROM pdr_ai_v2_vantage_m3_request_budgets WHERE budget_key=${input.budgetKey}`;
  if(existing.length){if(existing[0]!.plan_hash!==planHash)fail('existing plan cannot be replaced');return;}
  if(plan.mode==='offline'&&!completeBindings(plan))fail('offline plan bindings incomplete');
  await tx`INSERT INTO pdr_ai_v2_vantage_m3_request_budgets(budget_key,schema_version,plan_hash,plan,approval_state,total_limit)VALUES(${input.budgetKey},${M3_BUDGET_VERSION},${planHash},${JSON.stringify(plan)}::jsonb,${plan.mode==='offline'?'approved-offline':'unapproved'},2)`;
 });return planHash;
}
async function readSnapshot(query:M3Query,budgetKey:string,expectedPlanHash:string,mode:"offline"|"live",lock=false):Promise<M3BudgetSnapshot>{
 const rows=await query('SELECT budget_key,schema_version,plan_hash,plan,approval_state,approval_manifest,reserved_count,total_limit FROM pdr_ai_v2_vantage_m3_request_budgets WHERE budget_key=$1'+(lock?' FOR UPDATE':''),[budgetKey]);
 if(rows.length!==1)fail('missing budget');const row=rows[0] as unknown as BudgetRow,plan=m3PlanSchema.parse(decodedJson(row.plan));
 if(row.schema_version!==M3_BUDGET_VERSION||row.plan_hash!==expectedPlanHash||m3PlanHash(plan)!==expectedPlanHash||plan.mode!==mode||row.total_limit!==2)fail('corrupt or mismatched budget');
 const raw=await query('SELECT request_id::text,ordinal,intent,status,http_status,response_hash FROM pdr_ai_v2_vantage_m3_requests WHERE budget_key=$1 ORDER BY ordinal',[budgetKey]);
 const requests=raw.map((r,i)=>{const intent=m3IntentSchema.parse(decodedJson(r.intent));if(r.ordinal!==i+1||intent.requestId!==r.request_id||intent.planHash!==expectedPlanHash||!['reserved','responded','failed','timeout'].includes(String(r.status)))fail('corrupt request ledger');return {...r,intent} as unknown as PersistedRequest;});
 if(row.reserved_count!==requests.length||requests.length>2)fail('counter and ledger disagree');
 if(requests.some(r=>r.intent.kind!=='generation'&&r.intent.kind!=='judge')||new Set(requests.map(r=>r.intent.kind)).size!==requests.length)fail('corrupt per-kind counts');
 if(!['unapproved','approved-offline','approved-live'].includes(row.approval_state))fail('corrupt approval state');
 const snapshot={budgetKey,planHash:row.plan_hash,plan,approvalState:row.approval_state,approvalManifest:decodedJson(row.approval_manifest),reserved:row.reserved_count,totalLimit:2 as const,requests};
 for(const r of requests){intentBinding(snapshot,r.intent);if(r.status==='responded'&&(!r.response_hash||!r.http_status||r.http_status<200||r.http_status>=300))fail('corrupt terminal receipt');if(r.response_hash)hash.parse(r.response_hash);if(r.status==='reserved'&&(r.response_hash!==null||r.http_status!==null))fail('corrupt inflight receipt');}
 return snapshot;
}
export function assertM3BudgetAuthorized(s:M3BudgetSnapshot):void{authorized(s);}
function authorized(s:M3BudgetSnapshot){if(!completeBindings(s.plan))fail('plan bindings incomplete');if(s.plan.mode==='offline'){if(s.approvalState!=='approved-offline')fail('offline plan is not admitted');return;}
 const a=s.approvalManifest as Record<string,unknown>|null;if(s.approvalState!=='approved-live'||!a||a.approvalState!=='approved'||a.planHash!==s.planHash||a.project!==M3_PROJECT||a.maxRequests!==2||typeof a.authorizationRef!=='string'||!a.authorizationRef)fail('live approval missing or mismatched');}
function intentBinding(s:M3BudgetSnapshot,intent:M3RequestIntent){if(intent.planHash!==s.planHash||intent.inputHash!==s.plan.bindings.inputHash||intent.configHash!==s.plan.bindings.configHash)fail('input/config binding mismatch');if(intent.purpose!=='initial')fail('retries and repairs disabled');if(intent.kind!=='generation'&&intent.kind!=='judge')fail('call kind disabled');const m=s.plan.models[intent.kind];if(intent.modelConfigHash!==m.modelConfigHash||intent.endpointHash!==m.endpointHash||intent.wireModelId!==m.wireModelId)fail('model/endpoint binding mismatch');}
function queryFor(sql:Sql):M3Query{return async(text,params)=>[...await sql.unsafe(text,params as never[]) ] as Record<string,unknown>[];}
export function createPgM3RequestBudget(sql:Sql,options:{budgetKey:string;expectedPlanHash:string;mode:"offline"|"live"}):M3RequestBudget{
 keyGuard(options.budgetKey,options.mode);hash.parse(options.expectedPlanHash);
 const read=(query:M3Query,lock=false)=>readSnapshot(query,options.budgetKey,options.expectedPlanHash,options.mode,lock);
 return {
  async snapshot(){await identity(sql);return sql.begin(async tx=>read(queryFor(tx as unknown as Sql),true));},
  async beforeDispatch(raw){const intent=m3IntentSchema.parse(raw);await identity(sql);return sql.begin(async tx=>{
   await tx`SET LOCAL synchronous_commit='on'`;const [fsync]=await tx`SHOW fsync`;if(fsync?.fsync!=='on')fail('durable WAL fsync is disabled');const state=await read(queryFor(tx as unknown as Sql),true);authorized(state);intentBinding(state,intent);
   if(state.requests.some(r=>r.status==='reserved'))fail('inflight or crash-uncertain reservation');if(state.reserved>=2)fail('shared cap exhausted');if(state.requests.some(r=>r.intent.kind===intent.kind))fail('per-kind cap exhausted');
   if(intent.kind==='generation'&&(state.reserved!==0||intent.dependsOn))fail('generation must be first');
   if(intent.kind==='judge'){const generation=state.requests.find(r=>r.intent.kind==='generation');if(!generation||generation.status!=='responded'||!generation.response_hash||!intent.dependsOn||intent.dependsOn.requestId!==generation.request_id||intent.dependsOn.responseHash!==generation.response_hash)fail('Judge must bind delivered Generation response');}
   const ordinal=state.reserved+1;await tx`INSERT INTO pdr_ai_v2_vantage_m3_requests(request_id,budget_key,ordinal,intent,status)VALUES(${intent.requestId}::uuid,${options.budgetKey},${ordinal},${JSON.stringify(intent)}::jsonb,'reserved')`;
   await tx`UPDATE pdr_ai_v2_vantage_m3_request_budgets SET reserved_count=reserved_count+1 WHERE budget_key=${options.budgetKey}`;
   return {requestId:intent.requestId,ordinal,mode:options.mode,planHash:options.expectedPlanHash,budgetKey:options.budgetKey};
  }) as Promise<M3Reservation>;},
  async completion(receipt){id.parse(receipt.requestId);if(!['responded','failed','timeout'].includes(receipt.status))fail('invalid terminal status');if(receipt.responseHash)hash.parse(receipt.responseHash);if(receipt.status==='responded'&&(!receipt.responseHash||!receipt.httpStatus||receipt.httpStatus<200||receipt.httpStatus>=300))fail('responded receipt requires successful HTTP and response hash');await identity(sql);
   await sql.begin(async tx=>{await tx`SET LOCAL synchronous_commit='on'`;const state=await read(queryFor(tx as unknown as Sql),true);const r=state.requests.find(r=>r.request_id===receipt.requestId);if(!r||r.status!=='reserved')fail('terminal receipt cannot overwrite or refund');await tx`UPDATE pdr_ai_v2_vantage_m3_requests SET status=${receipt.status},http_status=${receipt.httpStatus??null},response_hash=${receipt.responseHash??null},terminal_at=now() WHERE request_id=${receipt.requestId}::uuid AND budget_key=${options.budgetKey}`;});
  },
  async verifyReceipt(input,scope){const verify=async(query:M3Query,lock:boolean)=>{const s=await read(query,lock);authorized(s);if(input.planHash!==s.planHash||input.inputHash!==s.plan.bindings.inputHash||input.configHash!==s.plan.bindings.configHash||s.reserved!==2)fail('receipt scope/cap mismatch');const g=s.requests.find(r=>r.request_id===input.generationRequestId&&r.intent.kind==='generation'),j=s.requests.find(r=>r.request_id===input.judgeRequestId&&r.intent.kind==='judge');if(!g||!j||g.status!=='responded'||j.status!=='responded'||!g.response_hash||!j.response_hash||j.intent.dependsOn?.requestId!==g.request_id||j.intent.dependsOn.responseHash!==g.response_hash)fail('completed paired receipts missing');if(input.generationResponseHash&&input.generationResponseHash!==g.response_hash||input.judgeResponseHash&&input.judgeResponseHash!==j.response_hash)fail('response hash mismatch');return {mode:s.plan.mode,planHash:s.planHash,inputHash:input.inputHash,configHash:input.configHash,generationRequestId:g.request_id,judgeRequestId:j.request_id,generationResponseHash:g.response_hash,judgeResponseHash:j.response_hash,reserved:2 as const,totalLimit:2 as const};};
   if(scope){const identityRows=await scope.query('SELECT current_database() AS name,current_user AS username,(SELECT marker FROM _vantage_integration_identity) AS marker',[]);const row=identityRows[0];if(row?.name!=='vantage_grounding_m3_20261106'||row.username!=='vantage_grounding_m3'||row.marker!==M3_PROJECT)fail('host transaction database identity mismatch');return verify(scope.query,scope.lock??true);}await identity(sql);return sql.begin(async tx=>verify(queryFor(tx as unknown as Sql),true)) as Promise<M3Receipt>;
  }
 };
}

/** Bind an unapproved draft by compare-and-swap, append-audited; never approve or reset. */
export function assertM3DraftCanFinalize(current:M3BudgetSnapshot,next:M3BudgetPlan):void {
 if(current.plan.mode!=='live'||next.mode!=='live'||current.approvalState!=='unapproved'||current.approvalManifest!==null||current.reserved!==0||current.requests.length!==0||completeBindings(current.plan)||!completeBindings(next))fail('only pristine unapproved zero-reservation draft can be finalized');
}
export async function finalizeM3DraftPlan(sql:Sql,input:{expectedDraftPlanHash:string;plan:M3BudgetPlan}):Promise<string>{
 const next=m3PlanSchema.parse(input.plan),nextHash=m3PlanHash(next);await identity(sql);
 await sql.begin(async tx=>{await tx`SET LOCAL synchronous_commit='on'`;const current=await readSnapshot(queryFor(tx as unknown as Sql),'finance-live-pilot',input.expectedDraftPlanHash,'live',true);assertM3DraftCanFinalize(current,next);
 await tx`INSERT INTO pdr_ai_v2_vantage_m3_plan_revisions(budget_key,previous_plan_hash,next_plan_hash,previous_plan,next_plan,reason)VALUES('finance-live-pilot',${current.planHash},${nextHash},${JSON.stringify(current.plan)}::jsonb,${JSON.stringify(next)}::jsonb,'bind-unapproved-draft')`;
 await tx`UPDATE pdr_ai_v2_vantage_m3_request_budgets SET plan_hash=${nextHash},plan=${JSON.stringify(next)}::jsonb WHERE budget_key='finance-live-pilot' AND approval_state='unapproved' AND reserved_count=0`;
 });return nextHash;
}
