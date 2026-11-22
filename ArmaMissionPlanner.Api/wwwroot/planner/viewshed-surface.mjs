import * as T from './wog/vendor/three.module.js';
export const viewPalettes=[['#39dba3','#e46789'],['#55bcff','#d99739'],['#c492ff','#a1ad42'],['#72e1dc','#e28d69'],['#e5c35d','#a889b4']];
export function viewPalette(index){return viewPalettes[index]||[0,.45].map(offset=>'#'+new T.Color().setHSL((index*.61803398875+offset)%1,.6,.6).getHexString());}
export {sightTestGLSL} from './visibility-sampling.mjs';
// A data texture is sampled by the very same terrain shader, including LOD
// transitions. Never place a second, intersecting polygon above the terrain.
export class ViewshedSurface{
 constructor(half){this.half=half;this.layers=new Map();this.uniforms={};this.empty=new T.Texture();for(let i=0;i<4;i++){this.uniforms['viewMap'+i]={value:this.empty};this.uniforms['viewNearMap'+i]={value:this.empty};this.uniforms['viewNearBounds'+i]={value:new T.Vector4()};this.uniforms['viewBounds'+i]={value:new T.Vector4()};this.uniforms['viewColor'+i]={value:new T.Color()};this.uniforms['viewOn'+i]={value:0};}}
 set(id,result,palette){this.remove(id);this.layers.set(id,{...result,color:new T.Color(palette[0]),enabled:true});this.sync();}
 toggle(id,on){if(!on){this.remove(id);return;}const layer=this.layers.get(id);if(layer)layer.enabled=true;this.sync();}
 presentation(on){this.presentationHidden=!on;this.sync();}
 suspend(on){this.suspended=on;this.sync();}
 remove(id){this.layers.get(id)?.target.dispose();this.layers.get(id)?.nearTarget?.dispose();this.layers.delete(id);this.sync();}
 sync(){const layers=[...this.layers.values()].filter(l=>l.enabled&&!l.fullyUnknown).slice(-4);for(let i=0;i<4;i++){const l=layers[i];this.uniforms['viewOn'+i].value=l&&!this.suspended&&!this.presentationHidden?1:0;this.uniforms['viewMap'+i].value=l?.target.texture||this.empty;this.uniforms['viewNearMap'+i].value=l?.nearTarget?.texture||l?.target.texture||this.empty;if(l){this.uniforms['viewBounds'+i].value.copy(l.maskBounds);this.uniforms['viewNearBounds'+i].value.copy(l.nearBounds||l.maskBounds);this.uniforms['viewColor'+i].value=l.color;}}}
 attach(shader){Object.assign(shader.uniforms,this.uniforms);
  shader.vertexShader='varying vec3 sightWorld;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nsightWorld=(modelMatrix*vec4(transformed,1.)).xyz;');
  let declarations='varying vec3 sightWorld;\n',body='';for(let i=0;i<4;i++){
   declarations+=`uniform sampler2D viewMap${i},viewNearMap${i};uniform vec4 viewBounds${i},viewNearBounds${i};uniform vec3 viewColor${i};uniform float viewOn${i};\n`;
   body+=`if(viewOn${i}>.5){vec2 uv=vec2(sightWorld.x-viewBounds${i}.x,viewBounds${i}.y-sightWorld.z)/viewBounds${i}.zw;if(all(greaterThanEqual(uv,vec2(0.)))&&all(lessThanEqual(uv,vec2(1.)))){vec2 mask=texture2D(viewMap${i},uv).rg;vec2 nuv=vec2(sightWorld.x-viewNearBounds${i}.x,viewNearBounds${i}.y-sightWorld.z)/viewNearBounds${i}.zw;if(all(greaterThanEqual(nuv,vec2(0.)))&&all(lessThanEqual(nuv,vec2(1.)))){float rim=min(min(nuv.x,nuv.y),min(1.-nuv.x,1.-nuv.y));mask=mix(mask,texture2D(viewNearMap${i},nuv).rg,smoothstep(0.,.025,rim));}float coverage=mask.r*smoothstep(.55,.95,mask.g);diffuseColor.rgb=mix(diffuseColor.rgb,viewColor${i},.30*coverage);}}\n`;
  }shader.fragmentShader=declarations+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>','#include <alphatest_fragment>\n'+body);
 }
}
