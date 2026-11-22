import {workBudget,meshNormals} from './work-budget.js';
import {decodeBrotli} from './brotli-transport.js';
import * as THREE from 'three';
import {cachedRequest,mapLimited} from './resource-cache.js';
import {unpackHeights} from './asset-codec.js';
import {patchWeight} from './terrain-join.js';
export function blendHeight(native,coarse,x,y,bounds,fade,rim=0){
 return coarse+(native-coarse)*patchWeight(x,y,bounds,fade,rim);
}
export class TerrainDetail{
 constructor(scene,world,half,coarse,material,onChange,coarseNormal=null){
  Object.assign(this,{scene,world,half,coarse,material,onChange,coarseNormal});this.cache=new Map();this.bounds=new THREE.Vector4(1,1,-1,-1);this.patch=null;this.mesh=null;this.generation=0;this.lastKey='';this.failures=0;
  this.blend={value:1};const compile=material.onBeforeCompile;
  material.onBeforeCompile=shader=>{compile?.(shader);shader.uniforms.terrainBlend=this.blend;shader.vertexShader='attribute float terrainPrevious;\nattribute vec3 terrainPreviousNormal;\nuniform float terrainBlend;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed.y=mix(terrainPrevious,position.y,terrainBlend);').replace('#include <beginnormal_vertex>','vec3 objectNormal=mix(terrainPreviousNormal,normal,terrainBlend);');};
  material.polygonOffset=true;material.polygonOffsetFactor=-1;material.polygonOffsetUnits=-1;
  material.customProgramCacheKey=()=> 'terrain-sealed-transition-v2';
 }
 async metadata(){
  if(this.meta)return this.meta;
  this.metadataPending??=fetch(`terrain/${this.world}/index.json`,{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error('Terrain '+r.status);return r.json();}).then(meta=>this.meta=meta).finally(()=>{this.metadataPending=null;});
  return this.metadataPending;
 }
 region(x,y,mobile,meta=this.meta){
  const span=mobile?128:256,step=meta.cellSize,cx=Math.round(x/step/32)*32,cy=Math.round(y/step/32)*32;
  const sx=Math.max(0,Math.min(meta.resolution-span,cx-span/2)),sy=Math.max(0,Math.min(meta.resolution-span,cy-span/2));
  return {span,step,sx,sy,key:[sx,sy,span].join(':')};
 }
 async tile(x,y){const key=x+':'+y;return cachedRequest(this.cache,key,async()=>{
  const r=await fetch(`terrain/${this.world}/${x}-${y}.bin.gz`+(this.meta.assetVersion?'?v='+this.meta.assetVersion:''));if(!r.ok)throw Error('Terrain '+r.status);
  let bytes=await r.arrayBuffer();const sig=new Uint8Array(bytes);if(sig[0]===31&&sig[1]===139)bytes=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const decoded=unpackHeights(bytes);if(decoded.byteLength!==this.meta.tileResolution**2*4)throw Error('Invalid terrain tile');return new Float32Array(decoded.buffer,decoded.byteOffset,decoded.byteLength/4);
 });}
 loadingProgress(done,total,errors=0){this.loadProgress={done,total,errors,percent:total?Math.floor(done*100/total):100};this.onLoadProgress?.(this.loadProgress);}
 clear(){this.loadingProgress(0,0);this.generation++;this.lastKey='';this.pendingKey='';this.pendingRequest='';if(!this.mesh)return;const oldBox=this.patch.box;this.scene.remove(this.mesh);this.mesh.geometry.dispose();this.mesh=null;this.patch=null;this.bounds.set(1,1,-1,-1);this.onChange([oldBox],true);}
 retry(){this.failures=0;this.retryAt=0;this.lastKey='';}
 contains(x,y){const b=this.patch?.box;return !!b&&x>b[0]&&x<b[2]&&y>b[1]&&y<b[3];}
 height(x,y,blend=this.blend.value){
  const patch=this.patch;if(!patch||!this.contains(x,y))return this.coarse(x,y);
  const n=patch.n,gx=(x-patch.box[0])/patch.step,gy=(y-patch.box[1])/patch.step,ix=Math.min(n-2,Math.floor(gx)),iy=Math.min(n-2,Math.floor(gy)),u=gx-ix,v=gy-iy;
  const k=iy*n+ix,h=patch.heights,p=patch.previous,f=blend;
  let a=h[k],b=h[k+1],c=h[k+n],d=h[k+n+1];if(p){a=p[k]+(a-p[k])*f;b=p[k+1]+(b-p[k+1])*f;c=p[k+n]+(c-p[k+n])*f;d=p[k+n+1]+(d-p[k+n+1])*f;}
  return u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v);
 }
 tick(now){
  if(!this.patch?.previous||this.blend.value===1)return;
  const f=Math.max(0,Math.min(1,(now-this.transitionStart)/650));this.blend.value=f*f*(3-2*f);this.onChange([this.patch.box],f===1);
  if(f===1)this.patch.previous=null;
 }
 async update(position,mobile,enabled=true){
  const x=position.x+this.half,y=this.half-position.z;
  if(!enabled||position.y-this.coarse(x,y)>1800){this.clear();return;}
  if(this.failures>=3||performance.now()<(this.retryAt||0))return;
  // Moving inside the same terrain patch must not cancel its pending build.
  if(this.meta&&this.region(x,y,mobile).key===this.pendingKey)return;
  const requestKey=[Math.round(x),Math.round(y),mobile].join(':');if(requestKey===this.pendingRequest)return;
  const token=++this.generation;this.pendingRequest=requestKey;if(!this.meta)this.loadingProgress(0,1);
  try{
   const meta=await this.metadata();if(token!==this.generation)return;
   const {span,step,sx,sy,key}=this.region(x,y,mobile,meta);
   if(key===this.lastKey){this.loadingProgress(0,0);return;}this.pendingKey=key;
   const cells=meta.cells,needed=[];
   for(let ty=Math.floor(sy/cells);ty<=Math.min(meta.count-1,Math.floor((sy+span)/cells));ty++)for(let tx=Math.floor(sx/cells);tx<=Math.min(meta.count-1,Math.floor((sx+span)/cells));tx++)needed.push([tx,ty]);
   let completed=0;this.loadingProgress(0,needed.length+1);
   const arrays=await mapLimited(needed,4,async([tx,ty])=>{const data=await this.tile(tx,ty);if(token===this.generation)this.loadingProgress(++completed,needed.length+1);return data;});if(token!==this.generation)return;
   const tiles=new Map(needed.map(([tx,ty],i)=>[tx+':'+ty,arrays[i]]));
   const n=span+1,heights=new Float32Array(n*n),vertices=new Float32Array(n*n*3),uv=new Float32Array(n*n*2),indices=new Uint32Array(span*span*6),box=[sx*step,sy*step,(sx+span)*step,(sy+span)*step];
   for(let row=0;row<n;row++){if(row%8===0){const wait=workBudget();if(wait)await wait;if(token!==this.generation)return;}for(let col=0;col<n;col++){
    const gx=sx+col,gy=sy+row,tx=Math.min(meta.count-1,Math.floor(gx/cells)),ty=Math.min(meta.count-1,Math.floor(gy/cells));
    const native=tiles.get(tx+':'+ty)[(gy-ty*cells)*meta.tileResolution+gx-tx*cells],wx=gx*step,wy=gy*step,k=row*n+col;
    const h=blendHeight(this.deformHeight?this.deformHeight(wx,wy,native):native,this.coarse(wx,wy),wx,wy,box,step*16,step*2);heights[k]=h;vertices.set([wx-this.half,h,this.half-wy],k*3);uv.set([wx/meta.worldSize,wy/meta.worldSize],k*2);
   }
   }
   for(let row=0,k=0;row<span;row++)for(let col=0;col<span;col++){const a=row*n+col;indices.set([a,a+1,a+n,a+1,a+n+1,a+n],k);k+=6;}
   const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(vertices,3));geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));geometry.setIndex(new THREE.BufferAttribute(indices,1));geometry.setAttribute('normal',new THREE.BufferAttribute(await meshNormals(vertices,indices),3));
   const oldBox=this.patch?.box,previous=new Float32Array(n*n);
   for(let row=0;row<n;row++){if(row%8===0){const wait=workBudget();if(wait)await wait;if(token!==this.generation){geometry.dispose();return;}}for(let col=0;col<n;col++){const wx=(sx+col)*step,wy=(sy+row)*step;previous[row*n+col]=blendHeight(this.height(wx,wy),this.coarse(wx,wy),wx,wy,box,step*16,step*2);}
   }
   geometry.setAttribute('terrainPrevious',new THREE.BufferAttribute(previous,1));
   const previousVertices=vertices.slice();for(let k=0;k<previous.length;k++)previousVertices[k*3+1]=previous[k];
   const normals=geometry.getAttribute('normal').array,previousNormals=await meshNormals(previousVertices,indices);
   if(this.coarseNormal)for(let row=0;row<n;row++)for(let col=0;col<n;col++){
    const wx=(sx+col)*step,wy=(sy+row)*step,k=row*n+col,w=patchWeight(wx,wy,box,step*16,step*2);if(w===1)continue;const coarse=this.coarseNormal(wx,wy);
    for(let axis=0;axis<3;axis++){normals[k*3+axis]=coarse[axis]+(normals[k*3+axis]-coarse[axis])*w;previousNormals[k*3+axis]=coarse[axis]+(previousNormals[k*3+axis]-coarse[axis])*w;}
   }
   geometry.setAttribute('terrainPreviousNormal',new THREE.BufferAttribute(previousNormals,3));if(token!==this.generation){geometry.dispose();return;}
   const candidate=Object.create(this);candidate.patch={box,n,step,heights,previous};candidate.blend={value:0};
   const prepared=this.prepareChange?await this.prepareChange(candidate):null;if(token!==this.generation){geometry.dispose();return;}
   if(this.mesh){this.scene.remove(this.mesh);this.mesh.geometry.dispose();}this.mesh=new THREE.Mesh(geometry,this.material);this.scene.add(this.mesh);this.patch=candidate.patch;this.preparedGround=prepared;this.blend.value=0;this.transitionStart=performance.now();
   const overlap=step;this.bounds.set(box[0]-this.half+overlap,this.half-box[3]+overlap,box[2]-this.half-overlap,this.half-box[1]-overlap);this.onChange(oldBox?[oldBox,box]:[box],false);this.failures=0;this.lastKey=key;this.loadingProgress(needed.length+1,needed.length+1);
   const keep=new Set(needed.map(([tx,ty])=>tx+':'+ty));for(const key of this.cache.keys())if(!keep.has(key))this.cache.delete(key);
  }catch(error){if(token===this.generation){this.lastKey='';this.failures++;this.retryAt=performance.now()+this.failures*1500;this.loadingProgress(this.loadProgress?.done||0,this.loadProgress?.total||1,1);console.warn(error);}}
  finally{if(token===this.generation){this.pendingKey='';this.pendingRequest='';}}
 }
}
