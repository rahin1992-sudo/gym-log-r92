const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../program-state.js');
const program = JSON.parse(fs.readFileSync(path.join(__dirname,'../program-min-max-phase2.json'),'utf8'));
const source = fs.readFileSync(path.join(__dirname,'../app.js'),'utf8').replace(/\nboot\(\);\s*$/, '');
function setup(logs) {
  const ctx = vm.createContext({ProgramState:S,window:{addEventListener(){}},document:{addEventListener(){}}});
  vm.runInContext(source + '\nglobalThis.api = {lastForExercise, previousSession, abbreviationHelp};',ctx);
  ctx.fixtureProgram=program;
  ctx.fixtureState=S.normalize({activeProgram:S.CURRENT,logs});
  vm.runInContext('PROGRAM=fixtureProgram; state=fixtureState;',ctx);
  return ctx.api;
}
const key=(w,e)=>S.key(S.CURRENT,w,0,e);

test('week 2 shows each actual set from week 1, with week and session',()=>{
  const api=setup({[key(1,0)]:{source:'user',name:'Machine Chest Press',sets:[{weight:'60',reps:'6'},{weight:'55',reps:'5'}]}});
  const last=api.lastForExercise('Machine Chest Press',2,0);
  assert.equal(last.week,1);
  assert.equal(last.day,'Upper');
  const html=api.previousSession(last,{});
  assert.match(html,/60 kg × 6 reps/);
  assert.match(html,/55 kg × 5 reps/);
  assert.match(html,/Sæt 2/);
});

test('prefilled later weeks cannot hide actual previous training or mix high-rep sets',()=>{
  const api=setup({
    [key(1,0)]:{source:'user',sets:[{weight:'60',reps:'6'}]},
    [key(1,1)]:{source:'user',sets:[{weight:'30',reps:'20'}]},
    [key(2,0)]:{source:'prefill',sets:[{weight:'99',reps:''}]},
  });
  assert.equal(api.lastForExercise('Machine Chest Press',3,0).sets[0].weight,'60');
  assert.equal(api.lastForExercise('Machine Chest Press (high-rep set)',2,0,'Høje reps · lettere vægt').sets[0].weight,'30');
});

test('previous variants retain their own recorded performance',()=>{
  const api=setup({[key(1,0)]:{source:'user',alt:1,name:'Smith Machine Bench Press',sets:[{weight:'45',reps:'6'}],variants:{0:{source:'user',sets:[{weight:'60',reps:'6'}]},2:{source:'prefill',sets:[{weight:'20',reps:''}]}}}});
  assert.equal(api.lastForExercise('Machine Chest Press',2,0).sets[0].weight,'60');
  assert.equal(api.lastForExercise('Smith Machine Bench Press',2,0).sets[0].weight,'45');
  assert.equal(api.lastForExercise('DB Bench Press',2,0),null);
  const edited=setup({[key(1,0)]:{source:'user',alt:0,name:'Machine Chest Press',sets:[{weight:'65',reps:'7'}],variants:{0:{source:'user',sets:[{weight:'60',reps:'6'}]}}}});
  assert.equal(edited.lastForExercise('Machine Chest Press',2,0).sets[0].weight,'65');
});

test('bodyweight reps are visible and future sessions and other programs are excluded',()=>{
  const api=setup({
    [S.key(S.CURRENT,1,4,0)]:{source:'user',name:'Pull-Up (Wide Grip)',sets:[{weight:'',reps:'6'}]},
    [key(3,0)]:{source:'user',sets:[{weight:'100',reps:'6'}]},
    'w1|d0|e0':{source:'user',sets:[{weight:'90',reps:'6'}]},
  });
  assert.equal(api.lastForExercise('Machine Chest Press',2,0),null);
  const last=api.lastForExercise('Pull-Up (Wide Grip)',2,4);
  assert.equal(last.sets[0].reps,'6');
  assert.match(api.previousSession(last,{}),/Vægt ikke registreret × 6 reps/);
});

test('contextual abbreviation help describes the terms the exercise uses',()=>{
  const api=setup({});
  const html=api.abbreviationHelp({rir:['1'],superset:'S1',cue:'Use full ROM',intensity:'Failure + LLPs'},{name:'DB RDL'});
  for(const term of ['RIR','S1','DB','RDL','ROM','LLPs','Failure','Reps'])assert.ok(html.includes(`<dt>${term}</dt>`));
  assert.match(html,/1 = én tilbage/);
  assert.match(html,/ét sæt af hver øvelse/);
});
