import * as T from './wog/vendor/three.module.js';
import {sightCoverageGLSL} from './visibility-sampling.mjs';
import {terrainField,terrainTraceGLSL} from './visibility-terrain.mjs';
const materialCache=new WeakMap();
const objectTest=`float sightTest(samplerCube cube,vec3 ray,vec3 actual,float len){vec4 p=textureCube(cube,ray);if(dot(p.xyz,p.xyz)<.5)return 1.;float d=dot(p.xyz,actual);return d<=0.||p.w-dot(p.xyz,actual*len)>=-.008?1.:0.;}`;
// Bake LOS once onto a top-down mask. Normal frames only tint the terrain,
// exactly like mission zones; there is no second mesh or per-pixel ray work.
function bakeVisibility(renderer,result,{ground,detail,bounds,blend=1,size=2048,maskRadius=0}){
 const coarseField=terrainField(ground),fineField=terrainField(detail,blend)||coarseField;
 const {origin,radius}=result,span=maskRadius||radius,extent=new T.Box3().setFromObject(ground),x0=Math.max(extent.min.x,origin.x-span),x1=Math.min(extent.max.x,origin.x+span),z0=Math.max(extent.min.z,origin.z-span),z1=Math.min(extent.max.z,origin.z+span);
 const width=Math.max(1,x1-x0),height=Math.max(1,z1-z0),maskBounds=new T.Vector4(x0,z1,width,height);
 const target=new T.WebGLRenderTarget(size,size,{minFilter:T.LinearFilter,magFilter:T.LinearFilter,depthBuffer:false,generateMipmaps:false}),root=new T.Scene();
 const add=(source,coarse)=>{if(!source)return;let cache=materialCache.get(renderer);if(!cache){cache=new Map();materialCache.set(renderer,cache);}let material=cache.get(coarse);if(!material){material=new T.ShaderMaterial({side:T.DoubleSide,depthTest:false,depthWrite:false,toneMapped:false,uniforms:{eye:{value:origin},cube:{value:result.target.texture},radius:{value:radius},texel:{value:1/result.resolution},detailBounds:{value:bounds||new T.Vector4(1,1,-1,-1)},blend:{value:blend},coarseHeight:{value:coarseField.heights},coarseRange:{value:coarseField.ranges},coarseGrid:{value:coarseField.grid},coarseInfo:{value:coarseField.info},fineHeight:{value:fineField.heights},fineRange:{value:fineField.ranges},fineGrid:{value:fineField.grid},fineInfo:{value:fineField.info},fineOn:{value:detail?1:0}},defines:coarse?{COARSE:1}:{DETAIL:1},vertexShader:`uniform vec3 eye;uniform float blend;varying vec3 delta;varying vec2 groundXZ;
 #ifdef DETAIL
 attribute float terrainPrevious;
 #endif
 void main(){vec3 p=position;
 #ifdef DETAIL
 p.y=mix(terrainPrevious,p.y,blend);
 #endif
 vec4 w=modelMatrix*vec4(p,1.);delta=w.xyz-eye;groundXZ=w.xz;gl_Position=projectionMatrix*viewMatrix*w;}`,fragmentShader:`${objectTest}\n${sightCoverageGLSL}\n${terrainTraceGLSL}\nuniform vec3 eye;uniform sampler2D coarseHeight,coarseRange,fineHeight,fineRange;uniform vec4 coarseGrid,coarseInfo,fineGrid,fineInfo;uniform float fineOn;\nuniform samplerCube cube;uniform float radius,texel;uniform vec4 detailBounds;varying vec3 delta;varying vec2 groundXZ;
 void main(){
 #ifdef COARSE
 if(groundXZ.x>detailBounds.x&&groundXZ.y>detailBounds.y&&groundXZ.x<detailBounds.z&&groundXZ.y<detailBounds.w)discard;
 #endif
 float len=length(delta);if(len>radius)discard;
 float blocked=0.;if(fineOn>.5){vec2 span=clipGrid(eye.xz,delta.xz,detailBounds.xy,detailBounds.zw);if(span.x<span.y){blocked=terrainBlocked(coarseHeight,coarseRange,coarseGrid,coarseInfo,eye,delta,vec2(0.,span.x));if(blocked<.5)blocked=terrainBlocked(fineHeight,fineRange,fineGrid,fineInfo,eye,delta,span);if(blocked<.5)blocked=terrainBlocked(coarseHeight,coarseRange,coarseGrid,coarseInfo,eye,delta,vec2(span.y,1.));}else blocked=terrainBlocked(coarseHeight,coarseRange,coarseGrid,coarseInfo,eye,delta,vec2(0.,1.));}else blocked=terrainBlocked(coarseHeight,coarseRange,coarseGrid,coarseInfo,eye,delta,vec2(0.,1.));
 if(blocked>.5){gl_FragColor=vec4(0.,0.,0.,1.);return;}float coverage=sightCoverage(cube,delta,texel);float gate=sightTest(cube,delta/max(len,.001),delta/max(len,.001),len);float edge=1.-smoothstep(radius-max(2.,len*texel*2.),radius,len);gl_FragColor=vec4(coverage*edge,gate,0.,1.);}`});cache.set(coarse,material);}material.uniforms.eye.value=origin;material.uniforms.cube.value=result.target.texture;material.uniforms.radius.value=radius;material.uniforms.texel.value=1/result.resolution;material.uniforms.detailBounds.value=bounds||new T.Vector4(1,1,-1,-1);material.uniforms.blend.value=blend;for(const [prefix,f]of [['coarse',coarseField],['fine',fineField]]){material.uniforms[prefix+'Height'].value=f.heights;material.uniforms[prefix+'Range'].value=f.ranges;material.uniforms[prefix+'Grid'].value=f.grid;material.uniforms[prefix+'Info'].value=f.info;}material.uniforms.fineOn.value=detail?1:0;const mesh=new T.Mesh(source.geometry,material);source.updateMatrixWorld(true);mesh.matrix.copy(source.matrixWorld);mesh.matrixAutoUpdate=false;mesh.frustumCulled=false;root.add(mesh);};
 add(ground,true);add(detail,false);
 const camera=new T.OrthographicCamera(-width/2,width/2,height/2,-height/2,.1,300000);camera.position.set((x0+x1)/2,100000,(z0+z1)/2);camera.up.set(0,0,-1);camera.lookAt((x0+x1)/2,0,(z0+z1)/2);
 const color=renderer.getClearColor(new T.Color()),alpha=renderer.getClearAlpha(),old=renderer.getRenderTarget();
 try{renderer.setClearColor(0,0);renderer.setRenderTarget(target);renderer.clear();renderer.render(root,camera);}catch(e){target.dispose();throw e;}finally{renderer.setRenderTarget(old);renderer.setClearColor(color,alpha);}
 return {...result,pooled:false,target,maskBounds,maskResolution:size};
}

// A close mask gives sub-metre edges around the observer without making the
// entire multi-kilometre mask 4x larger. Both masks use the same full-detail rays.
export function projectVisibility(renderer,result,options){
 const full=bakeVisibility(renderer,result,options);let near;
 try{near=bakeVisibility(renderer,result,{...options,size:1536,maskRadius:Math.min(result.radius,384)});}
 catch(e){full.target.dispose();throw e;}finally{if(!result.pooled)result.target.dispose();}
 return {...full,nearTarget:near.target,nearBounds:near.maskBounds};
}
