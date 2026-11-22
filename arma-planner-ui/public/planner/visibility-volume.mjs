import * as T from './wog/vendor/three.module.js';

export const viewHeight=eye=>Number(eye)===2.3?2.3:1.7;
export function observerPoint(point,eye,height){return [point[0],point[1],Math.max(point[2],height(point[0],point[1]))+viewHeight(eye)];}
export function sphericalDirection(azimuth,elevation){const c=Math.cos(elevation);return new T.Vector3(Math.sin(azimuth)*c,Math.sin(elevation),-Math.cos(azimuth)*c);}
export const inViewSphere=(from,to,radius)=>Math.hypot(...from.map((v,i)=>v-to[i]))<=radius;

// Reuse the loaded geometries. A spatial index of individual instances avoids
// testing every tree in every tile for each spherical ray. No asset downloads.
export class VisibilityQuery{
 constructor(meshes,terrain,unknownBoxes=[]){
  this.terrain=terrain;this.unknown=unknownBoxes;this.items=[];this.bins=new Map();this.materials=new Map();this.ray=new T.Raycaster();this.proxy=new T.Mesh();this.proxy.matrixAutoUpdate=false;
  const matrix=new T.Matrix4();
  for(const mesh of meshes){mesh.updateMatrixWorld(true);if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();
   const mats=[mesh.material].flat().map(m=>{if(!this.materials.has(m)){const clone=m.clone();clone.side=T.DoubleSide;this.materials.set(m,clone);}return this.materials.get(m);});
   for(let i=0;i<(mesh.isInstancedMesh?mesh.count:1);i++){
    if(mesh.isInstancedMesh){mesh.getMatrixAt(i,matrix);matrix.premultiply(mesh.matrixWorld);}else matrix.copy(mesh.matrixWorld);
    const box=mesh.geometry.boundingBox.clone().applyMatrix4(matrix),id=this.items.length;
    this.items.push({box,matrix:matrix.clone(),geometry:mesh.geometry,material:Array.isArray(mesh.material)?mats:mats[0]});
    for(let z=Math.floor(box.min.z/128);z<=Math.floor(box.max.z/128);z++)for(let x=Math.floor(box.min.x/128);x<=Math.floor(box.max.x/128);x++){const key=x+':'+z;if(!this.bins.has(key))this.bins.set(key,[]);this.bins.get(key).push(id);}
   }
  }
 }
 cast(origin,direction,range){
  const ray=this.ray;ray.set(origin,direction);ray.near=.02;ray.far=range;
  const terrain=this.terrain(ray.ray);let solid=terrain?.distance<=range?terrain.distance:Infinity;
  const seen=new Set(),hit=new T.Vector3();let x=Math.floor(origin.x/128),z=Math.floor(origin.z/128),at=0;
  const sx=Math.sign(direction.x),sz=Math.sign(direction.z),dx=sx?128/Math.abs(direction.x):Infinity,dz=sz?128/Math.abs(direction.z):Infinity;
  let tx=sx?((x+(sx>0?1:0))*128-origin.x)/direction.x:Infinity,tz=sz?((z+(sz>0?1:0))*128-origin.z)/direction.z:Infinity;
  while(at<=Math.min(solid,range)){
   for(const id of this.bins.get(x+':'+z)||[]){if(seen.has(id))continue;seen.add(id);const item=this.items[id];
    if(!item.box.containsPoint(origin)&&(!ray.ray.intersectBox(item.box,hit)||hit.distanceTo(origin)>Math.min(solid,range)))continue;
    this.proxy.geometry=item.geometry;this.proxy.material=item.material;this.proxy.matrixWorld.copy(item.matrix);ray.far=Math.min(solid,range);
    const intersections=[];this.proxy.raycast(ray,intersections);for(const h of intersections)if(h.distance<solid)solid=h.distance;
   }
   const next=Math.min(tx,tz);if(!Number.isFinite(next))break;at=next;if(tx<=next){x+=sx;tx+=dx;}if(tz<=next){z+=sz;tz+=dz;}
  }
  let unknown=Infinity;for(const box of this.unknown){if(box.containsPoint(origin)){unknown=0;break;}if(ray.ray.intersectBox(box,hit))unknown=Math.min(unknown,hit.distanceTo(origin));}
  return {solid,unknown,distance:Math.min(range,solid,unknown),kind:unknown<Math.min(range,solid)?2:solid<=range?0:1};
 }
 dispose(){for(const material of this.materials.values())material.dispose();this.materials.clear();}
}
