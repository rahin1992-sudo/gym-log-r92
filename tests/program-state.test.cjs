const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../program-state.js');
const program = JSON.parse(fs.readFileSync(path.join(__dirname, '../program-min-max-phase2.json'), 'utf8'));
const weeks = program.blocks.flatMap(b => b.weeks);

test('legacy migration retains completed sets, weights, selected week and other data', () => {
  const original = { week: 8, comeback: 0, logs: { 'w8|d0|e0': { done: true, sets: [{weight:'80', reps:'8', done:true}], alt:1 } }, wod: {items:[{done:true}]}, prefs:{cloudId:'existing'} };
  const before = JSON.stringify(original);
  const migrated = S.normalize(original);
  assert.equal(JSON.stringify(original), before);
  assert.equal(migrated.activeProgram, 'bts');
  assert.equal(migrated.week, 8);
  assert.deepEqual(migrated.logs, original.logs);
  assert.deepEqual(migrated.wod, original.wod);
  assert.equal(migrated.prefs.cloudId, 'existing');
  assert.deepEqual(S.normalize(migrated), migrated);
});

test('program keys and reset scope cannot collide, including optional arms', () => {
  for (let w=1; w<=12; w++) for (let d=0; d<=7; d++) {
    const old = S.key('bts',w,d,0), current = S.key(S.CURRENT,w,d,0);
    assert.notEqual(old,current);
    assert.ok(S.belongsTo(old,'bts'));
    assert.ok(!S.belongsTo(current,'bts'));
    assert.ok(S.belongsTo(current,S.CURRENT));
    assert.ok(!S.belongsTo(old,S.CURRENT));
  }
  assert.ok(!S.belongsTo('pain|d0|e0','bts'));
});

test('rest timer parses seconds, minutes, ranges and superset transitions', () => {
  assert.equal(S.restSeconds('30-60 sec'),30);
  assert.equal(S.restSeconds('30–60 sek','mid'),45);
  assert.equal(S.restSeconds('30-60 sec','high'),60);
  assert.equal(S.restSeconds('2-3 min','mid'),150);
  assert.equal(S.restSeconds('1,5 min'),90);
  assert.equal(S.restSeconds('-'),0);
});

test('restoring an old backup preserves new-program history and newer local lifts', () => {
  const current = S.normalize({ activeProgram:S.CURRENT, programWeeks:{bts:6,[S.CURRENT]:9}, logs:{
    'w1|d0|e0':{done:true,updatedAt:'2026-10-06',sets:[{weight:'90'}]},
    [S.key(S.CURRENT,9,0,0)]:{done:true,sets:[{weight:'100'}]},
  }});
  const merged = S.mergeBackup(current, {week:2,logs:{'w1|d0|e0':{updatedAt:'2026-10-01',sets:[{weight:'70'}]},'w2|d0|e0':{done:true}}});
  assert.equal(merged.logs['w1|d0|e0'].sets[0].weight,'90');
  assert.equal(merged.logs[S.key(S.CURRENT,9,0,0)].sets[0].weight,'100');
  assert.equal(merged.programWeeks[S.CURRENT],9);
  assert.equal(merged.programWeeks.bts,2);
  assert.deepEqual(S.mergeBackup(current,JSON.parse(JSON.stringify(current))),current);
  assert.throws(()=>S.mergeBackup(current,{logs:[]}));
  assert.throws(()=>S.mergeBackup(current,{logs:{broken:{sets:'bad'}}}));
  assert.throws(()=>S.normalize({schemaVersion:99}));
});

test('all 12 weeks contain the full 4-day plan, rest days and separate optional arms', () => {
  assert.deepEqual(weeks.map(w=>w.number), Array.from({length:12},(_,i)=>i+1));
  for(const w of weeks) {
    assert.deepEqual(w.days.filter(d=>d.type==='workout'&&!d.optional).map(d=>d.name),['Upper','Lower','Push','Pull']);
    assert.equal(w.days.filter(d=>d.type==='rest').length,2);
    assert.equal(w.days.filter(d=>!d.optional).reduce((sum,d)=>sum+d.exercises.length,0),33);
    const arms=w.days.find(d=>d.optional);
    assert.equal(arms.exercises.length,9);
    assert.equal(arms.exercises.filter(e=>e.optional).length,1);
    for(const d of w.days) for(const e of d.exercises) {
      assert.equal(e.rir.length,Number(e.workingSets));
      assert.ok(e.cue);
      for(const url of [e.youtube,e.sub1?.youtube,e.sub2?.youtube].filter(Boolean)) assert.match(url,/^https:\/\//);
      assert.ok(e.youtube);
      assert.ok(e.rir.every(r=>/^\d$/.test(r)));
    }
  }
});

test('week-specific effort, high-rep sets, supersets and block 2 techniques match sources', () => {
  const exercise=(week,name)=>weeks[week-1].days.flatMap(d=>d.exercises).find(e=>e.name===name);
  for(const w of [1,7]) assert.deepEqual(exercise(w,'Hack Squat').rir,['2','3']);
  for(const w of [2,3,4,8,9,10]) assert.deepEqual(exercise(w,'Hack Squat').rir,['1','2']);
  for(const w of [5,6,11,12]) assert.deepEqual(exercise(w,'Hack Squat').rir,['0','2']);
  for(const w of [2,6,8,12]) {
    assert.deepEqual(exercise(w,'Stiff-Leg Deadlift').rir,['1','2']);
    assert.deepEqual(exercise(w,'Pull-Up (Wide Grip)').rir,['0','1','1']);
  }
  assert.equal(exercise(1,'Machine Chest Press (high-rep set)').reps,'20');
  assert.equal(exercise(1,'EZ-Bar Cheat Curl').rest,'-');
  assert.equal(exercise(1,'EZ-Bar Skull Crusher').rest,'30-60 sec');
  assert.equal(exercise(7,'Seated Leg Curl').intensity,'');
  assert.match(exercise(8,'Seated Leg Curl').intensity,/Drop/);
  assert.match(exercise(12,'Standing Calf Raise').intensity,/Static/);
});
