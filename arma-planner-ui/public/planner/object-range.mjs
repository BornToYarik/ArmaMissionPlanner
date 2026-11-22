export const observerObjectRange={value:0};
export function clipObserverObjects(material){
 const previous=material.onBeforeCompile,cache=material.customProgramCacheKey.bind(material);
 material.onBeforeCompile=function(shader,...args){previous.call(this,shader,...args);shader.uniforms.observerObjectRange=observerObjectRange;
  shader.vertexShader='varying vec3 observerWorld;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
    vec4 observerVertex=vec4(transformed,1.);
    #ifdef USE_INSTANCING
    observerVertex=instanceMatrix*observerVertex;
    #endif
    observerWorld=(modelMatrix*observerVertex).xyz;`);
  shader.fragmentShader='uniform float observerObjectRange;varying vec3 observerWorld;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif(observerObjectRange>0.&&distance(observerWorld,cameraPosition)>observerObjectRange)discard;');
 };material.customProgramCacheKey=()=>cache()+'|observer-range';return material;
}
