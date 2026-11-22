import * as THREE from './vendor/three.module.js';
import {marginGrids} from './map-extent.js';
import {waterSurface} from './water-surface.js';
import {terrainGridHit} from './terrain-ray.js';
import {terrainMaterial,sceneryMaterial} from './scene-lighting.js';
import {nativeMarginHeight} from './terrain-margin-data.js';

export class TerrainMargin{
 constructor(scene,terrain,sample,satellite,detail,exposure,native=null){
  this.native=native;this.size=terrain.worldSize;this.coarse=sample;
  this.rays=[];const positions=[],uvs=[],indices=[],water=[],size=terrain.worldSize,half=size/2;
  for(const grid of marginGrids(terrain,(x,y)=>native?this.height(x,y):sample(x,y))){
   const {columns:n,rows,bounds:b,heights}=grid,vertices=new Float32Array(n*rows*3),base=positions.length/3;
   for(let r=0;r<rows;r++)for(let c=0;c<n;c++){
    const x=b[0]+(b[2]-b[0])*c/(n-1),y=b[1]+(b[3]-b[1])*r/(rows-1),i=r*n+c;
    vertices.set([x-half,heights[i],half-y],i*3);uvs.push(x/size,y/size);
   }
   for(const v of vertices)positions.push(v);
   for(let r=0;r<rows-1;r++)for(let c=0;c<n-1;c++){const i=base+r*n+c;indices.push(i,i+1,i+n,i+1,i+n+1,i+n);}
   const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(vertices,3));geometry.userData={columns:n,rows};this.rays.push({geometry});
   for(const v of waterSurface(grid))water.push(v);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();
  this.satellite=satellite;this.detailWeight={value:0};const material=terrainMaterial({map:satellite,color:0xffffff});this.material=material;
  material.customProgramCacheKey=()=> 'continued-map-margin-v4';
  material.onBeforeCompile=shader=>{
   shader.uniforms.marginTextureSize={value:satellite.image?.width||4096};shader.uniforms.marginDetail={value:detail};shader.uniforms.marginDetailWeight=this.detailWeight;shader.uniforms.marginSize={value:size};shader.uniforms.marginExposure={value:exposure};
   shader.fragmentShader='uniform sampler2D marginDetail;\nuniform float marginSize,marginExposure,marginDetailWeight,marginTextureSize;\n'+shader.fragmentShader;
   // Continue each boundary texel outward without reversing the image.
   // Fine ground detail keeps its original world-space direction and scale.
   shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
    #ifdef USE_MAP
    vec2 worldUv=vMapUv;
    vec2 outside=max(max(-worldUv,worldUv-1.),vec2(0.))*marginSize;
    vec2 adjacentUv=clamp(worldUv,0.,1.);
    float outsideDistance=max(outside.x,outside.y);
    float fade=smoothstep(0.,80.,outsideDistance);
    // Gradually average the bordering ground to avoid extruding roads and
    // single texels into kilometre-long stripes. The exact seam is unchanged.
    float screenFootprint=max(length(dFdx(worldUv)),length(dFdy(worldUv)))*marginTextureSize;
    float footprint=max(screenFootprint,outsideDistance*.5*marginTextureSize/marginSize);
    vec3 edge=textureLod(map,adjacentUv,log2(max(1.,footprint))).rgb;
    diffuseColor.rgb*=vec3(1.)-pow(max(vec3(0.),vec3(1.)-edge),vec3(marginExposure));
    vec3 detailSample=texture2D(marginDetail,worldUv*marginSize/8.).rgb;
    diffuseColor.rgb*=mix(vec3(1.),clamp(detailSample*2.,vec3(.65),vec3(1.35)),marginDetailWeight);
    vec3 groundVariation=texture2D(marginDetail,worldUv*marginSize/64.).rgb;
    diffuseColor.rgb*=mix(vec3(1.),clamp(groundVariation*2.,vec3(.8),vec3(1.2)),fade*.45);
    diffuseColor.rgb*=mix(1.,.82,fade);
    #else
    diffuseColor.rgb*=.82;
    #endif`);
  };
  this.mesh=new THREE.Mesh(geometry,material);this.mesh.name='Engine-sampled 1 km map margin';scene.add(this.mesh);
  if(water.length){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(water,3));geometry.computeVertexNormals();const material=sceneryMaterial({color:new THREE.Color(0x547d8c).multiplyScalar(.82),side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2});this.water=new THREE.Mesh(geometry,material);this.water.name='Sea in map margin';scene.add(this.water);}
 }
 texture(enabled){this.material.map=enabled?this.satellite:null;this.material.color.set(enabled?0xffffff:0xb4a98a);this.material.needsUpdate=true;}
 height(x,y){
  if(!this.native)return null;
  const actual=nativeMarginHeight(this.native,x,y);if(actual===null)return null;
  // Only seal the first 50 m against the viewer's coarse boundary. Beyond that
  // every elevation comes from the engine export, not an extended edge sample.
  const s=this.size,d=Math.max(-x,x-s,-y,y-s,0),u=Math.min(1,d/50);
  return this.coarse(x,y)*(1-u)+actual*u;
 }
 hit(ray){let nearest=null;for(const grid of this.rays){const hit=terrainGridHit(ray,grid);if(hit&&(!nearest||hit.distance<nearest.distance))nearest=hit;}return nearest;}
}
