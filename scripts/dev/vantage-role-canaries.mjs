import assert from 'node:assert/strict';
import {createRequire}from'node:module';import{pathToFileURL}from'node:url';import{resolve}from'node:path';import{readFileSync,writeFileSync}from'node:fs';import{createHash}from'node:crypto';
import{ROOT,RUNTIME_DIR,PROJECT,readRuntime,assertDatabaseUrl}from'./vantage-role-runtime.mjs';
export async function seedRoleCanaries(config=readRuntime()){
 assertDatabaseUrl(config.databaseUrl);const load=createRequire(resolve(ROOT,'packages/store/package.json'));const{default:postgres}=await import(pathToFileURL(load.resolve('postgres')).href);const sql=postgres(config.databaseUrl,{max:1,connect_timeout:5,onnotice:()=>{}});
 const canaries={},stamp='2026-10-30T12:00:00.000Z';
 try{
  const[{marker}]=await sql`SELECT marker FROM _vantage_integration_identity`;assert.equal(marker,PROJECT);
  await sql.begin(async tx=>{
   for(const[key,owner,text]of[
    ['peer',config.accounts[1],'CANARY_M2_PEER_PRIVATE_ONLY. Synthetic private peer note. This document is not authorized for the primary role-pair actor.'],
    ['outside',config.accounts[2],'CANARY_M2_OUTSIDE_COMPANY_ONLY. Synthetic private outside-company note. This document is not authorized for the primary role-pair actor.']
   ]){
    const companyId=owner.companyId;let[category]=await tx`SELECT id FROM pdr_ai_v2_category WHERE company_id=${companyId} AND name='Synthetic Role Pair ACL Canaries'`;
    if(!category)[category]=await tx`INSERT INTO pdr_ai_v2_category(name,company_id,created_at)VALUES('Synthetic Role Pair ACL Canaries',${companyId},${stamp})RETURNING id`;
    const creationKey=`role-m2:${config.runNamespace}:canary-${key}`,hash=createHash('sha256').update(text).digest('hex');let[doc]=await tx`SELECT id,current_version_id FROM pdr_ai_v2_document WHERE company_id=${companyId} AND creation_key=${creationKey}`;
    if(!doc){
     [doc]=await tx`INSERT INTO pdr_ai_v2_document(url,category,title,company_id,mime_type,ocr_processed,created_at,updated_at,creation_key)VALUES(${`local://role-m2/canary-${key}`},${String(category.id)},${`Synthetic ${key} private ACL canary`},${companyId},'text/plain',true,${stamp},${stamp},${creationKey})RETURNING id`;
     const[version]=await tx`INSERT INTO pdr_ai_v2_document_versions(document_id,version_number,url,mime_type,ocr_processed,ocr_metadata,created_at,creation_key)VALUES(${doc.id},1,${`local://role-m2/canary-${key}/v1`},'text/plain',true,${tx.json({text,syntheticRolePair:{canary:true,excludedFromSourcePool:true}})},${stamp},${creationKey})RETURNING id`;
     doc.current_version_id=version.id;await tx`UPDATE pdr_ai_v2_document SET current_version_id=${version.id} WHERE id=${doc.id}`;
     await tx`INSERT INTO pdr_ai_v2_document_context_chunks(document_id,version_id,content,char_count,token_count,content_hash,created_at,updated_at)VALUES(${doc.id},${version.id},${text},${text.length},${Math.ceil(text.length/4)},${hash},${stamp},${stamp})`;
    }
    const[section]=await tx`SELECT content FROM pdr_ai_v2_document_context_chunks WHERE document_id=${doc.id} AND version_id=${doc.current_version_id}`;assert.equal(section.content,text);
    await tx`INSERT INTO pdr_ai_v2_document_settings(company_id,document_id,restricted,updated_by,updated_at)VALUES(${companyId},${doc.id},true,${owner.id},${stamp})ON CONFLICT(document_id)DO NOTHING`;
    await tx`INSERT INTO pdr_ai_v2_document_grants(company_id,document_id,principal_type,principal_id,level,granted_by,created_at)VALUES(${companyId},${doc.id},'user',${owner.userPk},'view',${owner.id},${stamp})ON CONFLICT(document_id,principal_type,principal_id)DO NOTHING`;
    const grants=await tx`SELECT principal_type,principal_id FROM pdr_ai_v2_document_grants WHERE document_id=${doc.id}`;assert.equal(grants.length,1);assert.equal(grants[0].principal_type,'user');assert.equal(grants[0].principal_id,owner.userPk);
    const[{count:inventory}]=await tx`SELECT count(*)::int AS count FROM pdr_ai_v2_vantage_contextual_inventory WHERE document_id=${doc.id}`;assert.equal(inventory,0);
    const[{count:profileSources}]=await tx`SELECT count(*)::int AS count FROM pdr_ai_v2_company_profile_sources WHERE document_id=${doc.id}`;assert.equal(profileSources,0);
    canaries[key]={id:String(doc.id),versionId:String(doc.current_version_id),text,hash,companyId,ownerUserPk:owner.userPk,ownerAuthUserId:owner.id,sourceTimestamp:stamp,excludedFromSourcePool:true,excludedFromRequiredInventory:true,excludedFromArchitecture:true,excludedFromNativeBridge:true};
   }
  });
  const path=resolve(RUNTIME_DIR,'role-fixture.json');const fixture=JSON.parse(readFileSync(path,'utf8'));assert.equal(Object.keys(fixture.docs).length,10);fixture.canaries=canaries;writeFileSync(path,JSON.stringify(fixture,null,2));
  writeFileSync(resolve(RUNTIME_DIR,'canary-crosswalk.json'),JSON.stringify({createdOrVerifiedAt:new Date().toISOString(),canaries},null,2));
  console.log('Verified exactly two disjoint ACL canaries outside benchmark inventory/profile/native sources; existing source and role state unchanged.');
 }finally{await sql.end({timeout:5});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await seedRoleCanaries();
