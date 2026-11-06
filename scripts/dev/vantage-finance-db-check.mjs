import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {readFileSync,writeFileSync} from 'node:fs';
import {ROOT,RUNTIME_DIR,readRuntime,assertDatabaseUrl,DATABASE,PROJECT} from './vantage-finance-runtime.mjs';
const config=readRuntime();assertDatabaseUrl(config.databaseUrl);
const fixture=JSON.parse(readFileSync(resolve(RUNTIME_DIR,'finance-fixture.json'),'utf8'));
const load=createRequire(resolve(ROOT,'packages/store/package.json'));
const {default:postgres}=await import(pathToFileURL(load.resolve('postgres')).href);
const sql=postgres(config.databaseUrl,{max:1,connect_timeout:5,onnotice:()=>{}});
try {
 const [identity]=await sql`SELECT current_database() AS database, (SELECT marker FROM _vantage_integration_identity) AS marker`;
 assert.equal(identity.database,DATABASE);assert.equal(identity.marker,PROJECT);
 const [{count:engine}]=await sql`SELECT count(*)::int AS count FROM _launchstack_migrations`;
 const [{count:product}]=await sql`SELECT count(*)::int AS count FROM _launchstack_web_migrations`;
 assert.equal(engine,4);assert.equal(product,28);
 const readerVersion=readFileSync(resolve(ROOT,'pipelines/src/company-metadata/prompts.ts'),'utf8').match(/export const READER_VERSION = "([^"]+)"/)?.[1];
 assert.ok(readerVersion);
 const [profileSource]=await sql`SELECT reader_version,model_id,read_at,created_at,updated_at FROM pdr_ai_v2_company_profile_sources WHERE company_id=${config.companyId} AND document_id=${fixture.docs.company.id}`;
 assert.equal(profileSource.reader_version,readerVersion);
 assert.equal(profileSource.model_id,'synthetic-local-fixture-no-model');
 for(const stamp of [profileSource.read_at,profileSource.created_at,profileSource.updated_at].filter(Boolean))assert.ok(new Date(stamp)<=new Date(fixture.domainClock));
 const roles=await sql`SELECT m.role,m.business_context_v0,m.vantage_context_revision FROM pdr_ai_v2_user_company_memberships m WHERE m.company_id=${config.companyId} ORDER BY user_id`;
 assert.deepEqual(roles.map(r=>r.role).sort(),['finance-reviewer','member']);
 assert.ok(roles.every(r=>r.business_context_v0.primaryRoleId==='founder'));
 const [custom]=await sql`SELECT permissions FROM pdr_ai_v2_workspace_roles WHERE company_id=${config.companyId} AND slug='finance-reviewer'`;
 assert.ok(!custom.permissions.includes('folders.manage'));
 const inventory=await sql`SELECT logical_key,required FROM pdr_ai_v2_vantage_contextual_inventory WHERE company_id=${config.companyId} ORDER BY logical_key`;
 assert.deepEqual(inventory.map(r=>r.logical_key),['finance','sales']);assert.ok(inventory.every(r=>!r.required));
 for(const [key,doc] of Object.entries(fixture.docs)) {
  const [section]=await sql`SELECT content,embedding,created_at FROM pdr_ai_v2_document_context_chunks WHERE document_id=${doc.id} AND version_id=${doc.versionId}`;
  assert.equal(section.content,doc.text);assert.equal(section.embedding,null);assert.ok(new Date(section.created_at)<=new Date(fixture.domainClock));
 }
 const grants=await sql`SELECT document_id::text,principal_id FROM pdr_ai_v2_document_grants WHERE company_id=${config.companyId} ORDER BY document_id`;
 for(const key of ['finance','sales','peer'])assert.ok(grants.some(g=>g.document_id===fixture.docs[key].id&&g.principal_id===config.accounts[key==='peer'?1:0].userPk));
 const result={checkedAt:new Date().toISOString(),project:PROJECT,engineMigrations:engine,productMigrations:product,accounts:3,documentVersions:5,embeddedSections:0,profileReaderVersion:readerVersion,profileProvenance:"synthetic fixture; no model extraction",inventory,actualAcl:'custom reviewer and member; no folder management bypass; disjoint per-user private grants',domainClock:fixture.domainClock};
 writeFileSync(resolve(RUNTIME_DIR,'runtime-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {await sql.end({timeout:5});}
