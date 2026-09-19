import test from 'node:test';
import assert from 'node:assert/strict';
import {createSelectionStore} from '../../coffee-terminal/web/twin/studio/selection-store.mjs';
import {createEntityIndex} from '../../coffee-terminal/web/twin/studio/entity-index.mjs';

test('selection store keeps only stable refs, deduplicates and reconciles removed entities', () => {
  const store=createSelectionStore(), seen=[];
  store.subscribe(value=>seen.push(value),{immediate:true});
  store.select({kind:'device',id:'brewer',ignored:{x:1}},'tree');
  store.select({kind:'device',id:'brewer'},'viewport');
  assert.deepEqual(store.get(),{kind:'device',id:'brewer',source:'tree'});
  assert.equal(seen.length,2);
  store.reconcile(ref=>ref.id!=='brewer');
  assert.equal(store.get(),null);
  assert.equal(seen.length,3);
});

test('entity index links tasks to devices, robots, objects, stations and grippers without replacing task selection', () => {
  const config={
    robots:{left:{model:'robot'}},
    grippers:{'left-gripper':{robot:'left'}},
    stations:{brew:{label:'Brew'},cups:{label:'Cups'}},
    devices:{brewer:{station:'brew'}},
    objects:{cup:{capacityKg:.3}}
  };
  const tasks=[
    {id:'extract',type:'process',device:'brewer',object:'cup',after:[],resources:[]},
    {id:'left-grasp',type:'grasp',robot:'left',object:'cup',after:[],resources:[]},
    {id:'left-to-brew',type:'move',robot:'left',station:'brew',after:[],resources:[]}
  ];
  const index=createEntityIndex(config,tasks);
  assert.ok(index.has({kind:'task',id:'extract'}));
  assert.deepEqual(new Set(index.related({kind:'task',id:'extract'}).map(x=>`${x.kind}:${x.id}`)),new Set(['device:brewer','object:cup','station:brew']));
  assert.deepEqual(new Set(index.relatedTasks({kind:'device',id:'brewer'})),new Set(['extract']));
  assert.deepEqual(new Set(index.relatedTasks({kind:'robot',id:'left'})),new Set(['left-grasp','left-to-brew']));
  assert.ok(index.related({kind:'task',id:'left-grasp'}).some(x=>x.kind==='gripper'&&x.id==='left-gripper'));
  assert.ok(index.related({kind:'device',id:'brewer'}).some(x=>x.kind==='station'&&x.id==='brew'));
});


test('entity reconciliation does not keep phantom devices referenced by stale tasks',()=>{
  const index=createEntityIndex({robots:{},grippers:{},devices:{},stations:{},objects:{}},[{id:'old-task',device:'removed',robot:'removed',object:'removed',station:'removed'}]);
  for(const kind of ['device','robot','object','station'])assert.equal(index.has({kind,id:'removed'}),false);
  const selection=createSelectionStore();selection.select({kind:'device',id:'removed'});selection.reconcile(ref=>index.has(ref));assert.equal(selection.get(),null);
});
