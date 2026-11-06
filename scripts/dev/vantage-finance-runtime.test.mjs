import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { childEnvironment, createRuntime, assertDatabaseUrl, DATABASE_PORT, APP_PORT } from './vantage-finance-runtime.mjs';
const guard=fileURLToPath(new URL('./vantage-finance-network-guard.cjs',import.meta.url));
test('fixed ports and child environment exclude inherited provider secrets',()=>{
 assert.equal(DATABASE_PORT,55446);assert.equal(APP_PORT,3186);
 const config=createRuntime();
 const env=childEnvironment(config,{PATH:process.env.PATH,OPENAI_API_KEY:'must-not-inherit',AZURE_OPENAI_API_KEY:'must-not-inherit',EMBEDDING_SECRETS_KEY:'must-not-inherit',NODE_OPTIONS:'must-not-inherit'});
 assert.equal(env.EMBEDDING_SECRETS_KEY,config.storageSecretKey);
 assert.equal(Buffer.from(env.EMBEDDING_SECRETS_KEY,'base64').length,32);
 assert.equal(env.OPENAI_API_KEY,undefined);assert.equal(env.AZURE_OPENAI_API_KEY,undefined);
 assert.match(env.NODE_OPTIONS,/vantage-finance-network-guard/);
 assert.equal(env.VANTAGE_FINANCE_M1_ENABLED,'true');
 assert.equal(env.VANTAGE_TEST_USER_IDS.split(',').length,2);
 assert.throws(()=>assertDatabaseUrl('postgres://x:y@127.0.0.1:55437/previous_demo'));
});
test('preload rejects DNS, fetch, TCP and TLS external targets before transport',()=>{
 const result=spawnSync(process.execPath,['--require',guard,'-e',`
 const assert=require('node:assert/strict');
 for(const operation of [()=>require('node:dns').lookup('example.com',()=>{}),()=>require('node:net').connect(443,'203.0.113.1'),()=>require('node:tls').connect(443,'example.com'),()=>fetch('https://example.com'),()=>require('node:http').get('http://example.com'),()=>require('node:https').get('https://example.com')])assert.throws(operation,{code:'VANTAGE_EXTERNAL_NETWORK_DENIED'});
 console.log('6 denied without transport');
 `],{encoding:'utf8',env:{SystemRoot:process.env.SystemRoot,PATH:process.env.PATH}});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/6 denied/);
});
test('preload permits a real local socket round trip',()=>{
 const result=spawnSync(process.execPath,['--require',guard,'-e',`
 const net=require('node:net');const server=net.createServer(socket=>socket.end('loopback-ok'));
 server.listen(0,'127.0.0.1',()=>{const client=net.connect(server.address().port,'127.0.0.1');let body='';client.on('data',x=>body+=x);client.on('end',()=>{require('node:assert/strict').equal(body,'loopback-ok');server.close();});});
 `],{encoding:'utf8',env:{SystemRoot:process.env.SystemRoot,PATH:process.env.PATH}});
 assert.equal(result.status,0,result.stderr);
});
