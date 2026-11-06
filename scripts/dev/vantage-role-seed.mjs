import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {ROOT,RUNTIME_DIR,PROJECT,APP_URL,accountsFor,workspaceSlugsFor,assertDatabaseUrl} from './vantage-role-runtime.mjs';
const hash=text=>createHash('sha256').update(text).digest('hex');
export async function seedRole(config) {
 assertDatabaseUrl(config.databaseUrl);
 const load=createRequire(resolve(ROOT,'packages/store/package.json'));
 const {default:postgres}=await import(pathToFileURL(load.resolve('postgres')).href);
 const web=createRequire(resolve(ROOT,'apps/web/package.json'));
 const {hashPassword}=await import(pathToFileURL(web.resolve('better-auth/crypto')).href);
 const passwordHash=await hashPassword(config.loginPassword);
 const fixture=JSON.parse(readFileSync(resolve(ROOT,'fixtures/vantage-role-pair-milestone/sources.json'),'utf8').replace(/^\uFEFF/,''));
 assert.equal(fixture.syntheticOnly,true);assert.equal(fixture.documents.length,10);
 assert.equal(new Set(fixture.documents.map(d=>d.logicalKey)).size,10);
 const readerVersion=readFileSync(resolve(ROOT,'pipelines/src/company-metadata/prompts.ts'),'utf8').match(/export const READER_VERSION = "([^"]+)"/)?.[1];assert.ok(readerVersion);
 const sql=postgres(config.databaseUrl,{max:1,connect_timeout:5,onnotice:()=>{}});
 const docs={},crosswalk=[];const profileStamp='2026-10-30T12:00:00.000Z';
 try {
  const [{marker}]=await sql`SELECT marker FROM _vantage_integration_identity`;assert.equal(marker,PROJECT);
  const [{present}]=await sql`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='pdr_ai_v2_user_company_memberships' AND column_name='business_context_v0') AS present`;
  if(!present)await sql.unsafe(readFileSync(resolve(ROOT,'apps/web/drizzle/20261027000000_vantage_personal_context.sql'),'utf8'));
  const {CONTEXTUAL_SCHEMA_SQL,ROLE_CONTEXTUAL_SCHEMA_SQL}=await import(pathToFileURL(resolve(ROOT,'apps/web/src/server/vantage/contextual-schema.ts')).href);
  assert.ok(ROLE_CONTEXTUAL_SCHEMA_SQL);await sql.unsafe(CONTEXTUAL_SCHEMA_SQL);await sql.unsafe(ROLE_CONTEXTUAL_SCHEMA_SQL);
  await sql.begin(async tx=>{
   const slugs=workspaceSlugsFor(config),companies={};config.companySlugs=slugs;
   for(const key of ['primary','outside']) {
    let [company]=await tx`SELECT id FROM pdr_ai_v2_company WHERE slug=${slugs[key]}`;
    if(!company)[company]=await tx`INSERT INTO pdr_ai_v2_company(name,slug,"numberOfEmployees",use_uploadthing) VALUES (${key==='primary'?'Synthetic CampusLoop Role Pair':'Synthetic Role Pair Outside'},${slugs[key]},'3',false) RETURNING id`;
    companies[key]=String(company.id);
   }
   config.companyId=companies.primary;config.outsideCompanyId=companies.outside;config.accounts=[];
   for(const [index,account] of accountsFor(config).entries()) {
    const companyId=companies[account.workspace];
    const [existing]=await tx`SELECT email FROM pdr_ai_v2_auth_user WHERE id=${account.id}`;if(existing)assert.equal(existing.email,account.email);
    await tx`INSERT INTO pdr_ai_v2_auth_user(id,name,email,email_verified,created_at,updated_at) VALUES (${account.id},${account.name},${account.email},true,now(),now()) ON CONFLICT(id) DO NOTHING`;
    await tx`INSERT INTO pdr_ai_v2_auth_account(id,issuer,account_id,provider_id,user_id,password,created_at,updated_at) VALUES (${`${account.id}-credential`},'local:credential',${account.id},'credential',${account.id},${passwordHash},now(),now()) ON CONFLICT(id) DO NOTHING`;
    let [user]=await tx`SELECT id,company_id FROM pdr_ai_v2_users WHERE "userId"=${account.id}`;
    if(!user)[user]=await tx`INSERT INTO pdr_ai_v2_users(name,email,"userId",company_id) VALUES (${account.name},${account.email},${account.id},${companyId}) RETURNING id,company_id`;
    assert.equal(String(user.company_id),companyId);
    const role=index===0?'role-reviewer':'member';
    await tx`INSERT INTO pdr_ai_v2_user_company_memberships(user_id,company_id,role,status) VALUES (${user.id},${companyId},${role},'active') ON CONFLICT(user_id,company_id) DO NOTHING`;
    config.accounts.push({...account,userPk:String(user.id),companyId,permissionRole:role});
   }
   const owner=config.accounts[0];
   await tx`INSERT INTO pdr_ai_v2_workspace_roles(company_id,slug,name,permissions,created_by,created_at) VALUES (${config.companyId},'role-reviewer','Synthetic Role Pair Reviewer',ARRAY['documents.read','documents.edit','settings.manage'],${owner.id},${profileStamp}) ON CONFLICT(company_id,slug) DO NOTHING`;
   let [category]=await tx`SELECT id FROM pdr_ai_v2_category WHERE company_id=${config.companyId} AND name='Synthetic Role Pair Sources'`;
   if(!category)[category]=await tx`INSERT INTO pdr_ai_v2_category(name,company_id,created_at) VALUES ('Synthetic Role Pair Sources',${config.companyId},${profileStamp}) RETURNING id`;
   for(const source of fixture.documents) {
    assert.equal(hash(source.text),source.contentSha256);const stamp=`${source.sourceDate}T12:00:00.000Z`;assert.ok(Date.parse(stamp)<=Date.parse(fixture.asOf));
    const creationKey=`role-m2:${config.runNamespace}:${source.logicalKey}`;
    let [doc]=await tx`SELECT id,current_version_id FROM pdr_ai_v2_document WHERE company_id=${config.companyId} AND creation_key=${creationKey}`;
    if(!doc) {
     [doc]=await tx`INSERT INTO pdr_ai_v2_document(url,category,title,company_id,mime_type,ocr_processed,created_at,updated_at,creation_key) VALUES (${`local://role-m2/${source.logicalKey}`},${String(category.id)},${source.title},${config.companyId},'text/plain',true,${stamp},${stamp},${creationKey}) RETURNING id`;
     const [version]=await tx`INSERT INTO pdr_ai_v2_document_versions(document_id,version_number,url,mime_type,ocr_processed,ocr_metadata,created_at,creation_key) VALUES (${doc.id},1,${`local://role-m2/${source.logicalKey}/v1`},'text/plain',true,${tx.json({text:source.text,syntheticRolePair:{originalSource:source.originalSource,materialization:'local synthetic exact-text document; no connector or public network read'}})},${stamp},${creationKey}) RETURNING id`;
     doc.current_version_id=version.id;await tx`UPDATE pdr_ai_v2_document SET current_version_id=${version.id} WHERE id=${doc.id}`;
     await tx`INSERT INTO pdr_ai_v2_document_context_chunks(document_id,version_id,content,char_count,token_count,content_hash,created_at,updated_at) VALUES (${doc.id},${version.id},${source.text},${source.text.length},${Math.ceil(source.text.length/4)},${source.contentSha256},${stamp},${stamp})`;
    }
    const [section]=await tx`SELECT content FROM pdr_ai_v2_document_context_chunks WHERE document_id=${doc.id} AND version_id=${doc.current_version_id}`;assert.equal(section.content,source.text);
    await tx`INSERT INTO pdr_ai_v2_document_settings(company_id,document_id,restricted,updated_by,updated_at) VALUES (${config.companyId},${doc.id},true,${owner.id},${stamp}) ON CONFLICT(document_id) DO NOTHING`;
    await tx`INSERT INTO pdr_ai_v2_document_grants(company_id,document_id,principal_type,principal_id,level,granted_by,created_at) VALUES (${config.companyId},${doc.id},'user',${owner.userPk},'view',${owner.id},${stamp}) ON CONFLICT(document_id,principal_type,principal_id) DO NOTHING`;
    await tx`INSERT INTO pdr_ai_v2_vantage_contextual_inventory(company_id,document_id,required,logical_key) VALUES (${config.companyId},${doc.id},${source.required},${source.logicalKey}) ON CONFLICT(company_id,document_id) DO NOTHING`;
    docs[source.logicalKey]={id:String(doc.id),versionId:String(doc.current_version_id),text:source.text,hash:source.contentSha256,sourceDate:source.sourceDate,sourceTimestamp:stamp,sourceType:source.sourceType,title:source.title,originalSource:source.originalSource,roleIds:source.roleIds,required:source.required,materialization:'Exact historical text in actual local document/version/section; original source kind retained as provenance, not a live connector.'};
    if(['D01','D08'].includes(source.logicalKey)) {
     const [inventory]=await tx`SELECT native_evidence_id FROM pdr_ai_v2_vantage_contextual_inventory WHERE company_id=${config.companyId} AND document_id=${doc.id}`;
     const id=inventory.native_evidence_id??randomUUID(),ref=`doc:${doc.id}@${doc.current_version_id}`,sourceLabel=`Same underlying source as ${ref}; duplicate intake is not corroboration.`,url=`local://workspace-document/${doc.id}/version/${doc.current_version_id}`;
     if(!inventory.native_evidence_id) {
      await tx`INSERT INTO pdr_ai_v2_vantage_evidence(id,company_id,created_by_user_id,kind,title,body,source,source_url,observed_at,visibility,tags,created_at,updated_at) VALUES (${id},${config.companyId},${owner.id},'document',${`${source.title} (same underlying document)`},${source.text},${sourceLabel},${url},${source.sourceDate},'private',${tx.json(['role-m2-native-source-copy'])},${stamp},${stamp})`;
      await tx`UPDATE pdr_ai_v2_vantage_contextual_inventory SET native_evidence_id=${id} WHERE company_id=${config.companyId} AND document_id=${doc.id}`;
     } else {const [e]=await tx`SELECT body,source_url FROM pdr_ai_v2_vantage_evidence WHERE id=${id}`;assert.equal(e.body,source.text);assert.equal(e.source_url,url);}
     crosswalk.push({logicalKey:source.logicalKey,documentRef:ref,nativeEvidenceId:id,hash:source.contentSha256,independentCorroboration:false});
    }
   }
   const companyDoc=docs.D04;
   const fact=value=>({value,visibility:'internal',usage:'no_outreach',confidence:1,priority:'normal',status:'active',last_updated:profileStamp,sources:[{doc_id:Number(companyDoc.id),version_id:Number(companyDoc.versionId),doc_name:companyDoc.title,extracted_at:profileStamp,quote:companyDoc.text}]});
   const metadata={schema_version:'1.1.0',company_id:config.companyId,updated_at:profileStamp,company:{name:fact('CampusLoop'),description:fact(companyDoc.text)},people:[],services:[],markets:{},projects:[],policies:{},legal:[],profile:{},provenance:{total_documents_processed:1,extraction_model:'synthetic-local-fixture-no-model',extraction_version:'1.1.0'}};
   await tx`INSERT INTO pdr_ai_v2_company_metadata(company_id,schema_version,metadata,build_status,created_at,updated_at,built_at) VALUES (${config.companyId},'1.1.0',${tx.json(metadata)},'idle',${profileStamp},${profileStamp},${profileStamp}) ON CONFLICT(company_id) DO NOTHING`;
   await tx`INSERT INTO pdr_ai_v2_company_profile_sources(company_id,document_id,version_id,role,role_by,status,facts,fact_count,passages,reader_version,model_id,read_at,created_at) VALUES (${config.companyId},${companyDoc.id},${companyDoc.versionId},'about_us','rules','done',${tx.json({company:metadata.company})},2,${tx.json({total:1,kept:1,dropped:{}})},${readerVersion},'synthetic-local-fixture-no-model',${profileStamp},${profileStamp}) ON CONFLICT(company_id,document_id) DO NOTHING`;
  });
  const result={version:'role-m2/v1',actualExecutionAt:new Date().toISOString(),domainClock:fixture.asOf,companyProfileTimestamp:profileStamp,reportWindow:fixture.reportWindow,companyId:config.companyId,outsideCompanyId:config.outsideCompanyId,accounts:config.accounts,docs,nativeEvidenceCrosswalk:crosswalk,selectedRoleIds:['partnerships-lead','security-engineer'],initialRoleState:'unconfirmed; both selection and primary persisted only through real Joseph API',companyArchitectureReview:'unreviewed synthetic projection; real authenticated review required',sourceFixtureHash:hash(readFileSync(resolve(ROOT,'fixtures/vantage-role-pair-milestone/sources.json'),'utf8'))};
  writeFileSync(resolve(RUNTIME_DIR,'role-fixture.json'),JSON.stringify(result,null,2));writeFileSync(resolve(RUNTIME_DIR,'native-evidence-crosswalk.json'),JSON.stringify(crosswalk,null,2));
  writeFileSync(resolve(RUNTIME_DIR,'sanitized-runtime.json'),JSON.stringify({project:PROJECT,appUrl:APP_URL,database:{host:'127.0.0.1',port:55447,name:'vantage_role_m2_20261106'},accounts:config.accounts,provider:'deterministic role-pair replay; no live model transport',environment:'system allowlist and synthetic-only settings; no inherited provider keys or dotenv',domainClock:fixture.asOf,authClock:'real wall clock',roles:'initially unconfirmed; both selections and primary updated via actual Joseph API',review:'not approved by seed',preparedAt:new Date().toISOString()},null,2));
 }finally{await sql.end({timeout:5});}
}
