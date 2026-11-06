import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {RUNTIME_DIR} from './vantage-role-runtime.mjs';
const path=resolve(RUNTIME_DIR,'network-denials.jsonl');
const events=existsSync(path)?readFileSync(path,'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line)):[];
const groups=new Map();
for(const event of events){const key=event.hostname?`${event.entry}:${event.transport}:${event.hostname}`:'origin-not-recorded';groups.set(key,(groups.get(key)??0)+1);}
const result={checkedAt:new Date().toISOString(),deniedAttempts:events.length,originsNotRecorded:events.filter(e=>!e.hostname).length,groups:Object.fromEntries(groups),boundary:'Node transport guard. Denied attempts are not dispatched requests; this is not an OS firewall audit.'};
writeFileSync(resolve(RUNTIME_DIR,'network-summary.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
