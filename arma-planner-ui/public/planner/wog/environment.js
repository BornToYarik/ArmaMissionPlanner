import {environmentProgress} from './loading-progress.js';
import {workBudget,meshNormals,sceneryCommit} from './work-budget.js';
import {terrainObjectHidden} from './mission-context-math.js';
import {sceneryMaterial} from './scene-lighting.js';
import {decodeBrotli,packedAssetUrl} from './brotli-transport.js';
import {EnvironmentBatches} from './environment-batches.js';
import {t} from './i18n.js';
import {environmentCheckpoint} from './load-profile.js';
import {MeshReveal} from './mesh-reveal.js';
import {unpackPlacements} from './asset-codec.js';
import {cachedRequest,mapLimited,createLimiter} from './resource-cache.js';
import {mapObjectRange,natureObjectRange} from './map-object-range.js';
import * as THREE from 'three';
const network=createLimiter(6);
const resource=(url,type,cache='default')=>network(async()=>{url=packedAssetUrl(url);const r=await fetch(url,{cache,signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(t('Environment: ')+r.status+' '+url);if(url.split('?')[0].endsWith('.brdata')){const decoded=await decodeBrotli(await r.arrayBuffer());return type==='json'?JSON.parse(new TextDecoder().decode(decoded)):decoded.slice().buffer;}return r[type]();});
const read=(url,cache)=>resource(url,'json',cache);
const root='environment/';
async function readPack(url){
 const raw=await resource(root+url,'arrayBuffer'),signature=new Uint8Array(raw,0,Math.min(2,raw.byteLength));
 const bytes=signature[0]===31&&signature[1]===139?await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer():raw;
 return {data:JSON.parse(new TextDecoder().decode(bytes)),bytes:bytes.byteLength};
}
export class Environment {
 constructor(scene,catalog,world,half,height){this.reveal=new MeshReveal();this.shared=new EnvironmentBatches(scene);this.retiring=new Map();this.height=height;this.scene=scene;this.catalog=catalog;this.world=catalog.worlds[world];this.half=half;this.geometry=new Map();this.textures=new Map();this.tiles=new Map();this.buildings=[];this.nature=[];this.enabled=true;this.vegetation=true;this.lastKey='';this.generation=0;this.stats={buildings:0,nature:0,loading:false};}
 async model(id){return cachedRequest(this.geometry,id,async()=>{
  const meta=this.catalog.models[id];if(!meta)throw Error(t('Invalid environment model index: ')+id);
  const yieldBefore=workBudget();if(yieldBefore)await yieldBefore;
  const d=meta.pack?(await this.pack(meta.pack))[meta.file]:await read(root+meta.file);
  const materials=new Map(),allocated=[];
  const build=async (d,visibilityOnly=false)=>{const g=new THREE.BufferGeometry();
  try{
   const wait=workBudget();if(wait)await wait;
   g.setAttribute('position',new THREE.Float32BufferAttribute(d.positions,3));g.setIndex(d.indices);if(d.uvs)g.setAttribute('uv',new THREE.Float32BufferAttribute(d.uvs,2));if(!visibilityOnly)g.setAttribute('normal',new THREE.BufferAttribute(await meshNormals(g.attributes.position.array,g.index.array),3));for(const group of d.groups||[])g.addGroup(group.start,group.count,group.materialIndex);
   const created=await mapLimited(d.materials||[{}],3,m=>cachedRequest(materials,JSON.stringify(m),async()=>{
    const map=m.texture?await cachedRequest(this.textures,m.texture,async()=>{
     const pack=this.catalog.texturePacks?.[m.texture],url=pack?(await this.pack(pack))[m.texture]:URL.createObjectURL(await resource(root+m.texture,'blob'));
     try{const texture=await new THREE.TextureLoader().loadAsync(url);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;texture.wrapS=texture.wrapT=m.bake?THREE.ClampToEdgeWrapping:THREE.RepeatWrapping;return texture;}finally{if(!pack)URL.revokeObjectURL(url);}
    }):null;
    // Native ground decals share the terrain plane. Their depth layer must be
    // ahead of the detailed terrain's -1 bias, also when nearing the horizon.
    // Single-pass transparency avoids drawing both sides of a flat decal.
    const layer=meta.groundDecal|| (meta.missionDecal?2:0);
    const softDecal=!!layer&&((m.alphaTest||0)>0||m.transparent);
    const material=sceneryMaterial({map,color:m.color||0xffffff,alphaTest:softDecal?.005:m.alphaTest||0,transparent:softDecal||!!m.transparent,depthWrite:softDecal?false:m.depthWrite!==false,polygonOffset:!!m.polygonOffset||!!layer,polygonOffsetFactor:layer?-4*layer:m.polygonOffsetFactor||0,polygonOffsetUnits:layer?-4*layer:m.polygonOffsetUnits||0,side:m.doubleSided?THREE.DoubleSide:THREE.FrontSide});
    allocated.push(material);if(layer)material.forceSinglePass=true;
    return material;
   }));
   return {geometry:g,materials:d.groups?.length?created:created[0],meta};
  }catch(error){g.dispose();throw error;}
  };let visual;try{visual=await build(d);
   if(meta.visibilityFile){const detailed=await build(await read(root+meta.visibilityFile),true);visual.geometry.userData.visibilityModel=detailed;visual.geometry.addEventListener('dispose',()=>detailed.geometry.dispose());}
   return visual;
  }catch(error){visual?.geometry.dispose();for(const material of allocated)material.dispose();throw error;}
 });}
 async pack(file){
  this.packs??=new Map();this.pendingPacks??=new Map();
  if(this.packs.has(file)){const value=this.packs.get(file);this.packs.delete(file);this.packs.set(file,value);return value.data;}
  return cachedRequest(this.pendingPacks,file,async()=>{const value=await readPack(file);this.packs.set(file,value);this.packBytes=(this.packBytes||0)+value.bytes;while(this.packBytes>32*1024*1024&&this.packs.size>1){const oldest=this.packs.keys().next().value;this.packBytes-=this.packs.get(oldest).bytes;this.packs.delete(oldest);}this.pendingPacks.delete(file);return value.data;});
 }
 async makeBatches(instances,onReady=null){const groups=new Map();for(const a of instances){if(!groups.has(a[0]))groups.set(a[0],[]);groups.get(a[0]).push(a);}const results=await mapLimited([...groups],5,async([id,rows])=>{const model=await this.model(id);await this.prepareModel?.(model);await sceneryCommit();const pause=workBudget();if(pause)await pause;const mesh=new THREE.InstancedMesh(model.geometry,model.materials,rows.length),mat=new THREE.Matrix4();rows.forEach((a,i)=>{mat.set(a[4],a[5],a[6],a[1]-this.half,a[7],a[8],a[9],a[2]+(Number.isFinite(a[13])&&!this.preserveASL?.(a[1],a[3])?this.height(a[1],a[3])-a[13]:0),a[10],a[11],a[12],this.half-a[3],0,0,0,1);mesh.setMatrixAt(i,mat);});mesh.matrixAutoUpdate=false;mesh.userData.rows=rows;mesh.userData.groundBounds=rows.reduce((b,a)=>[Math.min(b[0],a[1]),Math.min(b[1],a[3]),Math.max(b[2],a[1]),Math.max(b[3],a[3])],[Infinity,Infinity,-Infinity,-Infinity]);mesh.computeBoundingSphere();mesh.userData.category=model.meta.category;mesh.renderOrder=model.meta.groundDecal||(model.meta.missionDecal?2:0);this.decorate?.(mesh);onReady?.(mesh);return mesh;});return results;}
 addMissionObjects(rows){this.missionCells=new Map();this.missionEnabled=true;for(const row of rows){const key='mission:'+Math.floor(row[1]/512)+':'+Math.floor(row[3]/512);if(!this.missionCells.has(key))this.missionCells.set(key,[]);this.missionCells.get(key).push(row);}this.lastKey='';}
 setMissionObjects(enabled){this.missionEnabled=enabled;this.lastKey='';}
 async loadBuildings(){
  this.buildingCells=new Map();
  if(this.world.buildingChunks){
   this.buildingTiles=this.world.buildingChunks;
   this.stats.buildings=this.buildingTiles.reduce((n,tile)=>n+tile.instances,0);
  }else{
   const d=await read(root+this.world.buildings);
   for(const row of d.instances.filter(a=>!terrainObjectHidden(a,this.catalog.models[a[0]]?.category,this.hideAreas,this.nativeTerrainTypes,this.terrainReplacementSources))){const key=Math.floor(row[1]/512)+':'+Math.floor(row[3]/512);if(!this.buildingCells.has(key))this.buildingCells.set(key,[]);this.buildingCells.get(key).push(row);}
   this.stats.buildings=d.instances.length;
  }
  this.buildingBatches=new Map();this.natureBatches=new Map();this.failures=0;
 }
 async tilePack(file){
  this.tilePackCache??=new Map();this.tilePackPending??=new Map();
  if(this.tilePackCache.has(file)){const b=this.tilePackCache.get(file);this.tilePackCache.delete(file);this.tilePackCache.set(file,b);return b;}
  return cachedRequest(this.tilePackPending,file,async()=>{const b=await resource(root+file,'arrayBuffer');this.tilePackCache.set(file,b);this.tilePackBytes=(this.tilePackBytes||0)+b.byteLength;while(this.tilePackBytes>8*1024*1024&&this.tilePackCache.size>1){const k=this.tilePackCache.keys().next().value;this.tilePackBytes-=this.tilePackCache.get(k).byteLength;this.tilePackCache.delete(k);}this.tilePackPending.delete(file);return b;});
 }
 async tile(tileInfo){return cachedRequest(this.tiles,tileInfo.file,async()=>{
  const url=root+tileInfo.file+(this.world.assetVersion?'?v='+this.world.assetVersion:''),raw=tileInfo.pack?(await decodeBrotli((await this.tilePack(tileInfo.pack)).slice(tileInfo.offset,tileInfo.offset+tileInfo.length))).slice().buffer:await resource(url,'arrayBuffer'),signature=new Uint8Array(raw,0,Math.min(2,raw.byteLength)),buffer=signature[0]===31&&signature[1]===139?await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer():raw;
  const decoded=unpackPlacements(buffer),v=new DataView(decoded.buffer,decoded.byteOffset,decoded.byteLength),n=v.getUint32(0,true),rows=[];if(decoded.byteLength!==4+n*this.catalog.binaryRecordBytes)throw Error('Invalid environment tile: '+url);
  for(let i=0,o=4;i<n;i++,o+=this.catalog.binaryRecordBytes){if(i%256===0){const wait=workBudget();if(wait)await wait;}const a=[v.getUint16(o,true)];for(let k=0;k<13;k++)a.push(v.getFloat32(o+2+k*4,true));if(!terrainObjectHidden(a,this.catalog.models[a[0]]?.category,this.hideAreas,this.nativeTerrainTypes,this.terrainReplacementSources))rows.push(a);}return rows;
 });}
 retry(){this.failedJobs?.clear();this.lastKey='';this.stats.error=null;}
 async update(target,distance,quality){
  this.failedJobs??=new Map();this.activeJobs??=new Set();
  const size=this.world.tileSize,x=target.x+this.half,y=this.half-target.z,radius=this.observerRange??natureObjectRange(this.world,quality),buildingRadius=this.observerRange??mapObjectRange(this.world);
  const key=[Math.floor(x/128),Math.floor(y/128),radius,this.vegetation,this.enabled].join(':');
  const retryDue=[...this.failedJobs.values()].some(f=>f.attempts<3&&performance.now()>=f.retryAt);
  if(key===this.lastKey&&!retryDue)return this.pending;this.lastKey=key;
  const jobs=[],distanceTo=(cx,cy,cell)=>Math.hypot((cx+.5)*cell-x,(cy+.5)*cell-y);
  // Keep a small loaded rim so reversing a zoom does not unload and rebuild
  // the same tiles. New tiles still enter at the original drawing distance.
  const retain=(store,key)=>store.has(key)?256:0;
  if(this.missionEnabled)for(const [key,rows]of this.missionCells||[]){const [,cx,cy]=key.split(':').map(Number),distance=distanceTo(cx,cy,512);if(distance<buildingRadius+363+retain(this.buildingBatches,key))jobs.push({id:'b:'+key,key,rows,distance,store:this.buildingBatches,nature:false});}
  if(this.enabled)for(const [key,rows]of this.buildingCells){const [cx,cy]=key.split(':').map(Number),distance=distanceTo(cx,cy,512);if(distance<buildingRadius+363+retain(this.buildingBatches,key))jobs.push({id:'b:'+key,key,rows,distance,store:this.buildingBatches,nature:false});}
  if(this.enabled)for(const tile of this.buildingTiles||[]){const distance=distanceTo(tile.x,tile.y,size);if(distance<buildingRadius+size*.71+retain(this.buildingBatches,tile.file))jobs.push({id:'b:'+tile.file,key:tile.file,tile,distance,store:this.buildingBatches,nature:false});}
  if(this.vegetation)for(const tile of this.world.chunks){const distance=distanceTo(tile.x,tile.y,size);if(distance<radius+size*.71+retain(this.natureBatches,tile.file))jobs.push({id:'n:'+tile.file,key:tile.file,tile,distance,store:this.natureBatches,nature:true});}
  // Replace queued work during downloads; both layers share proximity priority.
  this.wanted=new Set(jobs.map(job=>job.id));
  for(const [id,entry]of this.retiring)if(this.wanted.has(id)&&!this.activeJobs.has(id)){
   this.retiring.delete(id);entry.store.set(entry.key,entry.meshes);
   for(const mesh of entry.meshes){mesh.visible=true;this.reveal.add(mesh);}
  }
  for(const [store,prefix]of [[this.buildingBatches,'b:'],[this.natureBatches,'n:']])for(const [key,meshes]of store)if(!this.wanted.has(prefix+key)){
   this.retire(prefix+key,key,meshes,store);store.delete(key);this.tiles.delete(key);
  }
  for(const id of this.failedJobs.keys())if(!this.wanted.has(id))this.failedJobs.delete(id);
  this.jobs=jobs.filter(job=>{const failure=this.failedJobs.get(job.id);return !job.store.has(job.key)&&!this.activeJobs.has(job.id)&&(!failure||failure.attempts<3&&performance.now()>=failure.retryAt);}).sort((a,b)=>a.distance-b.distance);
  this.syncBatches();if(this.stats.loading)return this.pending;
  this.stats.loading=true;environmentCheckpoint('start');
  this.pending=Promise.all(Array.from({length:4},()=>this.loadNext())).finally(()=>{this.stats.loading=false;this.syncBatches();environmentCheckpoint('ready',{tiles:this.buildingBatches.size+this.natureBatches.size,models:this.geometry.size,failures:this.failedJobs.size});});
  return this.pending;
 }
 retire(id,key,meshes,store){
  if(!meshes.length)return;
  const entry={id,key,meshes,store,left:meshes.length,pending:new Set(meshes)};this.retiring.set(id,entry);
  this.retirementQueue??=[];for(const mesh of meshes)this.retirementQueue.push({entry,mesh});
 }
 tick(now){
  // A fast zoom can retire thousands of instances at once. Keep pending
  // sources in their shared batches and start only a few fades per frame.
  const deadline=performance.now()+.4;let started=0;
  while(this.retirementQueue?.length&&started<8&&performance.now()<deadline){
   const {entry,mesh}=this.retirementQueue.shift();if(this.retiring.get(entry.id)!==entry)continue;
   entry.pending.delete(mesh);started++;this.shared.release(mesh);
   this.reveal.hide(mesh,()=>{if(this.retiring.get(entry.id)!==entry)return;this.scene.remove(mesh);mesh.dispose();if(--entry.left===0)this.retiring.delete(entry.id);},now);
  }
  if(this.reveal.tick(now))this.shared.dirty=true;
  if(this.shared.dirty)this.shared.sync([...this.buildings,...this.nature,...[...this.retiring.values()].flatMap(entry=>[...(entry.pending||[])])],this.reveal.active);
 }
 syncBatches(){
  this.stats.progress=environmentProgress(this.wanted,this.buildingBatches,this.natureBatches,this.activeJobs,this.failedJobs);this.onProgress?.(this.stats.progress);
  this.shared.dirty=true;
  this.buildings=[...this.buildingBatches.values()].flat();this.nature=[...this.natureBatches.values()].flat();
  this.stats.nature=this.nature.reduce((n,mesh)=>n+mesh.count,0);this.stats.error=this.failedJobs?.values().next().value?.message||null;
 }
 async loadNext(){
  while(this.jobs.length){
   const job=this.jobs.shift(),partial=[];this.activeJobs.add(job.id);
   try{
    const meshes=await this.makeBatches(job.rows||await this.tile(job.tile),mesh=>{
     if(!this.wanted.has(job.id))return;
     this.alignMeshes([mesh]);partial.push(mesh);job.store.set(job.key,partial);mesh.visible=job.nature?this.vegetation:this.enabled;this.scene.add(mesh);this.reveal.add(mesh);environmentCheckpoint('first-object');
    });
    if(this.wanted.has(job.id)){
     if(this.retiring.has(job.id)){this.retiring.delete(job.id);for(const mesh of meshes)if(mesh.parent===this.scene)this.reveal.add(mesh);}
     this.alignMeshes(meshes);job.store.set(job.key,meshes);for(const mesh of meshes){if(this.shared.owners.has(mesh))continue;mesh.visible=job.nature?this.vegetation:this.enabled;if(mesh.parent!==this.scene){this.scene.add(mesh);this.reveal.add(mesh);}}
     this.failedJobs.delete(job.id);environmentCheckpoint('first-tile');
    }else{for(const mesh of meshes)if(!mesh.parent&&!this.shared.owners.has(mesh)){this.reveal.release(mesh);mesh.dispose();}if(job.tile)this.tiles.delete(job.key);}
   }catch(error){
    if(this.retiring.get(job.id)?.meshes===partial)this.retiring.delete(job.id);
    for(const mesh of partial){this.shared.release(mesh);this.reveal.release(mesh);this.scene.remove(mesh);mesh.dispose();}if(job.store.get(job.key)===partial)job.store.delete(job.key);
    if(this.wanted.has(job.id)){const attempts=(this.failedJobs.get(job.id)?.attempts||0)+1;this.failedJobs.set(job.id,{attempts,retryAt:performance.now()+1000*attempts,message:error.message});console.warn(error);}
   }finally{this.activeJobs.delete(job.id);this.syncBatches();}
  }
 }

 async prepareGround(detail){
  const prepared=new Map(),region=detail.patch.box;
  for(const mesh of [...this.buildings,...this.nature]){
   const rows=mesh.userData.rows,b=mesh.userData.groundBounds;if(!rows||b&&(b[0]>region[2]||b[2]<region[0]||b[1]>region[3]||b[3]<region[1]))continue;
   const from=new Float32Array(rows.length),to=new Float32Array(rows.length);
   for(let i=0;i<rows.length;i++){
    if(i%128===0){const wait=workBudget();if(wait)await wait;}
    const a=rows[i],fixed=!Number.isFinite(a[13])||this.preserveASL?.(a[1],a[3]);from[i]=a[2]+(fixed?0:detail.height(a[1],a[3],0)-a[13]);to[i]=a[2]+(fixed?0:detail.height(a[1],a[3],1)-a[13]);
   }
   prepared.set(mesh,{box:detail.patch.box,from,to});
  }
  return prepared;
 }
 alignMeshes(meshes,regions=null,settled=true,detail=null){
  for(const mesh of meshes){
   const rows=mesh.userData.rows;if(!rows)continue;
   const bounds=mesh.userData.groundBounds;
   if(regions&&bounds&&!regions.some(b=>bounds[0]<=b[2]&&bounds[2]>=b[0]&&bounds[1]<=b[3]&&bounds[3]>=b[1]))continue;
   let changed=false,maxDelta=0;
   let transition=mesh.userData.heightTransition;
   if(detail?.preparedGround?.has(mesh)){transition=detail.preparedGround.get(mesh);mesh.userData.heightTransition=transition;detail.preparedGround.delete(mesh);}
   if(detail?.patch&&transition?.box!==detail.patch.box){
    const from=new Float32Array(rows.length),to=new Float32Array(rows.length);
    for(let i=0;i<rows.length;i++){const a=rows[i],fixed=!Number.isFinite(a[13])||this.preserveASL?.(a[1],a[3]);from[i]=a[2]+(fixed?0:detail.height(a[1],a[3],0)-a[13]);to[i]=a[2]+(fixed?0:detail.height(a[1],a[3],1)-a[13]);}
    transition=mesh.userData.heightTransition={box:detail.patch.box,from,to};
   }
   for(let i=0;i<rows.length;i++){
    const a=rows[i];if(!Number.isFinite(a[13]))continue;
    const y=detail?.patch?transition.from[i]+(transition.to[i]-transition.from[i])*detail.blend.value:a[2]+(this.preserveASL?.(a[1],a[3])?0:this.height(a[1],a[3])-a[13]),offset=i*16+13;
    const delta=Math.abs(mesh.instanceMatrix.array[offset]-y);if(delta<.0001)continue;
    maxDelta=Math.max(maxDelta,delta);mesh.instanceMatrix.array[offset]=y;changed=true;
   }
   if(changed||settled){
    if(settled||!mesh.boundingSphere)mesh.computeBoundingSphere();else mesh.boundingSphere.radius+=maxDelta;
    if(changed)mesh.instanceMatrix.needsUpdate=true;
    this.shared.updateMatrices(mesh,maxDelta,settled,true);
   }
  }
 }
 alignGround(regions=null,settled=true,detail=null){this.alignMeshes(this.buildings,regions,settled,detail);this.alignMeshes(this.nature,regions,settled,detail);}

 setBuildings(v){this.enabled=v;this.lastKey='';this.setLayer(this.buildings,v);}
 setNature(v){this.vegetation=v;this.lastKey='';this.setLayer(this.nature,v);}
 setLayer(meshes,visible){this.shared.dirty=true;for(const mesh of meshes){this.shared.release(mesh);if(visible){mesh.visible=true;this.reveal.add(mesh);}else this.reveal.hide(mesh,()=>{mesh.visible=false;});}}
}
export const loadEnvironmentCatalog=world=>read(root+'worlds/'+encodeURIComponent(world)+'.json','no-cache');
