import {observerPoint} from '../arma-planner-ui/public/planner/visibility-volume.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {editWaypoint} from '../arma-planner-ui/public/planner/route-editing.mjs';
import {loadUnits,unloadPositions} from '../arma-planner-ui/public/planner/transport.mjs';
import {route,profiles,groupProfiles,sampleRouteHeights,travelTime} from '../arma-planner-ui/public/planner/core.mjs';
import {vehicleName} from '../arma-planner-ui/public/planner/vehicle-names.mjs';
import {SelectionRings} from '../arma-planner-ui/public/planner/selection-rings.mjs';
import {foliageEnvelope} from '../arma-planner-ui/public/planner/foliage-occluder.mjs';
import {windowClosures} from '../arma-planner-ui/public/planner/building-occluder.mjs';
import {routeHeading} from '../arma-planner-ui/public/planner/route-heading.mjs';
import * as T from '../arma-planner-ui/public/planner/wog/vendor/three.module.js';
const plan=()=>[1,2,3].map(id=>({id,segments:[1,2].map(u=>({id:u,from:[(id-1)*10,u,0],points:[[(id-1)*10,u,0],[id*10,u,0]],seconds:10,mode:'road'}))}));
const rebuild=async(a,b,mode)=>({points:[a,b],seconds:Math.hypot(b[0]-a[0],b[1]-a[1]),mode});
test('middle deletion reconnects only this unit and preserves other branches',async()=>{const p=plan(),before=JSON.stringify(p),r=await editWaypoint(p,2,1,{initial:[0,1,0],rebuild});assert.equal(JSON.stringify(p),before);assert.equal(r.routes[1].segments.length,1);assert.deepEqual(r.routes[2].segments[0].points,[[10,1,0],[30,1,0]]);assert.equal(r.routes[2].segments[0].seconds,20);assert.equal(r.routes[2].segments[1],p[2].segments[1]);});
test('moving middle waypoint rebuilds both adjacent legs, failure is atomic',async()=>{const p=plan(),r=await editWaypoint(p,2,1,{point:[20,5,0],rebuild});assert.deepEqual(r.routes[1].segments[0].points.at(-1),[20,5,0]);assert.deepEqual(r.routes[2].segments[0].points[0],[20,5,0]);assert.deepEqual(r.position,[30,1,0]);const old=JSON.stringify(p);let count=0;await assert.rejects(editWaypoint(p,2,1,{point:[20,5,0],rebuild:async(...a)=>{if(++count===2)throw Error('blocked');return rebuild(...a);}}));assert.equal(JSON.stringify(p),old);});
test('deleting first/last/only point retains initial position and none mode',async()=>{const p=plan();const a=await editWaypoint(p,1,1,{initial:[0,1,0],rebuild});assert.deepEqual(a.routes[1].segments[0].from,[0,1,0]);const b=await editWaypoint(p,3,1,{initial:[0,1,0],rebuild});assert.deepEqual(b.position,[20,1,0]);const c=await editWaypoint([{id:1,segments:[{id:1,points:[[10,0,0]],from:[2,0,0],seconds:null}]}],1,1,{initial:[0,0,0],rebuild});assert.deepEqual(c.routes,[]);assert.deepEqual(c.position,[2,0,0]);});
test('ACE cargo volume and passenger seats are independent and failed load is atomic',()=>{const v={id:10,mobility:'wheeled',capacity:8,cargoSpace:6,point:[50,50,0]},p=Array.from({length:8},(_,i)=>({id:i,mobility:'foot'})),gun={id:20,mobility:'static',gameplay:true,cargoSize:4},gun2={...gun,id:21},all=[v,...p,gun,gun2];loadUnits([...p,gun],v,all);assert.ok(p.every(u=>u.carrier===10));assert.equal(gun.carrier,10);assert.throws(()=>loadUnits([gun2],v,all),/грузового/);assert.equal(gun2.carrier,undefined);assert.throws(()=>loadUnits([{...gun2,cargoSize:undefined}],v,all),/отсутствует/);});
test('unloading spreads units around carrier and avoids blocked and occupied ground',()=>{const v={id:1,point:[20,20,0]},us=Array.from({length:8},(_,i)=>({id:i+2,mobility:'foot'})),r=unloadPositions(v,us,[v],{height:()=>5,clear:p=>p[0]>=20,radius:4});assert.equal(r.length,8);assert.ok(r.every(a=>a.point[0]>=20&&a.point[2]===5));assert.ok(r.every((a,i)=>r.slice(i+1).every(b=>Math.hypot(a.point[0]-b.point[0],a.point[1]-b.point[1])>=1.3)));assert.throws(()=>unloadPositions(v,us,[v],{height:()=>0,clear:()=>false}));});
test('GAZ-like raised origin with eight passengers does not cause a steep route',()=>{const g={x:0,y:0,step:10,nx:11,ny:11,heights:new Float32Array(121).fill(50),blocked:new Uint8Array(121),roads:new Uint8Array(121).fill(1),polygons:[]},v={id:10,mobility:'wheeled',capacity:8,point:[.1,50,52]},p=Array.from({length:8},(_,i)=>({id:i,mobility:'foot'}));loadUnits(p,v,[v,...p]);const r=route(g,v.point,[99.9,50,53],groupProfiles(p,[v,...p]),'road');assert.ok(Number.isFinite(r.seconds));assert.equal(r.points.length,2);assert.ok(sampleRouteHeights(g,r.points).every(p=>p[2]===50));});
test('XY straightening retains continuous hill height and valid uphill travel',()=>{const g={x:0,y:0,step:10,nx:11,ny:11,heights:new Float32Array(121),blocked:new Uint8Array(121),roads:new Uint8Array(121).fill(1)};for(let y=0;y<11;y++)for(let x=0;x<11;x++)g.heights[y*11+x]=50+Math.min(x,10-x)*2;const r=route(g,[0,50,52],[100,50,52],[profiles.wheeled],'road');assert.equal(r.points.length,2);assert.ok(sampleRouteHeights(g,r.points).some(p=>p[2]===60));assert.ok(Number.isFinite(r.seconds));});
test('vehicle uses localized game display name rather than raw class',()=>{assert.equal(vehicleName({vehicleClass:'rhs_gaz',description:'rhs_gaz',displayName:'$STR_GAZ',displayNames:{ru:'ГАЗ-66',en:'GAZ-66'}}),'ГАЗ-66');assert.equal(vehicleName({vehicleClass:'unknown',label:'unknown'}),'Техника');});
test('selection rings drape and represent each selected unit, removed on deselection',()=>{const scene=new T.Scene(),rings=new SelectionRings(scene),camera=new T.PerspectiveCamera(45);camera.position.set(0,20,20);const units=[1,2].map(id=>({id,mobility:'foot',side:id===1?'East':'West',mesh:new T.Mesh(new T.BoxGeometry(1,2,1))}));units[1].mesh.position.x=5;const options={half:0,height:x=>x*.1,camera,viewportHeight:800,revision:1};rings.update(units,[1,2],options);assert.equal(rings.items.size,2);assert.notEqual(rings.items.get(1).material.color.getHex(),rings.items.get(2).material.color.getHex());rings.update(units,[2],options);assert.equal(rings.items.size,1);rings.update(units,[],options);assert.equal(scene.children.length,0);});
test('leaf envelope is solid but does not extend a high crown to the ground',()=>{const g=new T.BoxGeometry(6,4,6);g.translate(0,8,0);const e=foliageEnvelope(g,[{alphaTest:.5}],'tree');e.geometry.computeBoundingBox();assert.equal(e.geometry.boundingBox.min.y,6);assert.equal(e.geometry.boundingBox.max.y,10);const mesh=new T.Mesh(e.geometry,new T.MeshBasicMaterial({side:T.DoubleSide}));mesh.updateMatrixWorld();assert.ok(new T.Raycaster(new T.Vector3(0,8,10),new T.Vector3(0,0,-1)).intersectObject(mesh).length);assert.equal(new T.Raycaster(new T.Vector3(0,1.7,10),new T.Vector3(0,0,-1)).intersectObject(mesh).length,0);});
test('enclosed wall window is closed without covering an open door or courtyard',()=>{const shape=new T.Shape();shape.moveTo(-5,0);shape.lineTo(-5,8);shape.lineTo(5,8);shape.lineTo(5,0);shape.lineTo(1,0);shape.lineTo(1,2);shape.lineTo(-1,2);shape.lineTo(-1,0);shape.closePath();const hole=new T.Path();hole.moveTo(-1,4);hole.lineTo(1,4);hole.lineTo(1,6);hole.lineTo(-1,6);hole.closePath();shape.holes.push(hole);const closure=windowClosures(new T.ShapeGeometry(shape));assert.ok(closure);const mesh=new T.Mesh(closure,new T.MeshBasicMaterial({side:T.DoubleSide}));mesh.updateMatrixWorld();assert.ok(new T.Raycaster(new T.Vector3(0,5,10),new T.Vector3(0,0,-1)).intersectObject(mesh).length);assert.equal(new T.Raycaster(new T.Vector3(0,1,10),new T.Vector3(0,0,-1)).intersectObject(mesh).length,0);});
test('last segment sets unit heading in Arma east/north coordinates',()=>{assert.equal(routeHeading({from:[0,0,0],points:[[0,10,0]]}),0);assert.equal(routeHeading({points:[[0,0,0],[10,0,0],[10,0,0]]}),Math.PI/2);assert.equal(routeHeading({points:[[0,0,0]]},1),1);});

import {placedHeight,terrainPlanes} from '../arma-planner-ui/public/planner/visibility-depth.mjs';
import {ensureRouteSequences,waypointNumber} from '../arma-planner-ui/public/planner/route-sequences.mjs';
test('visibility minimum height uses rotation and scale per placed instance',()=>{const b=new T.Box3(new T.Vector3(-1,0,-1),new T.Vector3(1,1.39,1));assert.ok(placedHeight(b,new T.Matrix4())<1.4);assert.ok(placedHeight(b,new T.Matrix4().makeScale(1,2,1))>1.4);assert.ok(placedHeight(b,new T.Matrix4().makeRotationZ(Math.PI/2))>1.9);});
test('constant terrain planes are observer-relative and preserve terrain morph',()=>{const g=new T.PlaneGeometry(6000,6000,2,2).rotateX(-Math.PI/2);g.setAttribute('terrainPrevious',new T.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(10),1));const mesh=new T.Mesh(g);mesh.position.set(2700,400,-2800);mesh.updateMatrixWorld();const planes=terrainPlanes(mesh,new T.Vector3(2700,406.7,-2800),.5).attributes.sightPlane;for(let i=0;i<planes.count;i++){assert.ok(Math.abs(Math.abs(planes.getY(i))-1)<1e-6);assert.ok(Math.abs(planes.getW(i)-1.7)<1e-5);}});
test('waypoints count within group sequence and restart after splitting and merging',()=>{const r=[[1,2],[3],[1,2],[1],[1],[2],[1,2],[1,2]].map((ids,i)=>({id:i+10,units:ids,segments:ids.map(id=>({id}))}));ensureRouteSequences(r);assert.deepEqual(r.map(row=>waypointNumber(r,row,row.units[0])),[1,1,2,1,2,1,1,2]);const saved=JSON.parse(JSON.stringify(r));saved.splice(2,1);ensureRouteSequences(saved);assert.equal(saved[2].sequenceId,r[3].sequenceId);assert.equal(waypointNumber(saved,saved[2],1),1);});

import {eyeDirection} from '../arma-planner-ui/public/planner/eye-camera.mjs';
import {squadMembers} from '../arma-planner-ui/public/planner/squad-members.mjs';
test('eye camera looks outward from fixed origin including above and below horizon',()=>{assert.ok(eyeDirection(0,0).distanceTo(new T.Vector3(0,0,-1))<1e-8);assert.ok(eyeDirection(Math.PI/2,0).distanceTo(new T.Vector3(1,0,0))<1e-8);assert.ok(eyeDirection(0,Math.PI/3).y>.8);assert.ok(eyeDirection(0,-Math.PI/3).y<-.8);});
test('squad marker selects all actual members including passengers, never another side or scenery',()=>{const us=[{id:1,groupId:2,side:'East',mobility:'foot'},{id:2,groupId:2,side:'East',mobility:'foot',carrier:7},{id:3,groupId:2,side:'West',mobility:'foot'},{id:7,mobility:'wheeled',side:'East'}];assert.deepEqual(squadMembers(us).get('East:2').map(u=>u.id),[1,2]);});

import {rosterRows,rosterVisible,normalizedSide} from '../arma-planner-ui/public/planner/roster-data.mjs';
import {zoomKey} from '../arma-planner-ui/public/planner/native-optic.mjs';
import {zoomFov} from '../arma-planner-ui/public/planner/eye-optics.mjs';
import {airRoute} from '../arma-planner-ui/public/planner/air-route.mjs';
import {ViewshedSurface} from '../arma-planner-ui/public/planner/viewshed-surface.mjs';
test('neutral vehicle belongs in each side list; mission squads use current assignments',()=>{
 const units=[{id:1,groupId:10,groupLabel:'Alpha',side:'West',mobility:'foot'},{id:2,groupId:10,groupLabel:'Alpha',side:'West',mobility:'foot'},{id:3,side:'Empty',mobility:'wheeled',gameplay:true,displayName:'Truck'},{id:4,side:'East',mobility:'wheeled',gameplay:true,displayName:'Tank'}];
 assert.equal(normalizedSide('Independent'),'GUER');assert.equal(rosterVisible(units[3],'WEST'),false);
 for(const side of ['WEST','East','GUER'])assert.equal(rosterVisible(units[2],side),true);
 assert.equal(rosterRows(units,'WEST',{1:'LG',2:'FOX'}).squads[0].name,'[LG / FOX] · Alpha · 2');
 assert.deepEqual(rosterRows(units,'WEST').vehicles.map(v=>v.members),[[3]]);
});
test('observer zoom accepts main keyboard and numpad without intercepting browser shortcuts',()=>{
 for(const code of ['Equal','NumpadAdd'])assert.equal(zoomKey({code}),1);for(const code of ['Minus','NumpadSubtract'])assert.equal(zoomKey({code}),-1);
 assert.equal(zoomKey({code:'Equal',ctrlKey:true}),0);assert.equal(zoomKey({key:'+'}),1);assert.ok(zoomFov(45,2)<45);assert.equal(zoomFov(45,1),45);
});
test('air route goes directly in XY above every sampled ridge',()=>{
 const result=airRoute([0,0,0],[1000,0,0],x=>x>450&&x<550?600:0,[profiles.air]);assert.equal(result.points.length,2);assert.deepEqual(result.points.map(p=>p.slice(0,2)),[[0,0],[1000,0]]);assert.ok(result.points.every(p=>p[2]>=700));assert.ok(result.seconds>0&&Number.isFinite(result.seconds));
});
test('eye view hides only presentation and restores the unchanged ground mask',()=>{
 const views=new ViewshedSurface(50);let disposed=0;const layer={target:{texture:new T.Texture(),dispose(){disposed++;}},maskBounds:new T.Vector4(0,0,100,100)};views.set('one',layer,['#55bcff']);assert.equal(views.uniforms.viewOn0.value,1);views.presentation(false);assert.equal(views.uniforms.viewOn0.value,0);assert.equal(views.layers.size,1);views.presentation(true);assert.equal(views.uniforms.viewOn0.value,1);assert.equal(disposed,0);
});

import {appendManualPoint,undoManualPoint} from '../arma-planner-ui/public/planner/manual-route.mjs';
test('manual route finishes only on a click within five horizontal metres and right click undoes one point',()=>{const goal=[100,100,50];let r=appendManualPoint([], [90,100,0],goal);assert.equal(r.complete,false);r=appendManualPoint(r.points,[96,100,99],goal);assert.equal(r.complete,true);assert.deepEqual(r.points.at(-1),goal);assert.deepEqual(undoManualPoint(r.points),[[90,100,0]]);assert.deepEqual(undoManualPoint([]),[]);assert.equal(appendManualPoint([], [105.01,100,50],goal).complete,false);});

import {pickObservationSurface,standingSurface} from '../arma-planner-ui/public/planner/observation-surface.mjs';
test('infantry observation can stand on an instanced rooftop, never a wall or hidden roof',()=>{
 const building=new T.InstancedMesh(new T.BoxGeometry(8,6,8),new T.MeshBasicMaterial(),1);building.userData.category='building';building.setMatrixAt(0,new T.Matrix4().makeTranslation(10,3,0));building.updateMatrixWorld();
 const ray=new T.Raycaster(new T.Vector3(10,20,0),new T.Vector3(0,-1,0));
 const terrain={distance:20,point:new T.Vector3(10,0,0)},roof=pickObservationSurface(ray,terrain,[building]);assert.equal(roof.point.y,6);assert.equal(roof.instanceId,0);assert.equal(standingSurface(roof),true);
 assert.equal(pickObservationSurface(ray,{distance:10,point:new T.Vector3(10,10,0)},[building]).point.y,10);
 ray.set(new T.Vector3(25,3,0),new T.Vector3(-1,0,0));assert.equal(pickObservationSurface(ray,null,[building]),null);
 assert.deepEqual(observerPoint([10,0,6],1.7,()=>0),[10,0,7.7]);
});

import {convexVolume} from '../arma-planner-ui/public/planner/convex-volume.mjs';
test('canopy follows its 3D outline instead of filling the full footprint down to its base',()=>{
 const g=convexVolume([[0,0,0],[-3,3,-3],[3,3,-3],[3,3,3],[-3,3,3],[0,6,0]]),mesh=new T.Mesh(g,new T.MeshBasicMaterial({side:T.DoubleSide}));mesh.updateMatrixWorld();
 assert.equal(new T.Raycaster(new T.Vector3(2.5,.5,10),new T.Vector3(0,0,-1)).intersectObject(mesh).length,0);
 assert.ok(new T.Raycaster(new T.Vector3(2.5,3,10),new T.Vector3(0,0,-1)).intersectObject(mesh).length);
});

import {visibilitySource} from '../arma-planner-ui/public/planner/visibility-depth.mjs';
test('sight uses highest-detail geometry independently of display LOD and placed scale',()=>{
 const display=new T.BoxGeometry(1,.5,1),highest=new T.BoxGeometry(2,4,2),material=new T.MeshBasicMaterial();display.userData.visibilityModel={geometry:highest,materials:material};
 const original=new T.InstancedMesh(display,material,2);original.userData.category='tree';original.setMatrixAt(0,new T.Matrix4().makeScale(1,.25,1));original.setMatrixAt(1,new T.Matrix4());original.updateMatrixWorld();
 const sight=visibilitySource(original);assert.equal(sight.geometry,highest);assert.equal(original.geometry,display);assert.equal(sight.count,2);assert.equal(sight.instanceMatrix,original.instanceMatrix);assert.equal(visibilitySource(original),sight);
 highest.computeBoundingBox();const matrix=new T.Matrix4();sight.getMatrixAt(0,matrix);assert.ok(placedHeight(highest.boundingBox,matrix)<1.4);sight.getMatrixAt(1,matrix);assert.equal(placedHeight(highest.boundingBox,matrix),4);
});

test('manual goal duplicated by closing the route is not a vertical impassable segment',()=>{
 const a=[0,0,20],b=[12,2,20.3],c=[20,4,20.5],p=[profiles.foot];
 assert.equal(travelTime([a,a,b,b,c,c],p),travelTime([a,b,c],p));
 assert.equal(travelTime([a,a],p),0);assert.equal(travelTime([a,[0,0,22]],p),Infinity);
});

import {sampleManualPath} from '../arma-planner-ui/public/planner/manual-route.mjs';
test('manual path tests exact obstacle segments rather than an occupied neighbouring grid node',()=>{
 const options={step:10,height:()=>3,clear:(a,b)=>Math.min(a[1],b[1])>1};
 const path=sampleManualPath([[0,2,3],[20,2,3],[20,2,3]],options);assert.equal(path.length,5);assert.ok(Number.isFinite(travelTime(path,[profiles.foot])));
 assert.throws(()=>sampleManualPath([[0,0,3],[20,0,3]],options),/препятствие/);
});
