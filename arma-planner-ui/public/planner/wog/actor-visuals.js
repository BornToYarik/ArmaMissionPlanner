// Contact, support, toe-off, recovery. Visual reference: Quaternius Jog_Fwd/Sprint.
// The source soldier's knee is at y=.54, not at the former shin pivot y=.42.
export const GAIT_KEYS={walkHip:[.40,-.04,-.38,.32],runHip:[.78,.08,-.55,.67],walkKnee:[.15,.12,.48,.92],runKnee:[.58,.42,1.08,1.65]};
const glslKeys=v=>'vec4('+v.map(n=>n.toFixed(4)).join(',')+')';
export const RUN_GLSL=`
attribute vec2 actorMotion;
attribute float actorDirection;
attribute vec3 actorFireAim;
attribute vec3 actorRestPosition;
attribute vec3 actorRestNormal;
attribute vec3 actorAimPosition;
attribute vec3 actorSuspendedPosition;
attribute vec3 actorAimNormal;
// Standing and walking share the shouldered pose; only running lowers the rifle.
float aimWeight(float amount){return max(1.0-smoothstep(.6,.95,amount),actorFireAim.z);}
float poseCurve(float phase,vec4 keys){
 float t=fract(phase/6.2831853)*4.0,f=fract(t);f=f*f*(3.0-2.0*f);
 if(t<1.0)return mix(keys.x,keys.y,f);if(t<2.0)return mix(keys.y,keys.z,f);
 if(t<3.0)return mix(keys.z,keys.w,f);return mix(keys.w,keys.x,f);
}
vec2 legAngles(float phase,float amount){
 float r=smoothstep(.6,.95,amount),s=smoothstep(0.0,.45,amount);
 return vec2(cos(actorDirection)*mix(poseCurve(phase,${glslKeys(GAIT_KEYS.walkHip)}),poseCurve(phase,${glslKeys(GAIT_KEYS.runHip)}),r),
 mix(poseCurve(phase,${glslKeys(GAIT_KEYS.walkKnee)}),poseCurve(phase,${glslKeys(GAIT_KEYS.runKnee)}),r))*s;
}
vec3 rotateX(vec3 p,float a){float c=cos(a),s=sin(a);return vec3(p.x,c*p.y-s*p.z,s*p.y+c*p.z);}
vec3 fireRotate(vec3 p){
 p=rotateX(p,actorFireAim.y);float c=cos(actorFireAim.x),s=sin(actorFireAim.x);
 return vec3(c*p.x+s*p.z,p.y,-s*p.x+c*p.z);
}
vec3 legVertex(vec3 p,vec2 a){
 vec3 hip=vec3(0.0,.88,.025),knee=vec3(0.0,.54,.045);
 // Positive hip lifts the thigh forward (-Z); negative knee folds the heel backward (+Z).
 vec3 shin=knee+rotateX(p-knee,-a.y);
 vec3 leg=mix(shin,p,smoothstep(.44,.62,p.y));
 vec3 moved=hip+rotateX(leg-hip,a.x);
 moved.x+=sin(actorDirection)*sin(actorMotion.x)*.18*smoothstep(0.0,.45,actorMotion.y)*(1.0-smoothstep(.3,.95,p.y));
 return moved;
}
float bodyLift(float phase,float amount){
 vec3 ankle=vec3(0.0,.11,.06);
 float y=min(legVertex(ankle,legAngles(phase,amount)).y,legVertex(ankle,legAngles(phase+3.14159265,amount)).y);
 float r=smoothstep(.6,.95,amount),s=smoothstep(0.0,.45,amount);
 return (.11-y)+r*s*.035*(1.0-cos(phase*2.0));
}
vec3 runVertex(vec3 p){
 float phase=actorMotion.x,amount=actorMotion.y;
 if(amount<-2.5)return actorSuspendedPosition;
 if(amount<0.0){
  vec3 rest=actorRestPosition;
  // Small schematic breathing motion for unconscious units; dead bodies stay still.
  if(amount<-1.5&&p.y>1.0&&p.y<1.45&&abs(p.x)<0.21)rest.z-=0.003*(1.0+sin(phase/4.5));
  return rest;
 }
 p=mix(p,actorAimPosition,aimWeight(amount));
 float side=p.x<0.0?-1.0:1.0;
 float legPhase=phase+(side<0.0?3.14159265:0.0);
 float running=smoothstep(0.6,0.95,amount),strength=smoothstep(0.0,0.45,amount);
 vec3 upper=vec3(0.0,.88,.025)+rotateX(p-vec3(0.0,.88,.025),-mix(.035,.20,running)*strength*(1.0-actorFireAim.z));
 upper.x+=sin(phase)*.009*strength;
 upper=vec3(0.0,.98,.025)+fireRotate(upper-vec3(0.0,.98,.025));
 p=mix(legVertex(p,legAngles(legPhase,amount)),upper,smoothstep(.78,.98,p.y));
 p.y+=bodyLift(phase,amount);return p;
}
vec3 runNormal(vec3 n,vec3 p){
 if(actorMotion.y<-2.5)return n;
 if(actorMotion.y<0.0)return actorRestNormal;
 n=mix(n,actorAimNormal,aimWeight(actorMotion.y));p=mix(p,actorAimPosition,aimWeight(actorMotion.y));
 float amount=actorMotion.y,side=p.x<0.0?-1.0:1.0,legPhase=actorMotion.x+(side<0.0?3.14159265:0.0);
 float running=smoothstep(0.6,0.95,amount),strength=smoothstep(0.0,0.45,amount);
 vec2 a=legAngles(legPhase,amount);
 vec3 leg=rotateX(mix(rotateX(n,-a.y),n,smoothstep(.44,.62,p.y)),a.x);
 vec3 upper=rotateX(n,-mix(.035,.20,running)*strength*(1.0-actorFireAim.z));
 upper=fireRotate(upper);
 return normalize(mix(leg,upper,smoothstep(.78,.98,p.y)));
}`;
export function visualState(type,state,sideColor){return {prone:type==='unit'&&(state===0||state===2),color:state===0?0x101215:type==='unit'&&state===2?0xa747ed:sideColor,smoke:type==='vehicle'&&state===0};}
export function gait(speed,state,inVehicle){return state===1&&!inVehicle&&speed>0.35?Math.min(1,speed/3):0;}
export function tintMaterial(material,animated){
 material.onBeforeCompile=shader=>{
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#ifdef USE_MAP
   vec4 texel=texture2D(map,vMapUv);
   float detail=clamp(dot(texel.rgb,vec3(0.2126,0.7152,0.0722))*1.65+0.22,0.22,1.0);
   diffuseColor.rgb*=detail;diffuseColor.a*=texel.a;
  #endif`);
  if(animated){shader.vertexShader=RUN_GLSL+'\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>','vec3 objectNormal=runNormal(normal,position);');shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','vec3 transformed=runVertex(position);');}
 };
 material.customProgramCacheKey=()=>animated?'faction-suspended-gait-v19':'faction-v6';
}
