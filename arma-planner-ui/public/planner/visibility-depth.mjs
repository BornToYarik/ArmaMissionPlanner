import {minimumObstacleHeight} from './visibility-policy.mjs';
import * as T from './wog/vendor/three.module.js';
import {foliageEnvelope} from './foliage-occluder.mjs';
import {windowClosures} from './building-occluder.mjs';
const terrainCache=new WeakMap(),canopyCache=new WeakMap(),windowCache=new WeakMap();
const rendererCaches=new WeakMap();
const copyCache=new WeakMap(),boundsCache=new WeakMap();
const visibilitySources=new WeakMap();
// Display quality never determines the foliage used for sight calculations.
export function visibilitySource(source){const model=source.geometry?.userData.visibilityModel;if(!model)return source;
 let copy=visibilitySources.get(source);if(!copy){copy=Object.create(source);copy.geometry=model.geometry;copy.material=model.materials;copy.userData={...source.userData,sightSource:source};visibilitySources.set(source,copy);}return copy;
}
function placedBounds(source){const key=source.matrixWorld.elements.join(','),version=source.instanceMatrix?.version||0,count=source.isInstancedMesh?source.count:1;let cached=boundsCache.get(source);if(cached?.key===key&&cached.version===version&&cached.count===count)return cached.rows;
 if(!source.geometry.boundingBox)source.geometry.computeBoundingBox();const matrix=new T.Matrix4(),box=new T.Box3(),rows=new Float64Array(count*5);
 for(let i=0;i<count;i++){if(source.isInstancedMesh){source.getMatrixAt(i,matrix);matrix.premultiply(source.matrixWorld);}else matrix.copy(source.matrixWorld);box.copy(source.geometry.boundingBox).applyMatrix4(matrix);rows.set([box.min.x,box.min.z,box.max.x,box.max.z,box.max.y-box.min.y],i*5);}
 boundsCache.set(source,{key,version,count,rows});return rows;
}
function reusableCopy(source,geometry,mats){const owner=source.userData.sightSource||source;let cache=copyCache.get(owner);if(!cache){cache=new Map();copyCache.set(owner,cache);}let copy=cache.get(geometry);if(!copy){copy=source.isInstancedMesh?new T.InstancedMesh(geometry,mats,source.count):new T.Mesh(geometry,mats);cache.set(geometry,copy);geometry.addEventListener('dispose',()=>{copy.isInstancedMesh&&copy.dispose();cache.delete(geometry);});}copy.material=mats;return copy;}
function cachedTerrain(source,origin,blend){const key=source.matrixWorld.elements.join(',')+':'+blend;let entry=terrainCache.get(source.geometry);if(entry?.key!==key){entry?.geometry.dispose();entry={key,reference:origin.clone(),geometry:terrainPlanes(source,origin,blend)};terrainCache.set(source.geometry,entry);if(!source.geometry.userData.sightCache){source.geometry.userData.sightCache=true;source.geometry.addEventListener('dispose',()=>{terrainCache.get(source.geometry)?.geometry.dispose();terrainCache.delete(source.geometry);});}}return entry;}
function cacheShape(cache,source,create){if(!cache.has(source.geometry)){const result=create();cache.set(source.geometry,result);source.geometry.addEventListener('dispose',()=>{const result=cache.get(source.geometry);(result?.geometry||result)?.dispose();cache.delete(source.geometry);});}return cache.get(source.geometry);}
// Prepare expensive window/crown topology outside the UI thread. Only original
// geometry arrays are copied; originals stay owned by the renderer.
let shapeWorker,shapeSerial=0;const shapeJobs=new Map(),shapeRequests=new WeakMap();
function shapeRequest(mesh){let pending=shapeRequests.get(mesh.geometry);if(pending)return pending;
 const cache=mesh.userData.category==='building'?windowCache:canopyCache;if(cache.has(mesh.geometry))return Promise.resolve();
 if(!shapeWorker){shapeWorker=new Worker(new URL('./visibility-preparation-worker.mjs',import.meta.url),{type:'module'});shapeWorker.onmessage=({data})=>{const job=shapeJobs.get(data.id);if(!job)return;shapeJobs.delete(data.id);data.error?job.reject(Error(data.error)):job.resolve(data);};shapeWorker.onerror=()=>{for(const job of shapeJobs.values())job.reject(Error('Ошибка подготовки геометрии обзора'));shapeJobs.clear();shapeWorker.terminate();shapeWorker=null;};}
 const g=mesh.geometry,id=++shapeSerial;
 pending=new Promise((resolve,reject)=>{shapeJobs.set(id,{resolve,reject});shapeWorker.postMessage({id,category:mesh.userData.category,positions:g.attributes.position.array,indices:g.index?.array,groups:g.groups,materials:[mesh.material].flat().map(m=>({alphaTest:m.alphaTest,transparent:m.transparent}))});}).then(data=>{let geometry=null;if(data.positions){geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(data.positions,3));if(data.indices)geometry.setIndex(new T.BufferAttribute(data.indices,1));}const value=mesh.userData.category==='building'?geometry:geometry?{geometry,foliage:data.foliage}:null;cacheShape(cache,mesh,()=>value);}).finally(()=>shapeRequests.delete(g));
 shapeRequests.set(g,pending);return pending;
}
export async function prepareVisibilityShapes(meshes){const unique=new Map();for(const item of meshes){const mesh=visibilitySource(item);if(['building','tree','bush'].includes(mesh.userData.category))unique.set(mesh.geometry,mesh);}const work=[...unique.values()];for(let i=0;i<work.length;i+=3)await Promise.all(work.slice(i,i+3).map(shapeRequest));}
export function placedHeight(bounds,matrix){const s=bounds.getSize(new T.Vector3()),m=matrix.elements;return Math.abs(m[1])*s.x+Math.abs(m[5])*s.y+Math.abs(m[9])*s.z;}
// Compute flat terrain planes in double precision. Derivatives of interpolated
// world positions are too noisy for almost horizontal, kilometre-long sightlines.
export function terrainPlanes(source,origin,blend=1){
 const g=source.geometry.index?source.geometry.toNonIndexed():source.geometry.clone(),p=g.attributes.position,prev=g.attributes.terrainPrevious;
 const planes=new Float32Array(p.count*4),points=[new T.Vector3(),new T.Vector3(),new T.Vector3()],n=new T.Vector3(),edge=new T.Vector3();
 for(let i=0;i<p.count;i+=3){for(let j=0;j<3;j++){points[j].fromBufferAttribute(p,i+j);if(prev)points[j].y=prev.getX(i+j)*(1-blend)+points[j].y*blend;points[j].applyMatrix4(source.matrixWorld).sub(origin);}
  n.subVectors(points[1],points[0]).cross(edge.subVectors(points[2],points[0])).normalize();let d=n.dot(points[0]);if(d<0){n.negate();d=-d;}
  for(let j=0;j<3;j++)planes.set([n.x,n.y,n.z,d],(i+j)*4);
 }
 g.setAttribute('sightPlane',new T.BufferAttribute(planes,4));return g;
}
// Six views from the observer. Texels store first-surface planes, not a coarse
// ground mask. Plane intersection avoids depth bias on grazing terrain rays.
export function visibilityDepth(renderer,{origin,radius,meshes,ground,detail,bounds,blend=1,unknown=[],size=768,objectsOnly=false}){
 if(!renderer.extensions.has('EXT_color_buffer_float'))throw Error('Для точного обзора нужна поддержка EXT_color_buffer_float в браузере.');
 let cache=rendererCaches.get(renderer);if(!cache){cache={materials:new Map(),targets:new Map(),unknownGeometry:new T.BoxGeometry(1,1,1),unknownMeshes:[],hidden:new T.MeshBasicMaterial({visible:false})};rendererCaches.set(renderer,cache);}
 let target=cache.targets.get(size);if(!target){target=new T.WebGLCubeRenderTarget(size,{type:T.FloatType,minFilter:T.NearestFilter,magFilter:T.NearestFilter,generateMipmaps:false,depthBuffer:true});cache.targets.set(size,target);}
 const started=performance.now(),root=new T.Scene(),owned=[];
 const material=(source={},terrain=0)=>{
  const map=source.alphaTest>0?source.map:null;map?.updateMatrix();
  const key=terrain+'|'+(map?.uuid||'')+'|'+(source.alphaTest||0),old=cache.materials.get(key);if(old){old.uniforms.eye.value=origin;old.uniforms.detailBounds.value=bounds||new T.Vector4(1,1,-1,-1);old.uniforms.blend.value=blend;return old;}
  const m=new T.ShaderMaterial({side:T.DoubleSide,toneMapped:false,uniforms:{eye:{value:origin},planeEyeOffset:{value:new T.Vector3()},opacityMap:{value:map},alphaLimit:{value:source.alphaTest||0},uvMatrix:{value:map?.matrix||new T.Matrix3()},detailBounds:{value:bounds||new T.Vector4(1,1,-1,-1)},blend:{value:blend}},defines:{...(map?{ALPHA_MAP:1}:{}),...(terrain===2?{TERRAIN_DETAIL:1}:{}),...(terrain===1?{TERRAIN_COARSE:1}:{})},
   vertexShader:`varying vec3 worldPoint;varying vec3 eyePoint;varying vec2 texUV;uniform mat3 uvMatrix;uniform vec3 eye;
    #if defined(TERRAIN_DETAIL) || defined(TERRAIN_COARSE)
    attribute vec4 sightPlane;varying vec4 flatPlane;uniform vec3 planeEyeOffset;
    #endif
    #ifdef TERRAIN_DETAIL
    attribute float terrainPrevious;uniform float blend;
    #endif
    void main(){vec3 p=position;
    #ifdef TERRAIN_DETAIL
    p.y=mix(terrainPrevious,position.y,blend);
    #endif
    vec4 w=vec4(p,1.);
    #ifdef USE_INSTANCING
    w=instanceMatrix*w;
    #endif
    w=modelMatrix*w;worldPoint=w.xyz;eyePoint=w.xyz-eye;
    #if defined(TERRAIN_DETAIL) || defined(TERRAIN_COARSE)
    flatPlane=vec4(sightPlane.xyz,sightPlane.w-dot(sightPlane.xyz,planeEyeOffset));if(flatPlane.w<0.)flatPlane=-flatPlane;
    #endif
    texUV=(uvMatrix*vec3(uv,1.)).xy;gl_Position=projectionMatrix*viewMatrix*w;}`,
   fragmentShader:`varying vec3 worldPoint;varying vec3 eyePoint;varying vec2 texUV;uniform vec3 eye;uniform vec4 detailBounds;uniform sampler2D opacityMap;uniform float alphaLimit;
    #if defined(TERRAIN_DETAIL) || defined(TERRAIN_COARSE)
    varying vec4 flatPlane;
    #endif
    void main(){
    #ifdef TERRAIN_COARSE
    if(worldPoint.x>detailBounds.x&&worldPoint.z>detailBounds.y&&worldPoint.x<detailBounds.z&&worldPoint.z<detailBounds.w)discard;
    #endif
    #ifdef ALPHA_MAP
    if(texture2D(opacityMap,texUV).a<alphaLimit)discard;
    #endif
    #if defined(TERRAIN_DETAIL) || defined(TERRAIN_COARSE)
    gl_FragColor=flatPlane;
    #else
    vec3 n=normalize(cross(dFdx(eyePoint),dFdy(eyePoint)));float d=dot(n,eyePoint);gl_FragColor=d<0.?vec4(-n,-d):vec4(n,d);
    #endif
    }`});cache.materials.set(key,m);return m;
 };
 const add=(source,terrain=0,simplify=true,allowed=null)=>{
  if(!source?.geometry)return;source.updateMatrixWorld(true);
  if(!terrain&&simplify){const rows=placedBounds(source),near=i=>{if(rows[i+4]<minimumObstacleHeight-1e-6)return false;const x=Math.max(rows[i],Math.min(rows[i+2],origin.x)),z=Math.max(rows[i+1],Math.min(rows[i+3],origin.z));return (x-origin.x)**2+(z-origin.z)**2<=radius*radius;};if(source.isInstancedMesh){allowed=[];for(let i=0;i<source.count;i++)if(near(i*5))allowed.push(i);if(!allowed.length)return;}else if(!near(0))return;}

  let mats=Array.isArray(source.material)?source.material.map(m=>material(m,terrain)):material(source.material,terrain);
  if(simplify&&['tree','bush'].includes(source.userData.category)){
   const envelope=cacheShape(canopyCache,source,()=>foliageEnvelope(source.geometry,[source.material].flat(),source.userData.category));
   if(envelope){const canopy=Object.create(source);canopy.geometry=envelope.geometry;canopy.material={};canopy.userData={...source.userData,sightSource:source};add(canopy,0,false,allowed);if(Array.isArray(mats))mats=mats.map((m,i)=>envelope.foliage[i]?cache.hidden:m);else if(envelope.foliage[0])mats=cache.hidden;}
  }
  if(simplify&&source.userData.category==='building'){
   const g=cacheShape(windowCache,source,()=>windowClosures(source.geometry));if(g){const closure=Object.create(source);closure.geometry=g;closure.material={};closure.userData={...source.userData,sightSource:source};add(closure,0,false,allowed);}
  }
  let geometry=source.geometry;if(terrain){const cached=cachedTerrain(source,origin,terrain===2?blend:1);geometry=cached.geometry;for(const m of [mats].flat())m.uniforms.planeEyeOffset.value.subVectors(origin,cached.reference);}
  const copy=reusableCopy(source,geometry,mats);if(source.isInstancedMesh){const ids=allowed?.join(',')??'all',version=source.instanceMatrix.version;if(copy.userData.ids!==ids||copy.userData.version!==version){const matrix=new T.Matrix4();(allowed||Array.from({length:source.count},(_,i)=>i)).forEach((id,i)=>{source.getMatrixAt(id,matrix);copy.setMatrixAt(i,matrix);});copy.count=allowed?.length??source.count;copy.instanceMatrix.needsUpdate=true;copy.boundingSphere=null;copy.userData.ids=ids;copy.userData.version=version;}}
  copy.matrix.copy(source.matrixWorld);copy.matrixAutoUpdate=false;copy.frustumCulled=true;root.add(copy);
 };
 if(!objectsOnly){add(ground,1);add(detail,2);}for(const mesh of meshes)add(visibilitySource(mesh));
 const fullyUnknown=unknown.some(b=>b.containsPoint(origin));
 let unknownIndex=0;for(const box of unknown){const x=Math.max(box.min.x,Math.min(box.max.x,origin.x)),z=Math.max(box.min.z,Math.min(box.max.z,origin.z));if((x-origin.x)**2+(z-origin.z)**2>radius*radius)continue;const minY=Math.max(box.min.y,origin.y-radius),maxY=Math.min(box.max.y,origin.y+radius);let m=cache.unknownMeshes[unknownIndex];if(!m){m=new T.Mesh(cache.unknownGeometry,material());cache.unknownMeshes[unknownIndex]=m;}m.material=material();m.position.set((box.min.x+box.max.x)/2,(minY+maxY)/2,(box.min.z+box.max.z)/2);m.scale.set(box.max.x-box.min.x,maxY-minY,box.max.z-box.min.z);root.add(m);unknownIndex++;}
 const prepared=performance.now();
 const camera=new T.CubeCamera(.05,radius,target);camera.position.copy(origin);
 const oldColor=renderer.getClearColor(new T.Color()),oldAlpha=renderer.getClearAlpha(),oldTarget=renderer.getRenderTarget();
 try{renderer.setClearColor(0,0);camera.update(renderer,root);}
 finally{renderer.setRenderTarget(oldTarget);renderer.setClearColor(oldColor,oldAlpha);for(const g of owned)g.dispose();}
 return {target,objectsOnly,pooled:true,origin:origin.clone(),radius,fullyUnknown,incomplete:unknown.length,resolution:size,prepareMs:prepared-started,submitMs:performance.now()-prepared};
}
