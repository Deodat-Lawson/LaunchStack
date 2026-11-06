/** Future-only M3 operations. This file never dispatches a provider request itself. */
import{readFileSync,writeFileSync,realpathSync,existsSync}from'node:fs';
import{resolve,relative,isAbsolute}from'node:path';
import{createRequire}from'node:module';
import{pathToFileURL}from'node:url';
import{spawn}from'node:child_process';
import{createServer}from'node:net';
import{isDeepStrictEqual}from'node:util';
import{ROOT,RUNTIME_DIR,PROJECT,APP_URL,APP_PORT,readRuntime,childEnvironment,assertNoDotenv}from'./vantage-grounding-runtime.mjs';
import policy from'./vantage-grounding-live-policy.cjs';
const actions=new Set(['--validate','--propose-plan','--finalize-plan','--record-approval','--serve-approved','--run-approved-once']);
const action=process.argv[2],options=new Map();
function noGo(reason){throw new Error('M3 NoGo: '+reason);}
for(let i=3;i<process.argv.length;i+=2){const key=process.argv[i],value=process.argv[i+1];if(!['--config','--approval-manifest','--plan','--expected-draft-hash','--credentials-file','--max-requests'].includes(key)||!value||options.has(key))noGo('invalid arguments');options.set(key,value);}
if(!actions.has(action)){console.error('Usage: vantage-grounding-live.mjs --validate | --propose-plan | --finalize-plan | --record-approval | --serve-approved | --run-approved-once --config <owned-json> --approval-manifest <owned-json> --max-requests 2');process.exitCode=1;}
else if(process.env.VANTAGE_M3_CLI_BOOTSTRAPPED!=='1'){
 const load=createRequire(resolve(ROOT,'package.json')),env={...childEnvironment(readRuntime()),VANTAGE_M3_CLI_BOOTSTRAPPED:'1',TSX_TSCONFIG_PATH:resolve(ROOT,'apps/web/tsconfig.json')};
 // The preparation/validation parent always runs under the closed offline guard.
 const child=spawn(process.execPath,['--import',pathToFileURL(load.resolve('tsx')).href,...process.argv.slice(1)],{cwd:resolve(ROOT,'apps/web'),env,shell:false,windowsHide:true,stdio:'inherit'});
 await new Promise((done,reject)=>{child.once('error',reject);child.once('close',code=>{process.exitCode=code??1;done();});});
}else{
 let sql;
 try{await main();}catch{console.error('M3 NoGo: configuration, approval, current input, implementation or ledger gate is incomplete; no automatic retry. No secret values are printed.');process.exitCode=1;}finally{if(sql)await sql.end({timeout:5});}
 async function main(){
  assertNoDotenv();if(options.get('--max-requests')!=='2')noGo('explicit hard cap2 required');
  const owned=(name,fallback)=>{const full=realpathSync(resolve(ROOT,options.get(name)??resolve(RUNTIME_DIR,fallback))),rel=relative(realpathSync(RUNTIME_DIR),full);if(!rel||rel.startsWith('..')||isAbsolute(rel))noGo('task-owned path required');return full;};
  const read=(name,fallback)=>JSON.parse(readFileSync(owned(name,fallback),'utf8'));
  const rawConfiguration=read('--config','live-execution.json');let configuration;
  const budget=await import(pathToFileURL(resolve(ROOT,'pipelines/src/vantage/evaluation-live/m3-request-budget.ts')).href);
  const grounding=await import(pathToFileURL(resolve(ROOT,'pipelines/src/vantage/experiments/live-grounding-m3.ts')).href);
  const transport=await import(pathToFileURL(resolve(ROOT,'pipelines/src/vantage/experiments/live-grounding-m3-transport.ts')).href);
  const execution=await import(pathToFileURL(resolve(ROOT,'apps/web/src/server/vantage/grounding-execution.ts')).href);
  const liveExecution=await import(pathToFileURL(resolve(ROOT,'apps/web/src/server/vantage/grounding-live-execution.ts')).href);configuration=liveExecution.parseGroundingLiveConfiguration(rawConfiguration);
  const{openBudgetDatabase}=await import('./vantage-grounding-budget.mjs');sql=await openBudgetDatabase();await budget.assertM3BudgetDatabase(sql);
  if(configuration.version!=='vantage-m3-live-runtime/v1'||configuration.project!==PROJECT||configuration.pricing?.status!=='verified'||!/^[a-f0-9]{64}$/.test(configuration.pricing.evidenceHash??''))noGo('verified live configuration missing');
  const implementationHash=await execution.groundingImplementationHash();if(configuration.implementationHash!==implementationHash)noGo('implementation drift');
  for(const kind of ['generation','judge']){transport.assertM3ModelSettings(configuration[kind],'live');if(configuration[kind].config.endpoint.apiKey!=='m3-live-unbound-no-credential')noGo('credential-bearing config prohibited');}
  if(configuration.generation.identity.family===configuration.judge.identity.family)noGo('independent model families required');
  const endpoints=policy.reviewedEndpoints(configuration),configHash=grounding.m3ConfigurationHash({...configuration,mode:'live',implementationHash});
  async function authenticate(){const runtime=readRuntime(),owner=runtime.accounts?.[0];if(!owner?.email||!runtime.loginPassword)noGo('local synthetic owner unavailable');const response=await fetch(APP_URL+'/api/auth/sign-in/email',{method:'POST',redirect:'manual',headers:{'content-type':'application/json',origin:APP_URL},body:JSON.stringify({email:owner.email,password:runtime.loginPassword})});if(response.status!==200)noGo('local authentication failed');const cookies=response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');if(!cookies)noGo('session missing');return cookies;}
  async function preflight(cookie){const response=await fetch(APP_URL+'/api/vantage/grounding/preflight',{redirect:'manual',headers:{cookie,origin:APP_URL}});if(response.status!==200)noGo('fresh local preflight failed');return response.json();}
  async function currentProjection(){
   const fixture=JSON.parse(readFileSync(resolve(RUNTIME_DIR,'grounding-fixture.json'),'utf8')),runtime=readRuntime(),store=await import(pathToFileURL(resolve(ROOT,'packages/store/src/db/index.ts')).href),crypto=await import(pathToFileURL(resolve(ROOT,'packages/store/src/crypto/index.ts')).href),host=await import(pathToFileURL(resolve(ROOT,'apps/web/src/server/vantage/grounding-runtime-prepare.ts')).href),connection=store.createDb({url:runtime.databaseUrl,maxConnections:2});
   try{await budget.assertM3BudgetDatabase(connection.client);store.configureDatabase(connection.db);crypto.configureSecretBox({key:runtime.storageSecretKey});const input=await host.prepareGroundingForRuntime({database:connection.db,sql:connection.client,owner:fixture.accounts[0],asOf:fixture.domainClock});return {input,inputHash:grounding.m3InputHash(input.envelope,input.roleContext),baseline:input.baseline};}finally{await connection.close();}
  }
  if(action==='--propose-plan'){
   const fresh=await currentProjection(),input=fresh.input;
   const plan=grounding.buildM3OfflinePlan(input,configuration);plan.mode='live';plan.bindings.configHash=configHash;const planHash=budget.m3PlanHash(plan),sourceInventory=policy.sourceInventory(ROOT);
   writeFileSync(resolve(RUNTIME_DIR,'live-plan.proposed.json'),JSON.stringify({planHash,plan,sourceInventory,expectedBaseline:fresh.baseline,approvalState:'unapproved'},null,2));console.log(JSON.stringify({status:'UNAPPROVED proposal only',planHash,maxRequests:2,providerRequests:0}));return;
  }
  const ledger=budget.createPgM3RequestBudget(sql,{budgetKey:'finance-live-pilot',expectedPlanHash:configuration.planHash,mode:'live'});
  if(action==='--finalize-plan'){
   const proposal=read('--plan','live-plan.proposed.json');policy.assertCurrentInventory(ROOT,proposal.sourceInventory);if(proposal.planHash!==configuration.planHash||budget.m3PlanHash(proposal.plan)!==proposal.planHash||proposal.plan.bindings.implementationHash!==implementationHash||proposal.plan.bindings.configHash!==configHash)noGo('proposal mismatch');const fresh=await currentProjection();if(fresh.inputHash!==proposal.plan.bindings.inputHash||!isDeepStrictEqual(fresh.baseline,proposal.expectedBaseline))noGo('input or active baseline changed');
   const planHash=await budget.finalizeM3DraftPlan(sql,{expectedDraftPlanHash:options.get('--expected-draft-hash')??'',plan:proposal.plan});console.log(JSON.stringify({status:'bound but UNAPPROVED',planHash,providerRequests:0}));return;
  }
  const manifest=read('--approval-manifest','approval-manifest.unapproved.json');
  if(manifest.schemaVersion!=='vantage-m3-live-approval/v1'||manifest.project!==PROJECT||manifest.approvalState!=='approved'||manifest.planHash!==configuration.planHash||manifest.maxRequests!==2||typeof manifest.authorizationRef!=='string'||!manifest.authorizationRef.trim()||!Number.isFinite(Date.parse(manifest.approvedAt))||manifest.configHash!==configHash||manifest.implementationHash!==implementationHash)noGo('explicit matching approval missing');
  policy.assertCurrentInventory(ROOT,manifest.sourceInventory);
  let snapshot=await ledger.snapshot();if(snapshot.reserved!==0||snapshot.requests.length||snapshot.plan.bindings.configHash!==configHash||snapshot.plan.bindings.implementationHash!==implementationHash||!isDeepStrictEqual(snapshot.plan.bindings,manifest.bindings))noGo('budget scope or usage mismatch');
  for(const kind of ['generation','judge']){const actual=configuration[kind].identity,planned=snapshot.plan.models[kind];for(const name of ['wireModelId','family','modelConfigHash','endpointHash'])if(actual[name]!==planned[name])noGo('model binding changed');}
  if(action==='--record-approval'){
   // Explicit operator action only; never called by validate/serve/run. This cannot reset usage.
   const fresh=await currentProjection();if(fresh.inputHash!==snapshot.plan.bindings.inputHash||!isDeepStrictEqual(fresh.baseline,manifest.expectedBaseline))noGo('fresh input/baseline mismatch');
   await sql.begin(async tx=>{await tx`SET LOCAL synchronous_commit='on'`;const rows=await tx`SELECT approval_state,reserved_count FROM pdr_ai_v2_vantage_m3_request_budgets WHERE budget_key='finance-live-pilot' AND plan_hash=${configuration.planHash} FOR UPDATE`;if(rows.length!==1||rows[0].approval_state!=='unapproved'||rows[0].reserved_count!==0)noGo('approval is immutable');const requests=await tx`SELECT request_id FROM pdr_ai_v2_vantage_m3_requests WHERE budget_key='finance-live-pilot'`;if(requests.length)noGo('used budget');await tx`UPDATE pdr_ai_v2_vantage_m3_request_budgets SET approval_state='approved-live',approval_manifest=${JSON.stringify(manifest)}::jsonb WHERE budget_key='finance-live-pilot'`;});console.log(JSON.stringify({status:'approval recorded; no launch or dispatch',planHash:configuration.planHash}));return;
  }
  budget.assertM3BudgetAuthorized(snapshot);if(!isDeepStrictEqual(snapshot.approvalManifest,manifest))noGo('durable approval differs');const current=await currentProjection();if(current.inputHash!==snapshot.plan.bindings.inputHash||!isDeepStrictEqual(current.baseline,manifest.expectedBaseline))noGo('current input or active baseline changed');
  if(action==='--validate'){console.log(JSON.stringify({status:'approved configuration and ledger validated; no dispatch',planHash:configuration.planHash,maxRequests:2}));return;}
  if(action==='--run-approved-once'){
   const cookie=await authenticate(),fresh=await preflight(cookie);if(fresh.executionMode!=='live'||fresh.livePlanHash!==configuration.planHash)noGo('target is not the approved live host');if(fresh.inputHash!==snapshot.plan.bindings.inputHash||!isDeepStrictEqual(fresh.baseline,manifest.expectedBaseline))noGo('input or active baseline changed');
   // Exactly one actual authenticated API POST; no retry on any status or transport failure.
   const response=await fetch(APP_URL+'/api/vantage/grounding',{method:'POST',redirect:'manual',headers:{cookie,origin:APP_URL,'content-type':'application/json'},body:JSON.stringify({expectedBaseline:fresh.baseline})});
   const receipt={at:new Date().toISOString(),status:response.status,planHash:configuration.planHash,apiPosts:1,retries:0};writeFileSync(resolve(RUNTIME_DIR,'live-one-shot-status.json'),JSON.stringify(receipt,null,2));if(response.status!==200)noGo('one-shot request failed; do not retry');console.log(JSON.stringify(receipt));return;
  }
  // App launch is separate from the single POST. It refuses occupied3188 and reads keys last.
  await new Promise((done,reject)=>{const server=createServer();server.once('error',()=>reject(Error('M3 app port is occupied; no automatic process termination')));server.listen(APP_PORT,'localhost',()=>server.close(done));});
  const credentialsPath=owned('--credentials-file','execution.env'),raw=readFileSync(credentialsPath,'utf8'),credentials={};for(const line of raw.split(/\r?\n/)){if(!line.trim()||line.trim().startsWith('#'))continue;const match=/^(VANTAGE_M3_GENERATION_API_KEY|VANTAGE_M3_JUDGE_API_KEY)=(.+)$/.exec(line);if(!match||credentials[match[1]])noGo('invalid credential file');credentials[match[1]]=match[2];}if(Object.keys(credentials).length!==2)noGo('both named credentials required');
  // No inherited provider environment, no worker, no automatic API request.
  const runtime=readRuntime(),env={...childEnvironment(runtime),...credentials,VANTAGE_GROUNDING_M3_LIVE:'true',VANTAGE_GROUNDING_M3_LIVE_CONFIG:owned('--config','live-execution.json'),VANTAGE_M3_APPROVAL_MANIFEST:owned('--approval-manifest','approval-manifest.unapproved.json'),VANTAGE_M3_LIVE_ENDPOINTS:JSON.stringify(endpoints),NODE_OPTIONS:`--require="${resolve(ROOT,'scripts/dev/vantage-grounding-approved-network.cjs').replaceAll('\\','/')}"`};
  const load=createRequire(resolve(ROOT,'apps/web/package.json'));if(!existsSync(resolve(ROOT,'scripts/dev/vantage-grounding-approved-network.cjs')))noGo('approved network guard missing');const child=spawn(process.execPath,[load.resolve('next/dist/bin/next'),'dev','--hostname','localhost','--port',String(APP_PORT)],{cwd:resolve(ROOT,'apps/web'),env,shell:false,windowsHide:true,stdio:['ignore','ignore','ignore']});
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));console.log('Approved M3 app starting; provider execution requires the separate one-shot command. Child logs are withheld to protect credentials.');await new Promise((done,reject)=>{child.once('error',reject);child.once('close',code=>{process.exitCode=code??1;done();});});
 }
}
