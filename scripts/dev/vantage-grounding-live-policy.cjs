'use strict';
// Source-only inventory: never reads .env files, runtime artifacts, or credentials.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const BASE_M2_COMMIT='8ad8c7fa185db7b54d5d406538be9a164e988c27';
const ROOTS=['apps','packages','pipelines','scripts','fixtures','patches'];
const OMIT=new Set(['node_modules','.next','.git','dist','build','coverage','test-output','.turbo','.cache','.aws','.codex','.agents']);
const EXTENSIONS=new Set(['.ts','.tsx','.js','.jsx','.mjs','.cjs','.json','.yaml','.yml','.css','.sql','.graphql','.patch']);
const ROOT_FILES=['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','turbo.json','tsconfig.json','.npmrc'];
/** @param {string|Buffer} value */
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
/** @param {string} root */
function sourceInventory(root){
 /** @type {{path:string,sha256:string}[]} */
 const files=[];
 /** @param {string} relative */
 function add(relative){const full=path.join(root,relative),stat=fs.lstatSync(full);if(stat.isSymbolicLink())throw new Error('M3 source inventory refuses symbolic links');if(stat.isDirectory()){for(const name of fs.readdirSync(full).sort()){if(!OMIT.has(name)&&!name.startsWith('.env'))add(path.join(relative,name));}}else if(stat.isFile()&&(EXTENSIONS.has(path.extname(relative))||ROOT_FILES.includes(relative))){files.push({path:relative.split(path.sep).join('/'),sha256:sha(fs.readFileSync(full))});}}
 for(const entry of [...ROOTS,...ROOT_FILES])if(fs.existsSync(path.join(root,entry)))add(entry);
 files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 const manifest={version:'vantage-m3-source-inventory/v1',baseM2Commit:BASE_M2_COMMIT,files};
 return {...manifest,inventoryHash:sha(JSON.stringify(manifest))};
}
/** @param {string} root @param {ReturnType<typeof sourceInventory>|null|undefined} approved */
function assertCurrentInventory(root,approved){const actual=sourceInventory(root);if(!approved||approved.version!==actual.version||approved.baseM2Commit!==BASE_M2_COMMIT||approved.inventoryHash!==actual.inventoryHash||JSON.stringify(approved.files)!==JSON.stringify(actual.files))throw new Error('M3 current source inventory does not match approval');return actual;}
/** @param {Record<string,{config:{endpoint:{baseUrl:string}}}>} configuration */
function reviewedEndpoints(configuration){/** @type {('generation'|'judge')[]} */const kinds=['generation','judge'];return kinds.map(kind=>{const raw=configuration[kind]?.config?.endpoint?.baseUrl;if(typeof raw!=='string')throw new Error('M3 live endpoint is missing');const url=new URL(raw);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!url.hostname||['localhost','127.0.0.1','::1','[::1]'].includes(url.hostname)||url.port&&url.port!=='443')throw new Error('M3 live endpoint is not reviewed HTTPS');return {kind,hostname:url.hostname,port:443,baseUrl:url.href.replace(/\/$/,'')};});}
module.exports={BASE_M2_COMMIT,sourceInventory,assertCurrentInventory,reviewedEndpoints};
