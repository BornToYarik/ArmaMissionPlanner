import * as THREE from './vendor/three.module.js';
// Compact only scenery batches. Recorded actors and their picking IDs are untouched.
export class InstanceVisibility{
 constructor(){this.frustum=new THREE.Frustum();this.matrix=new THREE.Matrix4();this.inverse=new THREE.Matrix4();this.point=new THREE.Vector3();this.projection=new THREE.Matrix4();this.key='';this.hasVolume=false;}
 update(groups,camera){
  this.matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);const key=this.matrix.elements.join(',');const moved=key!==this.key;if(!moved&&![...groups.values()].some(e=>e.cullDirty))return;
  this.key=key;
  // Retain a conservative view volume. Tiny camera steps then reuse the GPU
  // instance buffer; every corner of the actual frustum must still fit inside.
  let recull=!this.hasVolume;
  if(moved&&this.hasVolume){this.inverse.copy(this.matrix).invert();outer:for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){this.point.set(x,y,z).applyMatrix4(this.inverse);if(!this.frustum.containsPoint(this.point)){recull=true;break outer;}}}
  if(recull){this.projection.copy(camera.projectionMatrix);this.projection.elements[0]*=.92;this.projection.elements[5]*=.92;this.matrix.multiplyMatrices(this.projection,camera.matrixWorldInverse);this.frustum.setFromProjectionMatrix(this.matrix);this.frustum.planes[4].constant+=64;this.frustum.planes[5].constant+=64;this.hasVolume=true;}
  const planes=this.frustum.planes;
  for(const entry of groups.values()){
   if(!recull&&!entry.cullDirty)continue;
   const mesh=entry.mesh,full=entry.fullMatrices,total=entry.total;
   let count=0,changed=entry.cullDirty;
   for(const source of entry.sources){
    // A tile entirely inside a plane cannot have an instance outside it.
    // Most visible tiles need no per-instance plane tests at all.
    let mask=63;const sphere=source.boundingSphere;
    if(sphere){mask=0;let outside=false;for(let p=0;p<6;p++){const plane=planes[p],distance=plane.distanceToPoint(sphere.center);if(distance< -sphere.radius){outside=true;break;}if(distance<sphere.radius)mask|=1<<p;}if(outside)continue;}
    const start=entry.offsets.get(source)/16,end=start+source.count;
    if(mask===0){for(let i=start;i<end;i++){changed||=entry.visibleIndices[count]!==i;entry.visibleIndices[count++]=i;}continue;}
    for(let i=start;i<end;i++){
    const b=entry.instanceBounds,j=i*4,x=b[j],y=b[j+1],z=b[j+2],r=b[j+3];
    let visible=true;for(let n=0;n<6;n++){if(!(mask&(1<<n)))continue;const p=planes[n];if(p.normal.x*x+p.normal.y*y+p.normal.z*z+p.constant< -r){visible=false;break;}}
    if(!visible)continue;
    changed||=entry.visibleIndices[count]!==i;entry.visibleIndices[count++]=i;
   }
   }
   changed||=mesh.count!==count;mesh.count=count;mesh.visible=count>0;
   if(changed){const output=mesh.instanceMatrix.array,indices=entry.visibleIndices;for(let i=0;i<count;){const start=i,from=indices[i++];while(i<count&&indices[i]===from+i-start)i++;output.set(full.subarray(from*16,(from+i-start)*16),start*16);}mesh.instanceMatrix.clearUpdateRanges();mesh.instanceMatrix.addUpdateRange(0,count*16);mesh.instanceMatrix.needsUpdate=true;}
   entry.cullDirty=false;
  }
 }
}
