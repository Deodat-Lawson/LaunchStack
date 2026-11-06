import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ROOT, RUNTIME_DIR, assertDatabaseUrl } from './vantage-finance-runtime.mjs';
export async function seedFinance(config) {
  assertDatabaseUrl(config.databaseUrl);
  const requireStore=createRequire(resolve(ROOT,'packages/store/package.json'));
  const {default:postgres}=await import(pathToFileURL(requireStore.resolve('postgres')).href);
  const sql=postgres(config.databaseUrl,{max:1,connect_timeout:5,onnotice:()=>{}});
  const stamp='2026-10-16T12:00:00.000Z';
  const readerVersion=readFileSync(resolve(ROOT,'pipelines/src/company-metadata/prompts.ts'),'utf8').match(/export const READER_VERSION = "([^"]+)"/)?.[1];
  if(!readerVersion)throw new Error('Could not resolve current profile reader contract version');
  try {
    const [{marker}]=await sql`SELECT marker FROM _vantage_integration_identity`;
    if(marker!==config.marker)throw new Error('Finance marker mismatch');
    const [{present}]=await sql`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='pdr_ai_v2_user_company_memberships' AND column_name='business_context_v0') AS present`;
    if(!present)await sql.unsafe(readFileSync(resolve(ROOT,'apps/web/drizzle/20261027000000_vantage_personal_context.sql'),'utf8'));
    const {CONTEXTUAL_SCHEMA_SQL}=await import(pathToFileURL(resolve(ROOT,'apps/web/src/server/vantage/contextual-schema.ts')).href);
    await sql.unsafe(CONTEXTUAL_SCHEMA_SQL);
    const sources=JSON.parse(readFileSync(resolve(ROOT,'fixtures/vantage-finance-milestone/sources.json'),'utf8').replace(/^\uFEFF/,''));
    const docs={};
    await sql.begin(async tx=>{
      const categories={};
      for(const [key,companyId] of [['primary',config.companyId],['outside',config.outsideCompanyId]]) {
        let [cat]=await tx`SELECT id FROM pdr_ai_v2_category WHERE company_id=${companyId} AND name='Synthetic Finance Milestone'`;
        if(!cat)[cat]=await tx`INSERT INTO pdr_ai_v2_category(name,company_id,created_at) VALUES ('Synthetic Finance Milestone',${companyId},${stamp}) RETURNING id`;
        categories[key]=String(cat.id);
      }
      for(const [key,text,companyId,category] of [
        ['finance',sources.finance,config.companyId,categories.primary],
        ['sales',sources.sales,config.companyId,categories.primary],
        ['company','Synthetic Finance Milestone builds business software. Finance and Sales use different revenue definitions. A human must reconcile provisional revenue and unsigned opportunities.',config.companyId,categories.primary],
        ['peer','Synthetic peer-private planning note; restricted to the peer.',config.companyId,categories.primary],
        ['outside','Synthetic outside company confidential revenue: USD 99,000.',config.outsideCompanyId,categories.outside],
      ]) {
        const creationKey=`finance-m1:${config.runNamespace}:${key}`;
        let [doc]=await tx`SELECT id,current_version_id FROM pdr_ai_v2_document WHERE company_id=${companyId} AND creation_key=${creationKey}`;
        if(!doc) {
          [doc]=await tx`INSERT INTO pdr_ai_v2_document(url,category,title,company_id,mime_type,ocr_processed,created_at,updated_at,creation_key) VALUES (${`local://finance-m1/${key}`},${category},${`Synthetic ${key} milestone document`},${companyId},'text/plain',true,${stamp},${stamp},${creationKey}) RETURNING id`;
          const [version]=await tx`INSERT INTO pdr_ai_v2_document_versions(document_id,version_number,url,mime_type,ocr_processed,ocr_metadata,created_at,creation_key) VALUES (${doc.id},1,${`local://finance-m1/${key}/v1`},'text/plain',true,${tx.json({text})},${stamp},${creationKey}) RETURNING id`;
          doc.current_version_id=version.id;
          await tx`UPDATE pdr_ai_v2_document SET current_version_id=${version.id} WHERE id=${doc.id}`;
          await tx`INSERT INTO pdr_ai_v2_document_context_chunks(document_id,version_id,content,char_count,token_count,content_hash,created_at,updated_at) VALUES (${doc.id},${version.id},${text},${text.length},${Math.ceil(text.length/4)},${createHash('sha256').update(text).digest('hex')},${stamp},${stamp})`;
        }
        docs[key]={id:String(doc.id),versionId:String(doc.current_version_id),text,hash:createHash('sha256').update(text).digest('hex')};
        if(['finance','sales'].includes(key))await tx`INSERT INTO pdr_ai_v2_vantage_contextual_inventory(company_id,document_id,required,logical_key) VALUES (${companyId},${doc.id},false,${key}) ON CONFLICT(company_id,document_id) DO UPDATE SET logical_key=EXCLUDED.logical_key`;
      }
      const fact=value=>({value,visibility:'internal',usage:'no_outreach',confidence:1,priority:'normal',status:'active',last_updated:stamp,sources:[{doc_id:Number(docs.company.id),version_id:Number(docs.company.versionId),doc_name:'Synthetic company milestone document',extracted_at:stamp,quote:docs.company.text}]});
      const metadata={schema_version:'1.1.0',company_id:config.companyId,updated_at:stamp,company:{name:fact('Synthetic Finance Milestone'),description:fact(docs.company.text)},people:[],services:[],markets:{},projects:[],policies:{},legal:[],profile:{},provenance:{total_documents_processed:1,extraction_model:'synthetic-local-fixture-no-model',extraction_version:'1.1.0'}};
      await tx`INSERT INTO pdr_ai_v2_company_metadata(company_id,schema_version,metadata,build_status,created_at,updated_at,built_at) VALUES (${config.companyId},'1.1.0',${tx.json(metadata)},'idle',${stamp},${stamp},${stamp}) ON CONFLICT(company_id) DO NOTHING`;
      await tx`INSERT INTO pdr_ai_v2_company_profile_sources(company_id,document_id,version_id,role,role_by,status,facts,fact_count,passages,reader_version,model_id,read_at,created_at) VALUES (${config.companyId},${docs.company.id},${docs.company.versionId},'about_us','rules','done',${tx.json({company:metadata.company})},2,${tx.json({total:1,kept:1,dropped:{}})},${readerVersion},'synthetic-local-fixture-no-model',${stamp},${stamp}) ON CONFLICT(company_id,document_id) DO UPDATE SET reader_version=EXCLUDED.reader_version,read_at=EXCLUDED.read_at`;
      const owner=config.accounts[0], peer=config.accounts[1];
      await tx`INSERT INTO pdr_ai_v2_workspace_roles(company_id,slug,name,permissions,created_by,created_at) VALUES (${config.companyId},'finance-reviewer','Synthetic Finance Reviewer',ARRAY['documents.read','documents.edit','settings.manage'],${owner.id},${stamp}) ON CONFLICT(company_id,slug) DO UPDATE SET permissions=EXCLUDED.permissions`;
      await tx`UPDATE pdr_ai_v2_user_company_memberships SET role='finance-reviewer' WHERE company_id=${config.companyId} AND user_id=${owner.userPk}`;
      await tx`UPDATE pdr_ai_v2_user_company_memberships SET role='member' WHERE company_id=${config.companyId} AND user_id=${peer.userPk}`;
      for(const key of ['finance','sales','peer']) {
        const principal=key==='peer'?peer:owner;
        await tx`INSERT INTO pdr_ai_v2_document_settings(company_id,document_id,restricted,updated_by,updated_at) VALUES (${config.companyId},${docs[key].id},true,${owner.id},${stamp}) ON CONFLICT(document_id) DO NOTHING`;
        await tx`INSERT INTO pdr_ai_v2_document_grants(company_id,document_id,principal_type,principal_id,level,granted_by,created_at) VALUES (${config.companyId},${docs[key].id},'user',${principal.userPk},'view',${owner.id},${stamp}) ON CONFLICT(document_id,principal_type,principal_id) DO NOTHING`;
      }
      for(const account of config.accounts) {
        await tx`UPDATE pdr_ai_v2_users SET title='Founder' WHERE id=${account.userPk}`;
        await tx`UPDATE pdr_ai_v2_user_company_memberships SET business_context_v0=${tx.json({roleIds:['founder'],primaryRoleId:'founder',confirmedAt:stamp})},vantage_context_revision=1 WHERE user_id=${account.userPk} AND company_id=${account.companyId} AND business_context_v0 IS NULL`;
      }
    });
    writeFileSync(resolve(RUNTIME_DIR,'finance-fixture.json'),JSON.stringify({version:'finance-m1/v1',actualExecutionAt:new Date().toISOString(),domainClock:'2026-10-19T12:00:00.000Z',sourceTimestamp:stamp,companyId:config.companyId,outsideCompanyId:config.outsideCompanyId,accounts:config.accounts,docs},null,2));
  } finally {await sql.end({timeout:5});}
}
