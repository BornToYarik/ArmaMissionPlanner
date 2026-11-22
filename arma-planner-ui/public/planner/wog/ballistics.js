// Approximate point-mass reconstruction, not an implementation of the Arma engine.
// Coordinates: X/east, Y/north, Z/ASL; drag coefficient follows the config sign.
export const BALLISTICS_VERSION='point-mass-2-observation-windows';
const length=v=>Math.hypot(...v);
export function ballisticProfile(option){
 const a=option?.ammo;
 if(!a||!(option.speed>0)||!Number.isFinite(a.airfriction)||a.airfriction>0)return null;
 if(!/^(shotBullet|shotShell|shotGrenade)$/i.test(a.simulation))return null;
 return {speed:option.speed,drag:a.airfriction,gravity:9.80665*(a.coefgravity??1),ttl:a.timetolive>0?Math.min(180,a.timetolive):60,assumptions:a.coefgravity==null?['gravity-default']:[]};
}
function acceleration(v,p){const speed=length(v);return [p.drag*speed*v[0],p.drag*speed*v[1],p.drag*speed*v[2]-p.gravity];}
function step(state,dt,p){
 const v=state.slice(3),a=acceleration(v,p),mid=v.map((n,i)=>n+a[i]*dt*.5),am=acceleration(mid,p);
 return [...state.slice(0,3).map((n,i)=>n+mid[i]*dt),...v.map((n,i)=>n+am[i]*dt)];
}
export function integrateFlight(profile,{origin=[0,0,0],azimuth=0,elevation=0,duration=profile.ttl,interval=.05,initialVelocity=[0,0,0]}={}){
 if(!profile||!origin.every(Number.isFinite)||!initialVelocity.every(Number.isFinite)||!Number.isFinite(duration))return [];
 let state=[...origin,profile.speed*Math.cos(elevation)*Math.cos(azimuth)+initialVelocity[0],profile.speed*Math.cos(elevation)*Math.sin(azimuth)+initialVelocity[1],profile.speed*Math.sin(elevation)+initialVelocity[2]],time=0,next=0;
 const result=[[0,...origin,length(state.slice(3))]],end=Math.max(0,Math.min(duration,profile.ttl,180));
 while(time<end-1e-9){const dt=Math.min(.01,end-time,.08/Math.max(.001,Math.abs(profile.drag)*length(state.slice(3))));state=step(state,dt,profile);time+=dt;if(!state.every(Number.isFinite))return [];
  if(time>=next+interval-1e-9||time>=end-1e-9){result.push([time,...state.slice(0,3),length(state.slice(3))]);next=time;}
 }
 return result;
}
function atRange(profile,range,elevation){
 let state=[0,0,0,profile.speed*Math.cos(elevation),0,profile.speed*Math.sin(elevation)],time=0;
 while(time<profile.ttl){const dt=Math.min(.025,.1/Math.max(.001,Math.abs(profile.drag)*length(state.slice(3))));const prev=state;state=step(state,dt,profile);if(!state.every(Number.isFinite))return null;
  if(state[0]>=range){const f=(range-prev[0])/(state[0]-prev[0]);return {time:time+dt*f,height:prev[2]+(state[2]-prev[2])*f};}
  time+=dt;if(state[3]<.02)return null;
 }return null;
}
export function solveFlight(profile,from,to,{maxTime=180,highArc=false,timeWindow=null}={}){
 if(!profile||!from.every(Number.isFinite)||!to.every(Number.isFinite))return null;
 const dx=to[0]-from[0],dy=to[1]-from[1],range=Math.hypot(dx,dy),dz=to[2]-from[2];if(range<1)return null;
 const roots=[];let prev=null;
 for(let degrees=-45;degrees<=85;degrees+=5){const angle=degrees*Math.PI/180,r=atRange(profile,range,angle);if(!r){prev=null;continue;}const error=r.height-dz;
  if(prev&&error*prev.error<=0){let lo=prev.angle,hi=angle,elo=prev.error;for(let i=0;i<18;i++){const mid=(lo+hi)/2,q=atRange(profile,range,mid);if(!q)break;const e=q.height-dz;if(e*elo<=0)hi=mid;else{lo=mid;elo=e;}}
   const elevation=(lo+hi)/2,q=atRange(profile,range,elevation);if(q&&q.time<=maxTime&&(!timeWindow||q.time>=timeWindow[0]&&q.time<=timeWindow[1])&&!roots.some(r=>Math.abs(r.elevation-elevation)<1e-5))roots.push({elevation,time:q.time,error:q.height-dz});
  }prev={angle,error};
 }
 if(!roots.length)return null;const chosen=highArc?roots.at(-1):roots[0];
 const points=integrateFlight(profile,{origin:from,azimuth:Math.atan2(dy,dx),elevation:chosen.elevation,duration:chosen.time,interval:Math.max(.04,chosen.time/64)});
 return {...chosen,points,alternatives:roots.length,solutions:roots,kind:'calculated',assumptions:profile.assumptions};
}
// Numerical shooting with an explicitly supplied carrier velocity hypothesis.
// Never assumes that an unrecorded engine inheritance factor is known.
export function solveMovingFlight(profile,from,to,initialVelocity,options={}){
 if(!initialVelocity?.every(Number.isFinite))return null;
 if(length(initialVelocity)<1e-8)return solveFlight(profile,from,to,options);
 const seed=solveFlight(profile,from,to,{...options,timeWindow:null});if(!seed)return null;
 const roots=[];
 // The evaluator must use the hypothesis for both the solution and derivatives.
 const evaluate=q=>integrateFlight(profile,{origin:from,azimuth:q[0],elevation:q[1],duration:q[2],interval:180,initialVelocity}).at(-1)?.slice(1,4);
 for(const root of seed.solutions){let q=[Math.atan2(to[1]-from[1],to[0]-from[0]),root.elevation,root.time],valid=false;
  for(let i=0;i<12;i++){
   const end=evaluate(q);if(!end)break;const error=end.map((v,k)=>v-to[k]);if(length(error)<.02){valid=true;break;}
   const h=[1e-4,1e-4,Math.max(1e-4,q[2]*1e-4)],columns=h.map((d,k)=>{const v=q.slice();v[k]+=d;const e=evaluate(v);return e?.map((n,j)=>(n-end[j])/d);});if(columns.some(c=>!c))break;
   const a=error.map((v,row)=>[...columns.map(c=>c[row]),v]);let singular=false;
   for(let k=0;k<3;k++){let pivot=k;for(let j=k+1;j<3;j++)if(Math.abs(a[j][k])>Math.abs(a[pivot][k]))pivot=j;[a[k],a[pivot]]=[a[pivot],a[k]];const d=a[k][k];if(Math.abs(d)<1e-9){singular=true;break;}for(let j=k;j<4;j++)a[k][j]/=d;for(let r=0;r<3;r++)if(r!==k){const f=a[r][k];for(let j=k;j<4;j++)a[r][j]-=f*a[k][j];}}
   if(singular)break;const delta=a.map(r=>r[3]),scale=Math.min(1,.25/Math.max(Math.abs(delta[0]),Math.abs(delta[1]),1e-9),q[2]*.4/Math.max(Math.abs(delta[2]),1e-9));q=q.map((v,k)=>v-delta[k]*scale);
   if(q[2]<=0||q[2]>Math.min(profile.ttl,options.maxTime??180)||Math.abs(q[1])>Math.PI*.49)break;
  }
  if(valid&&(!options.timeWindow||q[2]>=options.timeWindow[0]&&q[2]<=options.timeWindow[1])&&!roots.some(r=>Math.abs(r.elevation-q[1])<1e-5))roots.push({azimuth:q[0],elevation:q[1],time:q[2],error:length(evaluate(q).map((v,k)=>v-to[k]))});
 }
 if(!roots.length)return null;roots.sort((a,b)=>a.elevation-b.elevation);const chosen=options.highArc?roots.at(-1):roots[0];
 return {...chosen,points:integrateFlight(profile,{origin:from,azimuth:chosen.azimuth,elevation:chosen.elevation,duration:chosen.time,interval:Math.max(.04,chosen.time/64),initialVelocity}),alternatives:roots.length,solutions:roots,kind:'calculated',assumptions:[...profile.assumptions,'carrier-velocity-hypothesis']};
}
export function flightTimeBounds(option,range,{carrierSpeed=0}={}){
 const a=option?.ammo;if(!(range>=0)||!(option.speed>0)||!a)return null;
 if(!Number.isFinite(carrierSpeed)||carrierSpeed<0)return null;
 const maxSpeed=Math.max(option.speed,a.maxspeed||0)+carrierSpeed,ttl=a.timetolive>0?a.timetolive:null;
 // No engine guidance history: use only a broad compatibility interval for missiles.
 if(/shotmissile|shotrocket/i.test(a.simulation))return ttl?[range/maxSpeed,ttl]:null;
 const p=ballisticProfile(option);if(!p)return null;
 // Horizontal quadratic drag: vx cannot exceed v0/(1+k*v0*t).
 // Ignoring vertical speed gives a LOWER bound, not a claimed arrival time.
 // High arcs remain possible until the real TTL; never cap at 1.5*flat time.
 const k=-p.drag,v0=option.speed+carrierSpeed,min=k>0?Math.expm1(k*range)/(k*v0):range/v0;
 return [min,ttl??Infinity];
}
export function sampleFlight(points,time){
 if(!points?.length)return null;if(time<=points[0][0])return points[0].slice(1,4);if(time>=points.at(-1)[0])return points.at(-1).slice(1,4);
 let lo=0,hi=points.length-1;while(lo+1<hi){const m=(lo+hi)>>1;if(points[m][0]<=time)lo=m;else hi=m;}
 const a=points[lo],b=points[hi],f=(time-a[0])/(b[0]-a[0]);return a.slice(1,4).map((v,i)=>v+(b[i+1]-v)*f);
}
