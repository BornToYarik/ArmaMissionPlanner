import test from 'node:test';
import assert from 'node:assert/strict';
import {drapePath,zoneOutline,gameplayObject} from '../arma-planner-ui/public/planner/terrain-overlays.mjs';
import {terrainHeight} from '../arma-planner-ui/public/planner/wog/replay-math.js';

test('every draped edge follows a terrain triangle, including a peak between endpoints',()=>{
  const t={resolution:4,worldSize:30,heights:[0,0,0,0,0,30,0,0,0,0,20,0,0,0,0,0]},h=(x,y)=>terrainHeight(t,x,y);
  const path=drapePath([[1,4],[29,26]],[{bounds:[0,0,30,30],step:10}],h);
  assert.ok(path.length>5);assert.ok(Math.max(...path.map(p=>p[2]))>15);
  for(let i=1;i<path.length;i++)for(const f of [.1,.3,.5,.7,.9]){
    const a=path[i-1],b=path[i],p=a.map((v,k)=>v+(b[k]-v)*f);
    assert.ok(Math.abs(p[2]-h(p[0],p[1])-.25)<1e-6);
  }
});
test('drape includes detailed grid and can be recalculated during a terrain morph',()=>{
  const grids=[{bounds:[0,0,100,100],step:50},{bounds:[25,25,75,75],step:5}];
  const a=drapePath([[0,50],[100,50]],grids,()=>0),b=drapePath([[0,50],[100,50]],grids,(x,y)=>x/2);
  assert.ok(a.some(p=>p[0]===45));assert.equal(a.length,b.length);
  for(let i=0;i<a.length;i++)assert.equal(b[i][2]-a[i][2],b[i][0]/2);
});
test('rectangles preserve sharp corners before terrain subdivision',()=>{
  const points=zoneOutline({x:10,y:20,a:2,b:4,angle:0});
  assert.deepEqual(points,[[8,16,0],[12,16,0],[12,24,0],[8,24,0],[8,16,0]]);
});
test('RTS selection excludes buildings, wrecks and supplies while retaining static weapons',()=>{
  for(const vehicleClass of ['Land_House','Land_Qalat','Mi8Wreck','lex_82mm_ammobox','MASH_EP1','Box_NATO_Ammo_F']){
    assert.equal(gameplayObject({vehicleClass,mobility:'static'}),false,vehicleClass);
  }
  assert.equal(gameplayObject({vehicleClass:'Land_House',mobility:'wheeled'}),false);
  assert.equal(gameplayObject({vehicleClass:'Box_NATO_Ammo_F',mobility:'wheeled'}),false);
  assert.equal(gameplayObject({vehicleClass:'Mod_CustomDecoration',mobility:'wheeled',gameplay:false}),false);
  assert.equal(gameplayObject({vehicleClass:'Mod_CustomGun',mobility:'static',gameplay:true}),true);
  assert.equal(gameplayObject({vehicleClass:'Mod_CustomWreck',mobility:'tracked',gameplay:true}),false);
  for(const [vehicleClass,mobility]of [['O_Soldier_F','foot'],['rhs_bmp1','tracked'],['Mi8','air'],['LOP_TKA_Static_DSHKM','static'],['rhs_2b14_82mm_msv','static']])assert.equal(gameplayObject({vehicleClass,mobility}),true,vehicleClass);
});
