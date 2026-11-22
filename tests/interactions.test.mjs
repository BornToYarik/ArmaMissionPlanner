import test from 'node:test';
import assert from 'node:assert/strict';
import {RulerGesture,selectIds,labelSelection} from '../arma-planner-ui/public/planner/interactions.mjs';

test('ruler previews, fixes both ends and does not drift after completing',()=>{
  const r=new RulerGesture(),a=[1,2,3],b=[5,6,7],c=[8,9,10];
  assert.deepEqual(r.move(a),[a,null]);r.click(a);
  assert.deepEqual(r.move(b),[a,b]);r.click(b);
  assert.deepEqual(r.move(c),[a,b]);assert.deepEqual(r.click(c),[c,null]);
});
test('squad labels select all members, Shift adds or removes the whole selection',()=>{
  const units=[{id:1},{id:2},{id:3}],target={closest:()=>({dataset:{memberIds:'1,3'}})};
  const ids=labelSelection(target,units);assert.deepEqual(ids,[1,3]);
  const both=selectIds(new Set([2]),ids,true);assert.deepEqual([...both],[2,1,3]);
  assert.deepEqual([...selectIds(both,ids,true)],[2]);
  assert.deepEqual([...selectIds(both,[1])],[1]);
});
