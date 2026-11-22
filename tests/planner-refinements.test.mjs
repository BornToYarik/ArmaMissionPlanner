import test from 'node:test';
import assert from 'node:assert/strict';
import {shortRole,routeVisible,farthestPoints,sideColor,initialVehicleSide} from '../arma-planner-ui/public/planner/planning-units.mjs';
import {straightenRoute,reachable,profiles,sampleRouteHeights,travelTime} from '../arma-planner-ui/public/planner/core.mjs';
test('role names use the chosen language, with distinct support roles',()=>{
 assert.equal(shortRole('Командир взвода | Platoon Leader','ru'),'КВ');
 assert.equal(shortRole('Командир взвода | Platoon Leader','en'),'PL');
 assert.equal(shortRole('Помощник пулемётчика | Assistant machinegunner'),'ПП');
 assert.equal(shortRole('Пулемётчик | Machinegunner'),'Пул');
 assert.notEqual(sideColor('East'),sideColor('West'));
});
test('individual route branches do not expose another units waypoints',()=>{
 const shared=[{id:1},{id:2},{id:3}],branch={id:2};
 assert.equal(shared.filter(s=>routeVisible(s,new Set([2]))).length,1);
 assert.equal(routeVisible(branch,new Set([1,3])),false);
 assert.equal(routeVisible({id:10,members:[2]},new Set([2])),true);
});
const grid=()=>({x:0,y:0,step:10,nx:11,ny:11,heights:new Float32Array(121),blocked:new Uint8Array(121),roads:new Uint8Array(121).fill(1)});
test('route straightening removes raster zigzags but never crosses a wall',()=>{
 const g=grid(),path=[[0,0,0],[10,10,0],[20,10,0],[30,20,0],[40,20,0]];
 assert.equal(straightenRoute(g,path,[profiles.foot]).length,2);
 g.blocked[1*11+2]=1;
 assert.ok(straightenRoute(g,path,[profiles.foot]).length>2);
});
test('reachability preserves infinite air slope and picks distant separated destinations',()=>{
 const g=grid();g.heights[60]=50;
 const times=reachable(g,[{point:[50,50,50],profile:profiles.air}],10);
 assert.ok(Number.isFinite(times[0]));
 const points=farthestPoints(g,times,[50,50,50]);
 assert.equal(points.length,5);assert.ok(points.every(p=>p.distance>30));
});
test('straight paths keep intermediate hill climbing in their travel time',()=>{
 const g=grid(),path=[[0,50,0],[100,50,0]];
 for(let y=0;y<11;y++)for(let x=0;x<11;x++)g.heights[y*11+x]=10-Math.abs(x-5)*2;
 const sampled=sampleRouteHeights(g,path);
 assert.ok(sampled.some(p=>p[2]===10));assert.ok(sampled.every(p=>p[1]===50));
 assert.ok(travelTime(sampled,[profiles.foot])>travelTime(path,[profiles.foot]));
});
test('empty vehicle side inference is local and rejects mixed-side starts',()=>{
 const v={side:'Empty',position:[100,0,100]},east={groupId:1,side:'East',position:[120,0,100]};
 assert.equal(initialVehicleSide(v,[east]),'East');
 assert.equal(initialVehicleSide(v,[east,{groupId:2,side:'West',position:[130,0,100]}]),'Empty');
 assert.equal(initialVehicleSide({...v,position:[1000,0,100]},[east]),'Empty');
 assert.equal(initialVehicleSide({...v,side:'West'},[east]),'West');
});
