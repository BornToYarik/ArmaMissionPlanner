import * as T from './wog/vendor/three.module.js';

// Roofs are picked from the displayed geometry, including placed instances.
// A vertical facade is not a place on which an observer can stand.
export function standingSurface(hit){
 if(!hit?.face)return false;
 const matrix=hit.object.matrixWorld.clone();
 if(hit.instanceId!==undefined){const instance=new T.Matrix4();hit.object.getMatrixAt(hit.instanceId,instance);matrix.multiply(instance);}
 const normal=hit.face.normal.clone().applyNormalMatrix(new T.Matrix3().getNormalMatrix(matrix));
 return normal.y>=.55;
}
export function pickObservationSurface(ray,terrain,meshes){
 const candidates=meshes.filter(m=>m.geometry&&m.userData.category==='building');
 for(const mesh of candidates)mesh.updateMatrixWorld(true);
 const roof=ray.intersectObjects(candidates,false).find(standingSurface);
 return roof&&(!terrain||roof.distance<terrain.distance)?roof:terrain;
}
