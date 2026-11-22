import * as T from 'three';
// Tint the terrain itself. No floating polygon can cut into a hill or flicker
// against the ground, and the existing terrain LOD/morph is used unchanged.
export class ZoneTint {
  constructor(half){
    this.half=half;this.zones=[];
    this.uniforms={plannerZoneCount:{value:0},plannerZoneBounds:{value:Array.from({length:128},()=>new T.Vector4())},plannerZoneShape:{value:Array.from({length:128},()=>new T.Vector3())},plannerZoneColor:{value:Array.from({length:128},()=>new T.Vector4())}};
  }
  set(zones){
    if(zones.length>128)throw Error('На 3D-карте поддерживается до 128 областей одновременно');
    this.zones=zones;this.uniforms.plannerZoneCount.value=zones.length;
    zones.forEach((z,i)=>{
      const angle=(z.angle||0)*Math.PI/180,color=new T.Color(z.color||'#efd37e');
      this.uniforms.plannerZoneBounds.value[i].set(z.x,z.y,z.a,z.b);
      this.uniforms.plannerZoneShape.value[i].set(Math.cos(angle),Math.sin(angle),z.ellipse?1:0);
      this.uniforms.plannerZoneColor.value[i].set(color.r,color.g,color.b,z.fill===false?0:.07);
    });
  }
  attach(shader){
    Object.assign(shader.uniforms,this.uniforms);
    shader.fragmentShader=`uniform int plannerZoneCount;
      uniform vec4 plannerZoneBounds[128];uniform vec3 plannerZoneShape[128];uniform vec4 plannerZoneColor[128];
      `+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
      vec2 plannerXY=vec2(terrainWorld.x+${this.half.toFixed(3)},${this.half.toFixed(3)}-terrainWorld.y);
      for(int i=0;i<128;i++){
        if(i>=plannerZoneCount)break;
        vec4 bounds=plannerZoneBounds[i];vec3 shape=plannerZoneShape[i];vec2 delta=plannerXY-bounds.xy;
        vec2 local=vec2(delta.x*shape.x-delta.y*shape.y,delta.x*shape.y+delta.y*shape.x)/max(bounds.zw,vec2(.01));
        bool inside=shape.z>.5?dot(local,local)<=1.:max(abs(local.x),abs(local.y))<=1.;
        if(inside)diffuseColor.rgb=mix(diffuseColor.rgb,plannerZoneColor[i].rgb,plannerZoneColor[i].a);
      }`);
  }
}
