import test from 'node:test';
import assert from 'node:assert/strict';
import {footprint,addObstacle,segmentClear,navigationNode} from '../arma-planner-ui/public/planner/navigation-obstacles.mjs';
import {route,reachable,profiles} from '../arma-planner-ui/public/planner/core.mjs';
import {VisibilityQuery,observerPoint,inViewSphere,sphericalDirection} from '../arma-planner-ui/public/planner/visibility-volume.mjs';
import * as T from '../arma-planner-ui/public/planner/wog/vendor/three.module.js';
const grid=()=>({x:0,y:0,step:10,nx:11,ny:11,heights:new Float32Array(121).fill(10),blocked:new Uint8Array(121),roads:new Uint8Array(121)});
const rect=(x,y,w,h)=>footprint([[x,y],[x+w,y],[x+w,y+h],[x,y+h]]);
test('thin wall between nodes blocks reach and routes, but never aircraft',()=>{
 const g=grid();addObstacle(g,rect(44,-5,1,110));assert.equal(g.blocked.some(Boolean),false);
 assert.equal(segmentClear(g,[40,50],[50,50]),false);
 assert.throws(()=>route(g,[10,50,10],[90,50,10],[profiles.foot]),/не найден/);
 assert.equal(reachable(g,[{point:[10,50,10],profile:profiles.foot}],1000)[5*11+9],Infinity);
 assert.ok(Number.isFinite(reachable(g,[{point:[10,50,10],profile:profiles.air}],1000)[5*11+9]));
});
test('detour around a building is shared by reach and route smoothing',()=>{
 const g=grid();addObstacle(g,rect(44,20,2,60));
 const r=route(g,[10,50,10],[90,50,10],[profiles.foot]);assert.ok(r.points.some(p=>p[1]<=10||p[1]>=90));
 assert.ok(r.points.slice(1).every((p,i)=>segmentClear(g,r.points[i],p)));
 const free=reachable(grid(),[{point:[10,50,10],profile:profiles.foot}],1000),blocked=reachable(g,[{point:[10,50,10],profile:profiles.foot}],1000);
 assert.ok(blocked[64]>free[64]);assert.ok(Number.isFinite(blocked[64]));
});
test('exact start cannot jump out of an enclosed area through a wall',()=>{
 const g=grid();for(const p of [rect(42,42,1,6),rect(47,42,1,6),rect(42,42,6,1),rect(42,47,6,1)])addObstacle(g,p);
 assert.equal(navigationNode(g,[45,45,10]),-1);
 assert.throws(()=>reachable(g,[{point:[45,45,10],profile:profiles.foot}],100),/препятствия/);
});
test('rotated footprints preserve free space outside the projected model',()=>{
 const g=grid();addObstacle(g,footprint([[50,25],[75,50],[50,75],[25,50]]));
 assert.equal(segmentClear(g,[20,30],[35,30]),true);assert.equal(segmentClear(g,[20,50],[80,50]),false);
});
test('vehicle model origin above the road does not create a fictitious steep slope',()=>{
 const g=grid();g.polygons=[];
 const times=reachable(g,[{point:[.1,.1,13],profile:profiles.wheeled}],60);
 assert.ok(Number.isFinite(times[120]));
});
test('observer height is relative to ground or selected roof, range is 3D',()=>{
 assert.deepEqual(observerPoint([5,5,0],1.7,()=>100),[5,5,101.7]);
 assert.deepEqual(observerPoint([5,5,110],2.3,()=>100),[5,5,112.3]);
 assert.equal(inViewSphere([0,0,0],[80,0,80],100),false);assert.equal(inViewSphere([0,0,0],[60,0,80],100),true);
});
test('three dimensional sight tests allow looking over a wall, under a roof and up/down',()=>{
 const mat=new T.MeshBasicMaterial(),wall=new T.Mesh(new T.BoxGeometry(10,2,.3),mat);wall.position.set(0,1,-10);wall.updateMatrixWorld(true);
 const query=new VisibilityQuery([wall],()=>null);
 assert.ok(query.cast(new T.Vector3(0,1.7,0),sphericalDirection(0,0),30).solid<11);
 assert.equal(query.cast(new T.Vector3(0,2.3,0),sphericalDirection(0,0),30).solid,Infinity);
 assert.equal(query.cast(new T.Vector3(0,1.7,0),sphericalDirection(0,.3),30).solid,Infinity);
 assert.ok(sphericalDirection(0,-.5).y<0);assert.ok(sphericalDirection(0,.5).y>0);query.dispose();
 const roof=new T.Mesh(new T.BoxGeometry(20,.2,20),mat);roof.position.set(0,5,0);roof.updateMatrixWorld(true);
 const q=new VisibilityQuery([roof],()=>null);assert.ok(q.cast(new T.Vector3(0,1.7,0),sphericalDirection(0,Math.PI/2),30).solid<4);
 assert.equal(q.cast(new T.Vector3(0,1.7,0),sphericalDirection(0,0),30).solid,Infinity);q.dispose();
});
test('instance transforms, nearest hit and missing coverage are preserved',()=>{
 const mesh=new T.InstancedMesh(new T.BoxGeometry(2,6,2),new T.MeshBasicMaterial(),2);
 mesh.setMatrixAt(0,new T.Matrix4().makeTranslation(0,3,-20));mesh.setMatrixAt(1,new T.Matrix4().makeTranslation(0,3,-10));
 const q=new VisibilityQuery([mesh],()=>({distance:25}),[new T.Box3(new T.Vector3(-5,-100,-7),new T.Vector3(5,100,-5))]);
 const hit=q.cast(new T.Vector3(0,1.7,0),sphericalDirection(0,0),30);assert.equal(hit.solid,9);assert.equal(hit.unknown,5);assert.equal(hit.kind,2);q.dispose();
});
