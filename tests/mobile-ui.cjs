const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = process.env.SHOT_DIR;
const stage = process.env.UI_STAGE || 'after';
const fixture = {schemaVersion:2,activeProgram:'min-max-phase-2',programWeeks:{bts:1,'min-max-phase-2':2},week:2,logs:{
  'min-max-phase-2|w1|d0|e0':{source:'user',name:'Machine Chest Press',done:true,sets:[{weight:'60',reps:'6',done:true},{weight:'60',reps:'5',done:true}]},
},prefs:{vibrate:false,keepAwake:false}};
const types={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json'};
const server = http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
  if(req.method!=='GET'||!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
  res.end(fs.readFileSync(file));
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true});
  try{
    const base=`http://127.0.0.1:${server.address().port}/`;
    const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2});
    await context.route(/https:\/\//,route=>route.abort());
    await context.addInitScript(data=>{
      if(!localStorage.getItem('bts-lift-v1'))localStorage.setItem('bts-lift-v1',JSON.stringify(data));
    },fixture);
    const page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'#/p/min-max-phase-2/w/2');
    await page.locator('#program-select').waitFor();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    if(output)await page.screenshot({path:path.join(output,`${stage}-home.png`)});
    await page.goto(base+'#/p/min-max-phase-2/w/2/d/0/e/0');
    await page.locator('.ex-card.open [data-w="0"]').waitFor();
    await page.evaluate(()=>scrollTo(0,0));
    if(output)await page.screenshot({path:path.join(output,`${stage}-workout.png`)});
    if(stage==='before') {console.log('Captured before: identical example data, 390 × 844 viewport.');return;}
    // Removing the primary set action must fail this task-level test.
    assert.equal(await page.locator('.ex-card.open [data-next-set]').count(),1,'A clearly labelled primary action must complete the next set');
    const open=page.locator('.ex-card.open');
    const primary=await open.locator('[data-next-set]').boundingBox();
    const navigation=await page.locator('.tabbar').boundingBox();
    assert.ok(primary.y+primary.height<=navigation.y,'The next-set action must be fully visible above mobile navigation');
    assert.match(await open.locator('.set-previous').first().textContent(),/60 kg × 6 reps/);
    await open.locator('[data-r="0"]').fill('6');
    await open.locator('[data-next-set]').click();
    assert.equal(await page.evaluate(()=>state.logs['min-max-phase-2|w2|d0|e0'].sets[0].done),true);
    assert.match(await open.locator('[data-next-set]').textContent(),/2/);
    assert.equal(await open.locator('[data-next-set]').evaluate(button=>button===document.activeElement),true,'The primary action must keep keyboard focus when moving to the next set');
    assert.equal(await open.locator('.set-row.current').count(),1);
    await open.locator('[data-r="1"]').fill('5');
    await open.locator('[data-next-set]').press('Enter');
    await page.waitForURL('**/e/1');
    assert.equal(await page.evaluate(()=>state.logs['min-max-phase-2|w2|d0|e0'].done),true);
    const dock=await page.locator('.timer-dock').boundingBox(), nav=await page.locator('.tabbar').boundingBox();
    assert.ok(dock.y+dock.height<=nav.y,'Rest timer and bottom navigation must not overlap');
    // Every ordinary set completion path still has undo and persists typed values.
    await page.goto(base+'#/p/min-max-phase-2/w/2/d/0/e/0');
    await page.locator('.ex-card.open').waitFor();
    await page.locator('.ex-card.open [data-sd="0"]').click();
    assert.equal(await page.evaluate(()=>state.logs['min-max-phase-2|w2|d0|e0'].sets[0].done),false);
    assert.equal(await page.locator('.ex-card.open [data-w="0"]').inputValue(),'60');
    const multi=await page.evaluate(()=>{
      for(const b of PROGRAMS.bts.blocks)for(const w of b.weeks)for(let d=0;d<w.days.length;d++){
        const e=w.days[d].exercises.findIndex(ex=>Number(ex.workingSets)>=3);
        if(e>=0)return {week:w.number,day:d,exercise:e};
      }
    });
    assert.ok(multi,'BTS fixture must include a workout with at least three sets');
    await page.setViewportSize({width:320,height:740});
    await page.goto(base+`#/p/bts/w/${multi.week}/d/${multi.day}/e/${multi.exercise}`);
    await page.locator('.ex-card.open').waitFor();
    const firstAction=await page.locator('.ex-card.open [data-next-set]').boundingBox();
    const shortNav=await page.locator('.tabbar').boundingBox();
    assert.ok(firstAction.y>=0&&firstAction.y+firstAction.height<=shortNav.y,'A long workout must show the next action without scrolling past later sets');
    await page.locator('.ex-card.open [data-next-set]').click();
    const nextAction=await page.locator('.ex-card.open [data-next-set]').boundingBox();
    const restDock=await page.locator('.timer-dock').boundingBox();
    assert.ok(nextAction.y>=64&&nextAction.y+nextAction.height<=restDock.y,'The next action must remain visible while the rest timer is active');
    for(const width of [320,390,768,1280]){
      await page.setViewportSize({width,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`No horizontal overflow at ${width}px`);
    }
    await page.setViewportSize({width:390,height:844});
    await page.goto(base+'#/p/min-max-phase-2/w/2');
    await page.locator('[data-resume]').waitFor();
    await page.locator('[data-resume]').click();
    await page.waitForURL('**/d/0');
    assert.deepEqual(errors,[]);
    console.log('PASS: next-set action, per-set comparison, persistence, undo, resume, mobile widths and timer separation.');
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
