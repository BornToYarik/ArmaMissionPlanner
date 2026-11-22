import * as T from './wog/vendor/three.module.js';
import {gameplayObject} from './terrain-overlays.mjs';
import {sideColor} from './planning-units.mjs';
export class SelectionRings{
 constructor(scene){this.scene=scene;this.items=new Map();}
 update(units,ids,{height,half,camera,viewportHeight,revision}){
  const selected=new Set(ids),targets=new Set();for(const u of units)if(selected.has(u.id))targets.add(u.carrier??u.id);
  const active=units.filter(u=>targets.has(u.id)&&u.mesh.visible&&gameplayObject(u));
  for(const [id,mesh]of this.items)if(!active.some(u=>u.id===id)){this.scene.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();this.items.delete(id);}
  for(const u of active){
   let mesh=this.items.get(u.id);if(!mesh){const geometry=new T.BufferGeometry(),indices=[];
    for(let i=0;i<48;i++){const j=(i+1)%48;indices.push(i*2,j*2,i*2+1,j*2,j*2+1,i*2+1);}
    geometry.setAttribute('position',new T.Float32BufferAttribute(new Float32Array(48*6),3));geometry.setIndex(indices);
    mesh=new T.Mesh(geometry,new T.MeshBasicMaterial({color:sideColor(u.side),side:T.DoubleSide,transparent:true,opacity:.85,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2}));mesh.renderOrder=5;this.scene.add(mesh);this.items.set(u.id,mesh);
   }
   if(!u.selectionRadius){u.mesh.geometry.computeBoundingBox();const size=u.mesh.geometry.boundingBox.getSize(new T.Vector3());u.selectionRadius=u.mobility==='foot'?.85:Math.max(1.5,Math.min(15,Math.hypot(size.x,size.z)/2+.3));}
   const dist=camera.position.distanceTo(u.mesh.position),minRadius=dist*Math.tan(camera.fov*Math.PI/360)*12/Math.max(1,viewportHeight),radius=Math.max(u.selectionRadius,Math.min(u.mobility==='foot'?4:20,minRadius));
   const center=u.mesh.position,cache=mesh.userData;if(cache.revision===revision&&cache.x===center.x&&cache.y===center.y&&cache.z===center.z&&Math.abs((cache.radius||0)-radius)<radius*.04)continue;
   Object.assign(cache,{revision,x:center.x,y:center.y,z:center.z,radius});mesh.material.color.set(sideColor(u.side));
   const attr=mesh.geometry.attributes.position,base=height(center.x+half,half-center.z),onRoof=u.mobility==='foot'&&center.y-base>1;
   for(let i=0;i<48;i++)for(let j=0;j<2;j++){const a=i*Math.PI/24,r=radius*(j?.76:1),x=center.x+Math.cos(a)*r,z=center.z+Math.sin(a)*r,h=onRoof?center.y:height(x+half,half-z);attr.setXYZ(i*2+j,x,h+.13,z);}
   attr.needsUpdate=true;mesh.geometry.computeBoundingSphere();
  }
 }
}
