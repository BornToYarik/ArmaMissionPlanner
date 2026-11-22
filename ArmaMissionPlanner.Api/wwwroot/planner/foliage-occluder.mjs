import {convexVolume} from './convex-volume.mjs';
// Solid convex outline of the leaf geometry. No per-leaf alpha holes, and no
// fictitious wall from the ground to a high tree crown.
export function foliageEnvelope(geometry,materials,category){
 const foliage=materials.map(m=>(m.alphaTest||0)>0||m.transparent===true),positions=geometry.attributes.position,index=geometry.index,points=[];
 const add=i=>{const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i);points.push([x,y,z]);};
 if(geometry.groups.length&&materials.length>1&&foliage.some(Boolean)){for(const group of geometry.groups)if(foliage[group.materialIndex])for(let i=group.start;i<group.start+group.count;i++)add(index?index.getX(i):i);}
 else {geometry.computeBoundingBox();const b=geometry.boundingBox,cut=category==='tree'&&!foliage.some(Boolean)?b.min.y+(b.max.y-b.min.y)*.3:b.min.y;for(let i=0;i<positions.count;i++)if(positions.getY(i)>=cut)add(i);}
 const geometryHull=convexVolume(points);return geometryHull?{geometry:geometryHull,foliage}:null;
}
