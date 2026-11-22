import {compareGroundRays} from '/visibility-reference.mjs';
import {foliageEnvelope} from '/planner/foliage-occluder.mjs';
import {windowClosures} from '/planner/building-occluder.mjs';
import {minimumObstacleHeight} from '/planner/visibility-policy.mjs';
import * as T from '/planner/wog/vendor/three.module.js';
import {projectVisibility} from '/planner/visibility-projection.mjs';
import {placedHeight,visibilityDepth,visibilitySource} from '/planner/visibility-depth.mjs';

// Test-only, explicitly enabled through the audit harness. No browser automation
// state access: the page renders its own diagnostic and exposes results in DOM.
export function installAudit(scene,observations,addObservation){
 const preset=document.createElement('button');preset.textContent='Контрольный склон';preset.onclick=()=>addObservation([6441.503791252632,11172.626186964033,scene.surfaceHeight(6441.503791252632,11172.626186964033)],1.7);document.querySelector('#sceneTools').append(preset);
 const button=document.createElement('button');button.textContent='Сверка обзора из глаз';document.querySelector('#sceneTools').append(button);
 button.onclick=async()=>{
  button.disabled=true;const o=observations.filter(o=>o.enabled).at(-1),layer=o&&scene.viewshed.layers.get(o.id);
  if(!layer){button.disabled=false;alert('Сначала поставьте точку обзора');return;}
  const renderer=scene.renderer,width=512,height=384,target=new T.WebGLRenderTarget(width,height),root=new T.Scene(),owned=[],meshes=[];
  const camera=new T.PerspectiveCamera(75,width/height,.05,layer.radius);camera.position.copy(layer.origin);
  const snapshot=scene.loadedSceneSnapshot(),terrain=scene.sightTerrain(o.point),terrainOnly=projectVisibility(renderer,visibilityDepth(renderer,{origin:layer.origin,radius:layer.radius,meshes:[],ground:scene.ground,objectsOnly:true}),{ground:scene.ground,...terrain,size:2048});
  const shapeCache=new Map(),policyCopies=[],policyMaterials=[];
  const black=m=>{const material=new T.MeshBasicMaterial({color:0,side:T.DoubleSide,map:m.alphaTest>0?m.map:null,alphaTest:m.alphaTest||0});owned.push(material);return material;};
  for(const item of snapshot.meshes){const source=visibilitySource(item);
   const g=source.geometry;if(!g.boundingBox)g.computeBoundingBox();const matrix=new T.Matrix4(),ids=[];
   for(let i=0;i<(source.isInstancedMesh?source.count:1);i++){if(source.isInstancedMesh){source.getMatrixAt(i,matrix);matrix.premultiply(source.matrixWorld);}else matrix.copy(source.matrixWorld);if(placedHeight(g.boundingBox,matrix)>=minimumObstacleHeight)ids.push(i);}
   if(!ids.length)continue;
   const converted=[source.material].flat().map(black),materials=Array.isArray(source.material)?converted:converted[0],copy=source.isInstancedMesh?new T.InstancedMesh(g,materials,ids.length):new T.Mesh(g,materials);
   if(source.isInstancedMesh){ids.forEach((id,i)=>{source.getMatrixAt(id,matrix);copy.setMatrixAt(i,matrix);});copy.instanceMatrix.needsUpdate=true;}
   copy.matrix.copy(source.matrixWorld);copy.matrixAutoUpdate=false;root.add(copy);meshes.push({copy,source,mask:materials});
   const category=source.userData.category;if(['tree','bush','building'].includes(category)){
    let shape=shapeCache.get(g);if(shape===undefined){shape=category==='building'?{geometry:windowClosures(g)}:foliageEnvelope(g,[source.material].flat(),category);shapeCache.set(g,shape);if(shape?.geometry)owned.push(shape.geometry);}
    if(shape?.geometry){const hull=copy.clone();hull.geometry=shape.geometry;hull.material=new T.MeshBasicMaterial({color:0,side:T.DoubleSide});owned.push(hull.material);hull.visible=false;root.add(hull);policyCopies.push(hull);
     if(shape.foliage?.some(Boolean)){const hide=new T.MeshBasicMaterial({visible:false});owned.push(hide);const masks=Array.isArray(materials)?materials.map((m,i)=>shape.foliage[i]?hide:m):shape.foliage[0]?hide:materials;policyMaterials.push({copy,raw:materials,solid:masks});}
    }
   }
  }
  const maskMaterial=coarse=>{const m=new T.ShaderMaterial({side:T.DoubleSide,uniforms:{eye:{value:layer.origin},radius:{value:layer.radius},bounds:{value:layer.maskBounds},nearBounds:{value:layer.nearBounds},terrainMap:{value:terrainOnly.target.texture},terrainNearMap:{value:terrainOnly.nearTarget.texture},map:{value:layer.target.texture},nearMap:{value:layer.nearTarget.texture},detailBounds:{value:scene.detail.bounds},blend:{value:scene.detail.blend.value}},defines:coarse?{COARSE:1}:{DETAIL:1},vertexShader:`varying vec3 w;uniform float blend;
   #ifdef DETAIL
   attribute float terrainPrevious;
   #endif
   void main(){vec3 p=position;
   #ifdef DETAIL
   p.y=mix(terrainPrevious,p.y,blend);
   #endif
   w=(modelMatrix*vec4(p,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(w,1.);}`,fragmentShader:`varying vec3 w;uniform vec3 eye;uniform float radius;uniform vec4 bounds,nearBounds,detailBounds;uniform sampler2D map,nearMap,terrainMap,terrainNearMap;void main(){
   #ifdef COARSE
   if(w.x>detailBounds.x&&w.z>detailBounds.y&&w.x<detailBounds.z&&w.z<detailBounds.w)discard;
   #endif
   if(distance(w,eye)>radius){gl_FragColor=vec4(0.,0.,0.,1.);return;}
   vec2 uv=vec2(w.x-bounds.x,bounds.y-w.z)/bounds.zw,nu=vec2(w.x-nearBounds.x,nearBounds.y-w.z)/nearBounds.zw,m=texture2D(map,uv).rg,tm=texture2D(terrainMap,uv).rg;
   if(all(greaterThanEqual(nu,vec2(0.)))&&all(lessThanEqual(nu,vec2(1.)))){float rim=min(min(nu.x,nu.y),min(1.-nu.x,1.-nu.y));m=mix(m,texture2D(nearMap,nu).rg,smoothstep(0.,.025,rim));tm=mix(tm,texture2D(terrainNearMap,nu).rg,smoothstep(0.,.025,rim));}
   gl_FragColor=vec4(1.,m.r*smoothstep(.55,.95,m.g),tm.r*smoothstep(.55,.95,tm.g),1.);}`});owned.push(m);return m;};
  const grounds=[];for(const [source,coarse]of [[scene.ground,true],[scene.detail.mesh,false]])if(source){const copy=new T.Mesh(source.geometry,maskMaterial(coarse));copy.matrix.copy(source.matrixWorld);copy.matrixAutoUpdate=false;root.add(copy);grounds.push({copy,source,mask:copy.material});}
  // Unknown streamed regions are not a reference against which to claim accuracy.
  const step=snapshot.step;for(const t of snapshot.missing){const g=new T.BoxGeometry(step,20000,step),m=new T.Mesh(g,new T.MeshBasicMaterial({color:0,side:T.DoubleSide}));m.position.set((t.x+.5)*step-scene.half,0,scene.half-(t.y+.5)*step);root.add(m);owned.push(g,m.material);}
  for(const light of scene.scene.children.filter(o=>o.isLight))root.add(light.clone());
  const pixels=new Uint8Array(width*height*4),rows=[];let worst=null;
  const oldTarget=renderer.getRenderTarget(),color=renderer.getClearColor(new T.Color()),alpha=renderer.getClearAlpha();
  try{
   renderer.setClearColor(0,1);renderer.setRenderTarget(target);
   for(const pitch of [-10,-35])for(let yaw=0;yaw<360;yaw+=45){
    const p=T.MathUtils.degToRad(pitch),a=T.MathUtils.degToRad(yaw);camera.lookAt(layer.origin.clone().add(new T.Vector3(Math.sin(a)*Math.cos(p),Math.sin(p),-Math.cos(a)*Math.cos(p))));
    renderer.clear();renderer.render(root,camera);renderer.readRenderTargetPixels(target,0,0,width,height,pixels);
    let total=0,correct=0,terrainCorrect=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>200){total++;if(pixels[i+1]>=128)correct++;if(pixels[i+2]>=128)terrainCorrect++;}
    for(const h of policyCopies)h.visible=true;for(const p of policyMaterials)p.copy.material=p.solid;
    const policyPixels=new Uint8Array(pixels.length);renderer.clear();renderer.render(root,camera);renderer.readRenderTargetPixels(target,0,0,width,height,policyPixels);
    let policyTotal=0,policyCorrect=0;for(let i=0;i<policyPixels.length;i+=4)if(policyPixels[i]>200){policyTotal++;if(policyPixels[i+1]>=128)policyCorrect++;}
    for(const h of policyCopies)h.visible=false;for(const p of policyMaterials)p.copy.material=p.raw;
    const row={yaw,pitch,total,correct,policyTotal,policyCorrect,policyPercent:policyTotal?100*policyCorrect/policyTotal:null,terrainCorrect,terrainPercent:total?100*terrainCorrect/total:null,percent:total?100*correct/total:null};rows.push(row);if(total>500&&(!worst||row.percent<worst.row.percent))worst={row,mask:pixels.slice(),camera:camera.clone()};
   }
   const total=rows.reduce((n,r)=>n+r.total,0),correct=rows.reduce((n,r)=>n+r.correct,0);
   for(const p of policyMaterials)p.copy.material=p.solid;
   root.updateMatrixWorld(true);
   const reference=await compareGroundRays(renderer,layer,terrain,scene.ground,[...meshes.map(m=>m.copy),...policyCopies,...root.children.filter(m=>m.isMesh&&!grounds.some(g=>g.copy===m)&&!meshes.some(s=>s.copy===m)&&!policyCopies.includes(m))]);
   for(const p of policyMaterials)p.copy.material=p.raw;
   const dialog=document.createElement('dialog');dialog.style.maxWidth='1100px';dialog.innerHTML='<h3>Наложение на вид из точки: подробные модели</h3><p>Зелёный — видимая земля закрашена. Красный — видимая земля пропущена. Проверка 16 направлений, загруженная геометрия; для растительности — самый подробный доступный LOD; объекты ниже 1,4 м исключены по правилу планировщика. Это полнота видимой земли, а не доказательство отсутствия ложной видимости за препятствиями.</p>';
   const pre=document.createElement('pre');pre.id='eyeAuditResult';pre.textContent=JSON.stringify({point:o.point,eye:o.eye,reference,percent:100*correct/total,policyPercent:100*rows.reduce((s,r)=>s+r.policyCorrect,0)/rows.reduce((s,r)=>s+r.policyTotal,0),total,correct,worst:worst?.row,rows},null,2);pre.style.maxHeight='130px';pre.style.overflow='auto';dialog.append(pre);
   if(worst){
    for(const m of meshes)m.copy.material=m.source.material;for(const m of grounds)m.copy.material=m.source.material;
    const hidden=scene.viewshed.presentationHidden;scene.viewshed.presentation(false);root.background=scene.scene.background;renderer.clear();renderer.render(root,worst.camera);renderer.readRenderTargetPixels(target,0,0,width,height,pixels);scene.viewshed.presentation(!hidden);
    const canvas=document.createElement('canvas');canvas.width=width*2;canvas.height=height;canvas.style.maxWidth='100%';const ctx=canvas.getContext('2d'),base=new ImageData(width,height),overlay=new ImageData(width,height);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const a=(y*width+x)*4,b=((height-1-y)*width+x)*4;for(let c=0;c<3;c++){const linear=pixels[a+c]/255;const rgb=255*(linear<=.0031308?12.92*linear:1.055*linear**(1/2.4)-.055);base.data[b+c]=rgb;overlay.data[b+c]=worst.mask[a]>200?rgb*.45+(worst.mask[a+1]>=128?(c===1?210:20):(c===0?240:20))*.55:rgb;}base.data[b+3]=overlay.data[b+3]=255;}
    ctx.putImageData(base,0,0);ctx.putImageData(overlay,width,0);dialog.append(canvas);
   }
   const close=document.createElement('button');close.textContent='Закрыть сверку';close.onclick=()=>dialog.close();dialog.append(close);document.body.append(dialog);dialog.onclose=()=>dialog.remove();dialog.showModal();
  }finally{renderer.setRenderTarget(oldTarget);renderer.setClearColor(color,alpha);target.dispose();terrainOnly.target.dispose();terrainOnly.nearTarget.dispose();for(const o of owned)o.dispose();for(const {copy}of meshes)if(copy.isInstancedMesh)copy.dispose();for(const copy of policyCopies)if(copy.isInstancedMesh)copy.dispose();button.disabled=false;}
 };
}
