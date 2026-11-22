import * as THREE from './vendor/three.module.js';

// Native roads are blended into the terrain shader, so LOD morphing and mission
// height edits move both surfaces together. No coplanar mesh / z-fighting.
export function nearestRoadTiles(tiles,x,y,tileSize,limit){
 const distance=t=>{const dx=Math.max(t[0]*tileSize-x,0,x-(t[0]+1)*tileSize),dy=Math.max(t[1]*tileSize-y,0,y-(t[1]+1)*tileSize);return dx*dx+dy*dy;};
 return tiles.map(t=>({tile:t,distance:distance(t)})).filter(t=>t.distance<1600**2).sort((a,b)=>a.distance-b.distance||a.tile[1]-b.tile[1]||a.tile[0]-b.tile[0]).slice(0,limit).map(t=>t.tile);
}

export class TerrainRoads{
 constructor(world,size,mobile=false){
  this.world=world;this.size=size;this.limit=mobile?12:16;this.mobile=mobile;this.slots=[];this.pending=new Map();this.wanted=new Set();this.failed=new Map();this.queue=[];
  const blank=new THREE.DataTexture(new Uint8Array(4),1,1);blank.needsUpdate=true;
  const array=new THREE.DataArrayTexture(new Uint8Array(4),1,1,1);array.needsUpdate=true;
  this.uniforms={roadOverview:{value:blank},roadTiles:{value:array},roadLookup:{value:blank},roadReady:{value:0},roadWorldSize:{value:size},roadTileSize:{value:512},roadGrid:{value:new THREE.Vector2(1,1)},roadPixels:{value:new THREE.Vector2(1,0)},roadTime:{value:0}};
 }
 async load(){
  if(this.loading)return;this.loading=true;
  try{await this.loadIndex();this.retryAt=0;this.onReady?.();}catch(error){this.retryAt=performance.now()+10000;throw error;}finally{this.loading=false;}
 }
 async loadIndex(){
  const response=await fetch(`maps/roads/${this.world}/index.json`,{cache:'no-cache',signal:AbortSignal.timeout(20000)});
  if(response.status===404)return;if(!response.ok)throw Error('Road index '+response.status);
  const meta=await response.json();if(meta.format!==1||meta.worldSize!==this.size)throw Error('Road world mismatch');this.meta=meta;
  if(!meta.tiles.length)return;
  const base=`maps/roads/${this.world}/`,overview=await new THREE.TextureLoader().loadAsync(base+meta.overview+'?v='+meta.version);if(this.mobile&&overview.image.width>2048){const canvas=new OffscreenCanvas(2048,2048);canvas.getContext('2d').drawImage(overview.image,0,0,2048,2048);overview.image=canvas;}overview.flipY=false;overview.colorSpace=THREE.SRGBColorSpace;overview.needsUpdate=true;
  const pixels=this.mobile?meta.pixels/2:meta.pixels,pad=this.mobile?meta.padding/2:meta.padding,n=pixels+pad*2,grid=Math.ceil(this.size/meta.tileSize);
  this.pixels=pixels;this.pad=pad;this.n=n;this.grid=grid;
  const array=new THREE.DataArrayTexture(new Uint8Array(n*n*4*this.limit),n,n,this.limit);array.colorSpace=THREE.SRGBColorSpace;array.magFilter=array.minFilter=THREE.LinearFilter;array.generateMipmaps=false;array.needsUpdate=true;
  const lookup=new THREE.DataTexture(new Float32Array(grid*grid*4),grid,grid,THREE.RGBAFormat,THREE.FloatType);lookup.needsUpdate=true;
  this.uniforms.roadOverview.value.dispose();this.uniforms.roadTiles.value.dispose();
  this.uniforms.roadOverview.value=overview;this.uniforms.roadTiles.value=array;this.uniforms.roadLookup.value=lookup;this.uniforms.roadGrid.value.set(grid,grid);this.uniforms.roadPixels.value.set(pixels,pad);this.uniforms.roadTileSize.value=meta.tileSize;this.uniforms.roadReady.value=1;
 }
 attach(shader){
  Object.assign(shader.uniforms,this.uniforms);
  shader.fragmentShader=`uniform sampler2D roadOverview;
uniform highp sampler2DArray roadTiles;
uniform sampler2D roadLookup;
uniform float roadReady,roadWorldSize,roadTileSize,roadTime;
uniform vec2 roadGrid,roadPixels;
`+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
#ifdef USE_MAP
 if(roadReady>0.5){
  vec2 roadXY=vec2(terrainWorld.x+roadWorldSize*.5,roadWorldSize*.5-terrainWorld.y);
  vec4 road=texture2D(roadOverview,roadXY/roadWorldSize);
  vec2 cell=floor(roadXY/roadTileSize);
  vec4 entry=texture2D(roadLookup,(cell+.5)/roadGrid);
  if(entry.r>.5&&all(greaterThanEqual(cell,vec2(0.)))&&all(lessThan(cell,roadGrid))){
   vec2 uv=(fract(roadXY/roadTileSize)*roadPixels.x+roadPixels.y)/(roadPixels.x+2.*roadPixels.y);
   vec4 detail=texture(roadTiles,vec3(uv,entry.r-1.));
   float blend=smoothstep(0.,.45,roadTime-entry.g);
   float range=length(roadXY-vec2(cameraPosition.x+roadWorldSize*.5,roadWorldSize*.5-cameraPosition.z));
   road=mix(road,detail,blend*(1.-smoothstep(900.,1500.,range)));
  }
  diffuseColor.rgb=mix(diffuseColor.rgb,road.rgb,road.a);
 }
#endif`);
 }
 tick(now){this.uniforms.roadTime.value=now/1000;}
 update(position,target,distance){
  if(this.retryAt&&performance.now()>=this.retryAt&&!this.loading)this.load().catch(error=>console.warn('Road layer retry',error));
  if(!this.meta?.tiles.length||!this.n)return;
  const center=distance<1800?target:position,x=center.x+this.size/2,y=this.size/2-center.z;
  const wanted=distance<2200?nearestRoadTiles(this.meta.tiles,x,y,this.meta.tileSize,this.limit):[];
  this.wanted=new Set(wanted.map(t=>t[0]+':'+t[1]));
  this.queue=wanted.filter(t=>!this.slots.some(s=>s?.key===t[0]+':'+t[1])&&!this.pending.has(t[0]+':'+t[1])&&(this.failed.get(t[0]+':'+t[1])||0)<performance.now());this.pump();
 }
 pump(){
  while(this.pending.size<2&&this.queue.length){
   const tile=this.queue.shift(),key=tile[0]+':'+tile[1];this.pending.set(key,true);
   this.fetchTile(tile).catch(error=>{this.failed.set(key,performance.now()+5000);console.warn('Road tile unavailable',key,error);}).finally(()=>{this.pending.delete(key);this.pump();});
  }
 }
 async fetchTile(tile){
  const key=tile[0]+':'+tile[1],r=await fetch(`maps/roads/${this.world}/${tile[2]}?v=${this.meta.version}`,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(String(r.status));
  const bitmap=await createImageBitmap(await r.blob());
  if(!this.wanted.has(key)){bitmap.close();return;}
  let slot=this.slots.findIndex(s=>!s||!this.wanted.has(s.key));if(slot<0&&this.slots.length<this.limit)slot=this.slots.length;
  if(slot<0){bitmap.close();return;}
  const canvas=new OffscreenCanvas(this.n,this.n),context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0,this.n,this.n);bitmap.close();const pixels=context.getImageData(0,0,this.n,this.n).data;
  const array=this.uniforms.roadTiles.value,lookup=this.uniforms.roadLookup.value,old=this.slots[slot];
  if(old)lookup.image.data.fill(0,(old.y*this.grid+old.x)*4,(old.y*this.grid+old.x)*4+4);
  array.image.data.set(pixels,slot*this.n*this.n*4);array.addLayerUpdate(slot);array.needsUpdate=true;
  lookup.image.data.set([slot+1,performance.now()/1000,0,0],(tile[1]*this.grid+tile[0])*4);lookup.needsUpdate=true;this.slots[slot]={key,x:tile[0],y:tile[1]};this.failed.delete(key);
 }
}
