import * as THREE from './vendor/three.module.js';
// Exact intersection with the regular terrain triangles, visiting only cells
// crossed in X/Z. Terrain meshes use world-space vertices and identity matrices.
export function terrainGridHit(ray,mesh,{blend=1,accept=null}={}){
 if(!mesh)return null;
 const vertices=mesh.geometry.attributes.position,previous=mesh.geometry.attributes.terrainPrevious,n=mesh.geometry.userData?.columns||Math.round(Math.sqrt(vertices.count)),rows=mesh.geometry.userData?.rows||n;
 if(n<2||rows<2||n*rows!==vertices.count)return null;
 const x0=vertices.getX(0),z0=vertices.getZ(0),sx=vertices.getX(1)-x0,sz=vertices.getZ(n)-z0;
 if(!sx||!sz)return null;
 const origin=[(ray.origin.x-x0)/sx,(ray.origin.z-z0)/sz],direction=[ray.direction.x/sx,ray.direction.z/sz];
 let enter=0,exit=Infinity;const limits=[n-1,rows-1];
 for(let axis=0;axis<2;axis++){
  if(Math.abs(direction[axis])<1e-15){if(origin[axis]<0||origin[axis]>limits[axis])return null;continue;}
  const a=-origin[axis]/direction[axis],b=(limits[axis]-origin[axis])/direction[axis];enter=Math.max(enter,Math.min(a,b));exit=Math.min(exit,Math.max(a,b));
 }
 if(exit<enter)return null;
 const cell=origin.map((v,i)=>Math.max(0,Math.min(limits[i]-1,Math.floor(v+direction[i]*(enter+1e-7))))),step=direction.map(Math.sign),delta=direction.map(v=>v?Math.abs(1/v):Infinity);
 const next=cell.map((v,i)=>direction[i]?(v+(step[i]>0?1:0)-origin[i])/direction[i]:Infinity);
 const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),point=new THREE.Vector3();
 const vertex=(out,index)=>{out.fromBufferAttribute(vertices,index);if(previous&&blend<1)out.y=previous.getX(index)+(out.y-previous.getX(index))*blend;return out;};
 for(let visited=0;visited<n+rows+4;visited++){
  const end=Math.min(exit,...next),k=cell[1]*n+cell[0];let nearest=null;
  for(const tri of [[k,k+1,k+n],[k+1,k+n+1,k+n]]){
   if(!ray.intersectTriangle(vertex(a,tri[0]),vertex(b,tri[1]),vertex(c,tri[2]),false,point))continue;
   const distance=point.distanceTo(ray.origin);if(distance<enter-1e-5||distance>end+1e-5||accept&&!accept(point))continue;
   if(!nearest||distance<nearest.distance)nearest={point:point.clone(),distance,object:mesh};
  }
  if(nearest)return nearest;
  if(!Number.isFinite(end)||end>=exit)return null;
  const crossX=next[0]<=next[1],crossZ=next[1]<=next[0];enter=end;
  if(crossX){cell[0]+=step[0];next[0]+=delta[0];}if(crossZ){cell[1]+=step[1];next[1]+=delta[1];}
  if(cell.some((v,i)=>v<0||v>=limits[i]))return null;
 }
 return null;
}
