import * as T from 'three';
export const viewPalettes=[['#39dba3','#e46789'],['#55bcff','#d99739'],['#c492ff','#a1ad42'],['#72e1dc','#e28d69'],['#e5c35d','#a889b4']];
export function viewPalette(index){return viewPalettes[index]||[0,.45].map(offset=>'#'+new T.Color().setHSL((index*.61803398875+offset)%1,.6,.6).getHexString());}
// A data texture is sampled by the very same terrain shader, including LOD
// transitions. Never place a second, intersecting polygon above the terrain.
export class ViewshedSurface{
 constructor(half){this.half=half;this.layers=new Map();this.uniforms={};for(let i=0;i<4;i++){this.uniforms['viewMap'+i]={value:new T.DataTexture(new Uint8Array(4),1,1)};this.uniforms['viewBox'+i]={value:new T.Vector4()};this.uniforms['viewOn'+i]={value:0};}}
 set(id,result,palette){this.remove(id);const data=new Uint8Array(result.n*result.n*4);
  for(let i=0;i<result.values.length;i++){const v=result.values[i];if(v<0)continue;const c=new T.Color(v===2?'#96a0ac':palette[v===1?0:1]);data.set([c.r*255,c.g*255,c.b*255,70],i*4);}
  const texture=new T.DataTexture(data,result.n,result.n);texture.minFilter=texture.magFilter=T.NearestFilter;texture.needsUpdate=true;
  this.layers.set(id,{texture,box:new T.Vector4(result.x,result.y,result.radius,result.n),enabled:true});this.sync();
 }
 toggle(id,on){const layer=this.layers.get(id);if(layer)layer.enabled=on;this.sync();}
 remove(id){this.layers.get(id)?.texture.dispose();this.layers.delete(id);this.sync();}
 sync(){const layers=[...this.layers.values()].filter(l=>l.enabled).slice(-4);for(let i=0;i<4;i++){const l=layers[i];this.uniforms['viewOn'+i].value=l?1:0;if(l){this.uniforms['viewMap'+i].value=l.texture;this.uniforms['viewBox'+i].value=l.box;}}}
 attach(shader){Object.assign(shader.uniforms,this.uniforms);let declarations='',body='';for(let i=0;i<4;i++){
   declarations+=`uniform sampler2D viewMap${i};uniform vec4 viewBox${i};uniform float viewOn${i};\n`;
   body+=`if(viewOn${i}>.5){vec2 delta=(vec2(terrainWorld.x+${this.half.toFixed(3)},${this.half.toFixed(3)}-terrainWorld.y)-viewBox${i}.xy)/viewBox${i}.z;if(all(lessThanEqual(abs(delta),vec2(1.)))){vec2 uv=.5+sign(delta)*sqrt(abs(delta))*.5*(viewBox${i}.w-1.)/viewBox${i}.w;vec4 tint=texture2D(viewMap${i},uv);diffuseColor.rgb=mix(diffuseColor.rgb,tint.rgb,tint.a);}}\n`;
  }shader.fragmentShader=declarations+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>','#include <alphatest_fragment>\n'+body);
 }
}
