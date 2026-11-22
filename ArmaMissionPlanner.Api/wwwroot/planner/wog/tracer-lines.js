import * as THREE from './vendor/three.module.js';
export class TracerHeads extends THREE.Points{
 constructor(vertices,sizes){
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(vertices,3));geometry.setAttribute('headSize',new THREE.BufferAttribute(sizes,1));geometry.setDrawRange(0,0);
  const material=new THREE.ShaderMaterial({transparent:true,depthTest:true,depthWrite:false,uniforms:{pixelRatio:{value:1}},
   vertexShader:`attribute float headSize;uniform float pixelRatio;void main(){vec4 view=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*view;gl_PointSize=headSize*pixelRatio;}`,
   fragmentShader:`void main(){float r=length(gl_PointCoord-vec2(.5))*2.;if(r>1.)discard;gl_FragColor=vec4(1.,.92,.61,1.-smoothstep(.6,1.,r));}`});
  super(geometry,material);this.frustumCulled=false;this.onBeforeRender=renderer=>{material.uniforms.pixelRatio.value=renderer.getPixelRatio();};
 }
 setCount(count){this.geometry.setDrawRange(0,count);this.geometry.attributes.position.needsUpdate=true;this.geometry.attributes.headSize.needsUpdate=true;}
}
// WebGL's native lines stay one pixel wide. Screen-space quads allow real widths.
export class TracerLines extends THREE.Mesh{
 constructor(vertices,colors,widths){
  const geometry=new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,-1,0,1,-1,0,1,1,0,0,1,0],3));geometry.setIndex([0,1,2,0,2,3]);
  const ends=new THREE.InstancedInterleavedBuffer(vertices,6),tints=new THREE.InstancedInterleavedBuffer(colors,6);
  geometry.setAttribute('start',new THREE.InterleavedBufferAttribute(ends,3,0));geometry.setAttribute('end',new THREE.InterleavedBufferAttribute(ends,3,3));
  geometry.setAttribute('tintStart',new THREE.InterleavedBufferAttribute(tints,3,0));geometry.setAttribute('tintEnd',new THREE.InterleavedBufferAttribute(tints,3,3));geometry.setAttribute('width',new THREE.InstancedBufferAttribute(widths,1));geometry.instanceCount=0;
  const material=new THREE.ShaderMaterial({transparent:true,depthTest:true,depthWrite:false,uniforms:{resolution:{value:new THREE.Vector2(1,1)},pixelRatio:{value:1},nearPlane:{value:.1}},
   vertexShader:`attribute vec3 start,end,tintStart,tintEnd;attribute float width;uniform vec2 resolution;uniform float pixelRatio,nearPlane;varying vec3 tint;varying float edgeDistance,halfWidth;
   void main(){vec4 a=modelViewMatrix*vec4(start,1.),b=modelViewMatrix*vec4(end,1.);float nearZ=-nearPlane*1.001;
    if(a.z>nearZ&&b.z>nearZ){gl_Position=vec4(2.,2.,2.,1.);return;}
    if(a.z>nearZ)a=mix(a,b,(nearZ-a.z)/(b.z-a.z));if(b.z>nearZ)b=mix(b,a,(nearZ-b.z)/(a.z-b.z));
    a=projectionMatrix*a;b=projectionMatrix*b;vec2 delta=(b.xy/b.w-a.xy/a.w)*resolution;float length2=length(delta);vec2 normal=length2>.0001?vec2(-delta.y,delta.x)/length2:vec2(1.,0.);
    halfWidth=width*pixelRatio*.5;float paddedHalf=halfWidth+1.;vec4 clip=mix(a,b,position.x);clip.xy+=normal*position.y*paddedHalf*2./resolution*clip.w;gl_Position=clip;tint=mix(tintStart,tintEnd,position.x);edgeDistance=position.y*paddedHalf;
   }`,fragmentShader:`varying vec3 tint;varying float edgeDistance,halfWidth;void main(){gl_FragColor=vec4(tint,clamp(halfWidth+.5-abs(edgeDistance),0.,1.)*.95);}`});
  super(geometry,material);this.ends=ends;this.tints=tints;this.frustumCulled=false;
  this.onBeforeRender=(renderer,scene,camera)=>{renderer.getDrawingBufferSize(material.uniforms.resolution.value);material.uniforms.pixelRatio.value=renderer.getPixelRatio();material.uniforms.nearPlane.value=camera.near;};
 }
 setCount(count){this.geometry.setDrawRange(0,6);this.geometry.instanceCount=count;this.ends.needsUpdate=true;this.tints.needsUpdate=true;this.geometry.attributes.width.needsUpdate=true;}
}
