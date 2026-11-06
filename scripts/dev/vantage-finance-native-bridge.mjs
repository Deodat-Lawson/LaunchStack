import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {ROOT,RUNTIME_DIR,readRuntime,assertDatabaseUrl,PROJECT} from './vantage-finance-runtime.mjs';
export async function bridgeNativeEvidence(config=readRuntime()) {
 assertDatabaseUrl(config.databaseUrl);
 const fixturePath=resolve(RUNTIME_DIR,'finance-fixture.json');
 const fixture=JSON.parse(readFileSync(fixturePath,'utf8'));
 const load=createRequire(resolve(ROOT,'packages/store/package.json'));
 const {default:postgres}=await import(pathToFileURL(load.resolve('postgres')).href);
 const sql=postgres(config.databaseUrl,{max:1,connect_timeout:5,onnotice:()=>{}});
 try {
  const [{marker}]=await sql`SELECT marker FROM _vantage_integration_identity`;assert.equal(marker,PROJECT);
  const {CONTEXTUAL_SCHEMA_SQL}=await import(pathToFileURL(resolve(ROOT,'apps/web/src/server/vantage/contextual-schema.ts')).href);
  await sql.unsafe(CONTEXTUAL_SCHEMA_SQL);
  const crosswalk=[];
  await sql.begin(async tx=>{
   for(const key of ['finance','sales']) {
    const doc=fixture.docs[key];
    const [row]=await tx`SELECT d.company_id::text,v.id::text AS version_id,s.content FROM pdr_ai_v2_document d JOIN pdr_ai_v2_document_versions v ON v.document_id=d.id AND v.id=d.current_version_id JOIN pdr_ai_v2_document_context_chunks s ON s.document_id=d.id AND s.version_id=v.id WHERE d.id=${doc.id}`;
    assert.equal(row.company_id,config.companyId);assert.equal(row.version_id,doc.versionId);assert.equal(row.content,doc.text);
    const [inventory]=await tx`SELECT native_evidence_id FROM pdr_ai_v2_vantage_contextual_inventory WHERE company_id=${config.companyId} AND document_id=${doc.id} AND logical_key=${key} FOR UPDATE`;
    assert.ok(inventory,'Missing reviewed fixture inventory identity');
    const evidenceId=inventory.native_evidence_id??randomUUID();
    const source=`Same underlying source as doc:${doc.id}@${doc.versionId}; duplicate intake is not corroboration.`;
    const sourceUrl=`local://workspace-document/${doc.id}/version/${doc.versionId}`;
    if(inventory.native_evidence_id) {
     const [existing]=await tx`SELECT body,source,source_url,company_id::text,created_by_user_id FROM pdr_ai_v2_vantage_evidence WHERE id=${evidenceId}`;
     assert.equal(existing.body,doc.text);assert.equal(existing.source,source);assert.equal(existing.source_url,sourceUrl);assert.equal(existing.company_id,config.companyId);assert.equal(existing.created_by_user_id,config.accounts[0].id);
    } else {
     await tx`INSERT INTO pdr_ai_v2_vantage_evidence(id,company_id,created_by_user_id,kind,title,body,source,source_url,observed_at,visibility,tags,created_at,updated_at) VALUES (${evidenceId},${config.companyId},${config.accounts[0].id},'document',${`${key==='finance'?'Finance':'Sales'} source copy (same underlying document)`},${doc.text},${source},${sourceUrl},'2026-10-16','private',${tx.json(['finance-m1-native-source-copy'])},'2026-10-16T12:00:00.000Z','2026-10-16T12:00:00.000Z')`;
     await tx`UPDATE pdr_ai_v2_vantage_contextual_inventory SET native_evidence_id=${evidenceId} WHERE company_id=${config.companyId} AND document_id=${doc.id}`;
    }
    crosswalk.push({logicalKey:key,documentRef:`doc:${doc.id}@${doc.versionId}`,nativeEvidenceId:evidenceId,nativeEvidenceRef:`evidence:${evidenceId}`,bodyHash:createHash('sha256').update(doc.text).digest('hex'),observedAt:'2026-10-16',sameUnderlyingSource:true,independentCorroboration:false});
   }
  });
  fixture.nativeEvidenceCrosswalk=crosswalk;writeFileSync(fixturePath,JSON.stringify(fixture,null,2));
  writeFileSync(resolve(RUNTIME_DIR,'native-evidence-crosswalk.json'),JSON.stringify({bridgedAt:new Date().toISOString(),crosswalk},null,2));
  console.log('Verified 2 native evidence copies linked to the same actual Finance/Sales document versions; no independent corroboration.');
 } finally {await sql.end({timeout:5});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await bridgeNativeEvidence();
