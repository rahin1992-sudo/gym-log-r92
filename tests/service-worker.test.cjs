const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
function setup(online=true){
  const handlers={};
  const cached=new Response('previous app shell');
  let added=[],stored=null,calls=0;
  const cache={addAll:async requests=>{added=requests;},match:async()=>cached,put:async(_request,response)=>{stored=await response.text();}};
  const ctx=vm.createContext({URL,Request,Response,
    self:{registration:{scope:'https://example.com/gym/'},addEventListener:(name,handler)=>handlers[name]=handler,skipWaiting:()=>{},clients:{claim:()=>{}}},
    caches:{open:async()=>cache,keys:async()=>[]},
    fetch:async()=>{calls++;if(!online)throw new Error('offline');return new Response('new app shell');},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8'),ctx);
  return {handlers,added:()=>added,stored:()=>stored,calls:()=>calls};
}
test('install requests bypass stale HTTP-cache entries for the new offline shell',async()=>{
  const app=setup();let pending;
  app.handlers.install({waitUntil:promise=>pending=promise});await pending;
  assert.ok(app.added().length>0);
  assert.ok(app.added().every(request=>request instanceof Request&&request.cache==='reload'));
});
test('online navigation replaces an outdated cached start page',async()=>{
  const app=setup();let pending;
  app.handlers.fetch({request:{method:'GET',url:'https://example.com/gym/',mode:'navigate'},respondWith:promise=>pending=promise});
  const response=await pending;
  assert.equal(await response.text(),'new app shell');
  assert.equal(app.stored(),'new app shell');
});
test('offline navigation still serves the saved app',async()=>{
  const app=setup(false);let pending;
  app.handlers.fetch({request:{method:'GET',url:'https://example.com/gym/',mode:'navigate'},respondWith:promise=>pending=promise});
  assert.equal(await (await pending).text(),'previous app shell');
});
