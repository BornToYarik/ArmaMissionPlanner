import * as THREE from 'three';
import {shotEffectAge,rocketSmokeTrail} from './shot-profiles.js';
import {sampleFlight} from './ballistics.js';
import {trajectoryPoint} from './shot-trajectory.js';
// One small depth-tested batch; no dynamic lights, shadows or per-shot objects.
export class ShotFlashes {
 constructor(scene,max=96){this.max=max;this.positions=new Float32Array(max*6);this.styles=new Float32Array(max*8);const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(this.positions,3));g.setAttribute('effectStyle',new THREE.BufferAttribute(this.styles,4));g.setDrawRange(0,0);this.mesh=new THREE.Points(g,new THREE.ShaderMaterial({transparent:true,depthTest:true,depthWrite:false,vertexShader:'attribute vec4 effectStyle;varying vec4 effect;void main(){vec4 p=modelViewMatrix*vec4(position,1.0);effect=effectStyle;gl_Position=projectionMatrix*p;gl_PointSize=clamp(effect.x*420.0/max(1.0,-p.z),0.0,48.0);if(-p.z>900.0)gl_PointSize=0.0;}',fragmentShader:'varying vec4 effect;void main(){float r=length(gl_PointCoord-.5)*2.0;if(r>1.0)discard;vec3 c=mix(vec3(1.,.75,.3),vec3(.38),effect.z);gl_FragColor=vec4(c,effect.y*(1.-r*r));}'}));this.mesh.frustumCulled=false;scene.add(this.mesh);}
 update(shots,now,enabled){this.mesh.visible=enabled;if(!enabled)return;let n=0;
  const add=(position,size,alpha,smoke)=>{if(alpha<=0||n>=this.max*2)return;this.positions.set(position,n*3);this.styles.set([size,alpha,smoke?1:0,0],n*4);n++;};
  // Give flashes priority over plumes when the fixed batch is full.
  for(const s of shots){const e=shotEffectAge(now,s.born,s.effect);if(!e)continue;add([s.from.x,s.from.y,s.from.z],s.effect==='bullet'?.28:1.2,e.flash,false);}
  for(const s of shots){const e=shotEffectAge(now,s.born,s.effect);if(!e)continue;
   if(s.effect==='rocket'){for(const puff of rocketSmokeTrail(e.age,s.duration)){const p=s.points?sampleFlight(s.points,puff.time):trajectoryPoint(s.from,s.to,s.rise,Math.min(s.limit,puff.time/s.duration));add(p,puff.size,puff.alpha,true);}}
   else add([s.from.x,s.from.y+e.age*.5,s.from.z],.5+e.age*.9,e.smoke*.22,true);
  }
  this.mesh.geometry.setDrawRange(0,n);this.mesh.geometry.attributes.position.needsUpdate=true;this.mesh.geometry.attributes.effectStyle.needsUpdate=true;
 }
}
