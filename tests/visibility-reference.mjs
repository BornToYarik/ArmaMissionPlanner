import * as T from '/planner/wog/vendor/three.module.js';
import {terrainGridHit} from '/planner/wog/terrain-ray.js';
// Independent CPU triangle intersections. The production projection is only read
// for classification; its cube-plane algorithm is not used by the reference.
export async function compareGroundRays(renderer,layer,terrain,ground,blockers){
 const rows=[],matrix=new T.Matrix4(),v=new T.Vector3();
 for(const source of blockers){if(!source.geometry.boundingBox)source.geometry.computeBoundingBox();
  for(let i=0;i<(source.isInstancedMesh?source.count:1);i++){
   if(source.isInstancedMesh){source.getMatrixAt(i,matrix);matrix.premultiply(source.matrixWorld);}else matrix.copy(source.matrixWorld);
   const bounds=source.geometry.boundingBox.clone().applyMatrix4(matrix);
   if(bounds.distanceToPoint(layer.origin)>layer.radius)continue;
   const mesh=new T.Mesh(source.geometry,source.material);mesh.matrixWorld.copy(matrix);rows.push({bounds,mesh});
  }
 }
 const read=target=>{const data=new Uint8Array(target.width*target.height*4);renderer.readRenderTargetPixels(target,0,0,target.width,target.height,data);return {data,w:target.width,h:target.height};};
 const full=read(layer.target),near=read(layer.nearTarget),inside=(p,b)=>p.x>b.x&&p.z>b.y&&p.x<b.z&&p.z<b.w;
 const hitTerrain=ray=>[terrainGridHit(ray,ground,{accept:p=>!terrain.detail||!inside(p,terrain.bounds)}),terrainGridHit(ray,terrain.detail,{blend:terrain.blend})].filter(Boolean).sort((a,b)=>a.distance-b.distance)[0];
 const smooth=(a,b,v)=>{const f=Math.max(0,Math.min(1,(v-a)/(b-a)));return f*f*(3-2*f);};
 const sample=(p,map,b)=>{const u=(p.x-b.x)/b.z,w=(b.y-p.z)/b.w;if(u<0||u>1||w<0||w>1)return null;const x=u*map.w-.5,y=w*map.h-.5,ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,value=[0,0];for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const k=(Math.max(0,Math.min(map.h-1,iy+dy))*map.w+Math.max(0,Math.min(map.w-1,ix+dx)))*4,weight=(dx?fx:1-fx)*(dy?fy:1-fy);for(let c=0;c<2;c++)value[c]+=weight*map.data[k+c]/255;}return {value,rim:Math.min(u,w,1-u,1-w)};};
 const ray=new T.Ray(),cast=new T.Raycaster(),down=new T.Vector3(0,-1,0),counts={tested:0,trueVisible:0,trueHidden:0,falseVisible:0,falseHidden:0};
 const start=performance.now(),errors=[];let completed=0;
 for(let dx=-900;dx<=900;dx+=53)for(let dz=-900;dz<=900;dz+=59){
  ray.set(new T.Vector3(layer.origin.x+dx,10000,layer.origin.z+dz),down);const hit=hitTerrain(ray);if(!hit||hit.point.distanceTo(layer.origin)>=layer.radius-5)continue;
  const point=hit.point,delta=point.clone().sub(layer.origin),length=delta.length();ray.set(layer.origin,delta.normalize());const terrainHit=hitTerrain(ray);let blocked=!!terrainHit&&terrainHit.distance<length-.03;
  if(!blocked){cast.set(ray.origin,ray.direction);cast.far=length-.03;for(const row of rows){const hit=ray.intersectBox(row.bounds,v);if(!hit||hit.distanceTo(ray.origin)>=length-.03)continue;
   if(cast.intersectObject(row.mesh,false).some(h=>{const material=Array.isArray(row.mesh.material)?row.mesh.material[h.face.materialIndex]:row.mesh.material;return material?.visible!==false;})){blocked=true;break;}
  }}
  const nearValue=sample(point,near,layer.nearBounds),farValue=sample(point,full,layer.maskBounds);let mask=farValue?.value||[0,0];if(nearValue){const w=smooth(0,.025,nearValue.rim);mask=mask.map((v,i)=>v*(1-w)+nearValue.value[i]*w);}const got=mask[0]*smooth(.55,.95,mask[1])>=.5;if(got===blocked)errors.push({point:point.toArray(),expected:!blocked,got,mask});counts.tested++;counts[got?(blocked?'falseVisible':'trueVisible'):(blocked?'trueHidden':'falseHidden')]++;
  if(++completed%80===0)await new Promise(resolve=>setTimeout(resolve,0));
 }
 return {...counts,errors,agreement:100*(counts.trueVisible+counts.trueHidden)/counts.tested,precision:100*counts.trueVisible/(counts.trueVisible+counts.falseVisible),recall:100*counts.trueVisible/(counts.trueVisible+counts.falseHidden),milliseconds:performance.now()-start,scope:'Loaded scene, solid crowns, closed windows, placed objects >=1.4m; 1.8km square'};
}
