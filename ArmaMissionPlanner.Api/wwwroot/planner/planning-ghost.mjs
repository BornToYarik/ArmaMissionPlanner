import * as T from './wog/vendor/three.module.js';
export function boardingGhostMesh(source){
 // Object3D.clone serializes userData, which contains a circular unit/mesh link.
 // Preview only needs shared geometry and independent translucent materials.
 const mesh=new T.Mesh(source.geometry);
 mesh.quaternion.copy(source.quaternion);mesh.scale.copy(source.scale);
 const materials=[source.material].flat().map(material=>{const copy=material.clone();copy.transparent=true;copy.opacity=.5;copy.depthWrite=false;return copy;});
 mesh.material=Array.isArray(source.material)?materials:materials[0];return mesh;
}
