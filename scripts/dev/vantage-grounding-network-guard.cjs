'use strict';
// Loaded in every app/migration subprocess. No remote DNS or network transport.
const net = require('node:net');
const dns = require('node:dns');
const tls = require('node:tls');
function isLocal(host) { return ['localhost','127.0.0.1','::1','[::1]'].includes(String(host).toLowerCase()); }
function deny(host, transport = "tcp") {
  const log=process.env.VANTAGE_GROUNDING_NETWORK_LOG;
  if(log){try{require('node:fs').appendFileSync(log,JSON.stringify({at:new Date().toISOString(),pid:process.pid,entry:require('node:path').basename(process.argv[1]??'eval'),transport,hostname:/^[a-zA-Z0-9.:[\]-]{1,253}$/.test(String(host))?String(host):'[omitted]',code:'VANTAGE_EXTERNAL_NETWORK_DENIED'})+'\n');}catch{ /* Denial never depends on logging. */ }};
  const e = new Error('Grounding synthetic runtime blocked non-loopback network destination'); e.code='VANTAGE_EXTERNAL_NETWORK_DENIED'; throw e; }
function check(args, transport = "tcp") {
  const first=args[0];
  const options=first && typeof first==='object' ? first : typeof first==='number' ? {port:first,host:typeof args[1]==='string'?args[1]:'localhost'} : {path:first};
  if (options.path || options.socketPath) deny('socket', transport);
  const host=options.host ?? options.hostname ?? 'localhost';
  if (!isLocal(host)) deny(host,transport);
}
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args) {
  // net.connect passes its normalized argument array to Socket.connect.
  check(Array.isArray(args[0])?args[0]:args);
  return connect.apply(this,args);
};
const secure=tls.connect;
tls.connect=function(...args){check(args,"tls");return secure.apply(this,args);};
const lookup=dns.lookup;
dns.lookup=function(host,...args){if(!isLocal(host))deny(host,"dns");return lookup.call(this,host,...args);};
const lookupPromise=dns.promises.lookup;
dns.promises.lookup=function(host,...args){if(!isLocal(host))deny(host,"dns");return lookupPromise.call(this,host,...args);};
// Cover every public resolver function, including future resolve* variants and instances.
function guardResolverMethods(target,promises) {
  for(const name of Object.getOwnPropertyNames(target)) {
    if(!/^(?:resolve[A-Za-z0-9]*|reverse|lookupService)$/.test(name)||typeof target[name]!=='function')continue;
    target[name]=promises?async function(host){deny(host??'DNS','dns');}:function(host){deny(host??'DNS','dns');};
  }
}
guardResolverMethods(dns,false);guardResolverMethods(dns.promises,true);
for(const [Constructor,promises]of [[dns.Resolver,false],[dns.promises.Resolver,true]]) {
  for(let prototype=Constructor?.prototype;prototype&&prototype!==Object.prototype;prototype=Object.getPrototypeOf(prototype))guardResolverMethods(prototype,promises);
}
require('node:module').syncBuiltinESMExports();
const originalFetch=globalThis.fetch;
if(originalFetch)globalThis.fetch=function(input,...args){const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(!isLocal(url.hostname))deny(url.hostname,"fetch");return originalFetch.call(this,input,...args);};
module.exports={isLocal};
