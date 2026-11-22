import {InstanceVisibility} from './instance-visibility.js';
import * as THREE from './vendor/three.module.js';
// Stable GPU buffers survive tile arrivals, departures and ground morphing.
export class EnvironmentBatches {
 constructor(scene){this.scene=scene;this.groups=new Map();this.owners=new Map();this.sourceBounds=new WeakMap();this.sourceKeys=new WeakMap();this.dirty=true;this.visibility=new InstanceVisibility();}
 release(source){
  const key=this.owners.get(source),entry=this.groups.get(key);if(!entry)return;
  // The remaining sources keep their existing offsets. Visibility compacts
  // the holes, so a departure does not rebuild every unrelated batch.
  this.owners.delete(source);entry.sources=entry.sources.filter(m=>m!==source);entry.refresh=true;entry.cullDirty=true;source.visible=true;this.scene.add(source);
  if(!entry.sources.length){this.scene.remove(entry.mesh);entry.mesh.dispose();this.groups.delete(key);}
 }
 updateMatrices(source,maxDelta=0,settled=false,verticalOnly=false){
  const entry=this.groups.get(this.owners.get(source));if(!entry)return false;
  const offset=entry.offsets.get(source),count=source.count*16;
  if(offset!==undefined){
   if(verticalOnly)for(let i=0;i<source.count;i++)entry.instanceBounds[(offset/16+i)*4+1]+=source.instanceMatrix.array[i*16+13]-entry.fullMatrices[offset+i*16+13];
   entry.fullMatrices.set(source.instanceMatrix.array.subarray(0,count),offset);
   if(!verticalOnly)this.instanceBounds(entry,offset/16,source.count);
  }this.sourceBounds.delete(source);entry.cullDirty=true;
  if(settled)this.bounds(entry);else if(entry.mesh.boundingSphere)entry.mesh.boundingSphere.radius+=maxDelta;
  return true;
 }
 instanceBounds(entry,start=0,count=entry.total){
  if(!entry.mesh.geometry.boundingSphere)entry.mesh.geometry.computeBoundingSphere();
  const {center,radius}=entry.mesh.geometry.boundingSphere,m=entry.fullMatrices,b=entry.instanceBounds;
  for(let i=start;i<start+count;i++){const k=i*16,j=i*4;b[j]=m[k]*center.x+m[k+4]*center.y+m[k+8]*center.z+m[k+12];b[j+1]=m[k+1]*center.x+m[k+5]*center.y+m[k+9]*center.z+m[k+13];b[j+2]=m[k+2]*center.x+m[k+6]*center.y+m[k+10]*center.z+m[k+14];b[j+3]=radius*Math.sqrt(Math.max(m[k]**2+m[k+1]**2+m[k+2]**2,m[k+4]**2+m[k+5]**2+m[k+6]**2,m[k+8]**2+m[k+9]**2+m[k+10]**2));}
 }
 cachedBounds(source){
  let cached=this.sourceBounds.get(source);
  if(!cached||cached.version!==source.instanceMatrix.version||cached.count!==source.count){
   const bounds=new Float64Array(source.count*4);
   this.instanceBounds({mesh:source,fullMatrices:source.instanceMatrix.array,instanceBounds:bounds,total:source.count});
   cached={version:source.instanceMatrix.version,count:source.count,bounds};this.sourceBounds.set(source,cached);
  }
  return cached.bounds;
 }
 bounds(entry){const bound=new THREE.Sphere().makeEmpty();for(const source of entry.sources){if(!source.boundingSphere)source.computeBoundingSphere();bound.union(source.boundingSphere);}entry.mesh.boundingSphere=bound;}
 sync(sources,transitions){
  if(!this.dirty)return;
  const eligible=new Map(),present=new Set(sources);
  for(const [source]of this.owners)if(!present.has(source)||transitions.has(source)||source.instanceColor)this.release(source);
  for(const mesh of sources){
   if(!mesh.isInstancedMesh||mesh.instanceColor||(!mesh.parent&&!this.owners.has(mesh))||transitions.has(mesh)||(!mesh.visible&&!this.owners.has(mesh))||!mesh.userData.groundBounds)continue;
   let cached=this.sourceKeys.get(mesh);if(!cached||cached.material!==mesh.material||cached.geometry!==mesh.geometry||cached.order!==mesh.renderOrder){const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];cached={material:mesh.material,geometry:mesh.geometry,order:mesh.renderOrder,key:[mesh.geometry.id,mesh.renderOrder,...materials.map(m=>m.id)].join(':')};this.sourceKeys.set(mesh,cached);}const key=cached.key;
   if(this.owners.get(mesh)===key)continue;
   if(this.owners.has(mesh))this.release(mesh);
   if(!eligible.has(key))eligible.set(key,[]);eligible.get(key).push(mesh);
  }
  for(const [key,incoming]of eligible){
   const items=[...(this.groups.get(key)?.sources||[]),...incoming];
   let entry=this.groups.get(key);if(items.length<2&&!entry)continue;
   const count=items.reduce((n,m)=>n+m.count,0);
   if(!entry||entry.capacity<count){
    const capacity=2**Math.ceil(Math.log2(Math.max(16,count))),mesh=new THREE.InstancedMesh(items[0].geometry,items[0].material,capacity);
    if(entry){this.scene.remove(entry.mesh);entry.mesh.dispose();}
    entry={mesh,capacity,fullMatrices:new Float32Array(capacity*16),instanceBounds:new Float64Array(capacity*4),visibleIndices:new Int32Array(capacity).fill(-1),offsets:new Map()};mesh.matrixAutoUpdate=false;mesh.renderOrder=items[0].renderOrder;mesh.name='Shared environment batch';this.scene.add(mesh);this.groups.set(key,entry);
   }
   entry.sources=items;entry.total=count;entry.refresh=false;entry.cullDirty=true;entry.offsets.clear();
   let offset=0;for(const source of items){entry.offsets.set(source,offset);entry.fullMatrices.set(source.instanceMatrix.array.subarray(0,source.count*16),offset);entry.instanceBounds.set(this.cachedBounds(source),offset/4);offset+=source.count*16;source.visible=false;this.owners.set(source,key);if(source.parent===this.scene)this.scene.remove(source);}
   this.bounds(entry);
  }
  this.dirty=false;
 }
}
