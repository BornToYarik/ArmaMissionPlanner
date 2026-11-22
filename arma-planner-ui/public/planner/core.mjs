// All distances are metres, times seconds, map coordinates east/north/ASL.
// These are planning estimates, not Arma's vehicle simulation.
export const profiles = Object.freeze({
  foot: {name:'Пехота', road:3.2, offroad:2.8, uphill:4, downhill:2.5, slope:.75, accel:1.4, brake:2, lateral:1.6},
  wheeled: {name:'Колёсная техника', road:19, offroad:8, uphill:3, downhill:1.8, slope:.38, accel:1.2, brake:3, lateral:1.8},
  tracked: {name:'Гусеничная техника', road:12, offroad:8.5, uphill:2.5, downhill:1.6, slope:.5, accel:.9, brake:2, lateral:1.4},
  air: {name:'Воздушная техника', road:55, offroad:55, uphill:0, downhill:0, slope:Infinity, accel:2, brake:2, lateral:5},
  water: {name:'Водная техника', road:9, offroad:9, uphill:0, downhill:0, slope:Infinity, accel:.7, brake:.7, lateral:1},
  static: {name:'Неподвижный объект', road:0, offroad:0, uphill:0, downhill:0, slope:0, accel:1, brake:1, lateral:1}
});
export function configuredProfile(ref,kind){
  if(!profiles[kind])return {...profiles.static};const p={...profiles[kind]};
  const max=Number(ref?.maxSpeed)/3.6;
  if(kind!=='foot'&&kind!=='static'&&Number.isFinite(max)&&max>0){p.road=max;p.offroad=max*(kind==='wheeled'?.45:kind==='tracked'?.7:1);}
  // maxSpeed is a config limit, not a promise of physical attainable speed.
  // Surface penalties and handling remain documented estimates.
  return p;
}
const dirs = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
export const distance = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);
export const sqmPoint = p => [p[0],p[2],p[1]];
export function groupProfiles(units, all) {
  const byId = new Map(all.map(u=>[String(u.id),u]));
  const movers = new Map();
  for(const u of units) {const v=u.carrier!=null?byId.get(String(u.carrier)):u; if(!v)throw Error('Назначенная машина отсутствует');movers.set(String(v.id),v);}
  return [...movers.values()].map(u=>({...profiles[u.mobility||'foot'],...u.speedProfile}));
}
export function speed(grade, road, p) {
  if(!Number.isFinite(grade)||Math.abs(grade)>p.slope)return 0;
  // A modest downhill helps walking; steep descents require braking.
  const factor=grade>=0?Math.exp(-p.uphill*grade):p.name==='Пехота'?
    Math.min(1.12,Math.exp(-p.downhill*Math.max(0,-grade-.06))):Math.exp(-p.downhill*Math.max(0,-grade-.04));
  return (road?p.road:p.offroad)*factor;
}
export function travelTime(points, ps, roadAt=()=>false) {
  if(points.length<2)return 0;
  return Math.max(...ps.map(p=>{
    const ds=[], limits=points.map(()=>Infinity);
    for(let i=1;i<points.length;i++){
      const d=distance(points[i-1],points[i]);ds.push(Math.hypot(d,points[i][2]-points[i-1][2]));
      const v=speed(d? (points[i][2]-points[i-1][2])/d:Infinity,roadAt(points[i-1],points[i]),p);
      if(!v)return Infinity;
      limits[i-1]=Math.min(limits[i-1],v);limits[i]=Math.min(limits[i],v);
    }
    for(let i=1;i<points.length-1;i++){
      const a=points[i-1],b=points[i],c=points[i+1],d1=distance(a,b),d2=distance(b,c);
      const cos=Math.max(-1,Math.min(1,((b[0]-a[0])*(c[0]-b[0])+(b[1]-a[1])*(c[1]-b[1]))/(d1*d2||1)));
      const angle=Math.acos(cos);
      if(angle>.01){const radius=Math.min(d1,d2)/2/Math.max(.01,Math.tan(angle/2));limits[i]=Math.min(limits[i],Math.sqrt(p.lateral*Math.max(.1,radius)));}
    }
    limits[0]=0;limits[limits.length-1]=0;
    for(let i=1;i<limits.length;i++)limits[i]=Math.min(limits[i],Math.sqrt(limits[i-1]**2+2*p.accel*ds[i-1]));
    for(let i=limits.length-2;i>=0;i--)limits[i]=Math.min(limits[i],Math.sqrt(limits[i+1]**2+2*p.brake*ds[i]));
    let seconds=0;
    for(let i=0;i<ds.length;i++){
      // Segment cruise peak with asymmetric acceleration/deceleration.
      const d=ds[i],v0=limits[i],v1=limits[i+1],horizontal=distance(points[i],points[i+1]);
      const cap=speed((points[i+1][2]-points[i][2])/(horizontal||1),roadAt(points[i],points[i+1]),p);
      const peak=Math.min(cap,Math.sqrt((2*d+v0*v0/p.accel+v1*v1/p.brake)/(1/p.accel+1/p.brake)));
      const da=Math.max(0,(peak*peak-v0*v0)/(2*p.accel)),db=Math.max(0,(peak*peak-v1*v1)/(2*p.brake));
      seconds+=(peak-v0)/p.accel+(peak-v1)/p.brake+Math.max(0,d-da-db)/peak;
    }return seconds;
  }));
}
class Heap {
  a=[];
  push(v){const a=this.a;let i=a.length;a.push(v);while(i){const p=(i-1)>>1;if(a[p][0]<=v[0])break;a[i]=a[p];i=p;}a[i]=v;}
  pop(){const a=this.a,top=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let j=i*2+1;if(j+1<a.length&&a[j+1][0]<a[j][0])j++;if(a[j][0]>=last[0])break;a[i]=a[j];i=j;}a[i]=last;}return top;}
}
export function cell(g,p){const x=Math.round((p[0]-g.x)/g.step),y=Math.round((p[1]-g.y)/g.step);return x<0||y<0||x>=g.nx||y>=g.ny?-1:y*g.nx+x;}
export function point(g,i){return [g.x+(i%g.nx)*g.step,g.y+Math.floor(i/g.nx)*g.step,g.heights[i]];}
function edge(g,a,b,ps,oldDir,newDir){
  const air=ps.every(p=>p.name===profiles.air.name),water=ps.every(p=>p.name===profiles.water.name);
  if(!Number.isFinite(g.heights[b])||!air&&(g.blocked?.[b]||(water?g.heights[b]>0:g.heights[b]<0)))return Infinity;
  const len=(newDir%2?Math.SQRT2:1)*g.step,grade=(g.heights[b]-g.heights[a])/len;
  let seconds=0;
  for(const p of ps){const v=speed(air||water?0:grade,g.roads?.[a]&&g.roads?.[b],p);if(!v)return Infinity;
    const diff=oldDir<0?0:Math.min(Math.abs(oldDir-newDir),8-Math.abs(oldDir-newDir))*Math.PI/4;
    const corner=diff?Math.min(v,Math.sqrt(p.lateral*g.step/(2*Math.tan(diff/2)))):v;
    seconds=Math.max(seconds,Math.hypot(len,g.heights[b]-g.heights[a])/Math.max(.2,corner));
  }return seconds;
}
function neighbors(g,a,air=false,water=false){const x=a%g.nx,y=Math.floor(a/g.nx),r=[];for(let d=0;d<8;d++){const [dx,dy]=dirs[d],xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=g.nx||yy>=g.ny)continue;
  const wrongSurface=i=>water?g.heights[i]>0:g.heights[i]<0;
  if(!air&&dx&&dy&&(g.blocked?.[y*g.nx+xx]||g.blocked?.[yy*g.nx+x]||wrongSurface(y*g.nx+xx)||wrongSurface(yy*g.nx+x)))continue;r.push([yy*g.nx+xx,d]);}return r;}
export function route(g,from,to,ps,mode='free'){
  const start=cell(g,from),end=cell(g,to);if(start<0||end<0)throw Error('Точка вне подготовленной карты');
  if(g.blocked?.[start]||g.blocked?.[end])throw Error('Точка внутри препятствия');
  const roadMode=mode==='road';if(roadMode&&!g.roads?.some(Boolean))throw Error('Нет данных дорожной сети');
  const size=g.nx*g.ny*8,cost=new Float64Array(size).fill(Infinity),prev=new Int32Array(size).fill(-1),q=new Heap();
  const vmax=Math.min(...ps.map(p=>Math.max(p.road,p.offroad)*1.12));
  const h=i=>distance(point(g,i),point(g,end))/vmax;
  for(let d=0;d<8;d++){cost[start*8+d]=0;q.push([h(start),start*8+d,0]);}
  let found=-1;
  while(q.a.length){const [,s,paid]=q.pop();if(paid!==cost[s])continue;const a=s>>3,old=s%8;if(a===end){found=s;break;}
    for(const [b,d] of neighbors(g,a)){
      // Road alternative allows access from the endpoints; off-road traversals
      // are penalised, never labelled as a road-only or exact optimal route.
      const penalty=roadMode&&!(g.roads[a]&&g.roads[b])?4:1;
      const next=paid+edge(g,a,b,ps,a===start?-1:old,d)*penalty,k=b*8+d;
      if(next<cost[k]){cost[k]=next;prev[k]=s;q.push([next+h(b),k,next]);}
    }
  }
  if(found<0)throw Error('Проходимый маршрут не найден');
  const ids=[];for(let k=found;k>=0;k=prev[k])ids.push(k>>3);ids.reverse();
  let path=ids.map(i=>point(g,i));
  // Keep sampled slopes and obstacles. Do not smooth a path through buildings.
  if(path.length===1)path=[from,to];else {path[0]=from;path[path.length-1]=to;}
  path=straightenRoute(g,path,ps,roadMode);
  return {points:path,seconds:travelTime(sampleRouteHeights(g,path),ps,(a,b)=>g.roads?.[cell(g,a)]&&g.roads?.[cell(g,b)]),mode,resolution:g.step};
}
// Preserve a straight XY line while sampling the hills it actually crosses.
export function sampleRouteHeights(g,path){
 const out=[];
 const height=(x,y)=>{const fx=Math.max(0,Math.min(g.nx-1,(x-g.x)/g.step)),fy=Math.max(0,Math.min(g.ny-1,(y-g.y)/g.step)),ix=Math.floor(fx),iy=Math.floor(fy),jx=Math.min(ix+1,g.nx-1),jy=Math.min(iy+1,g.ny-1),a=fx-ix,b=fy-iy;return (g.heights[iy*g.nx+ix]*(1-a)+g.heights[iy*g.nx+jx]*a)*(1-b)+(g.heights[jy*g.nx+ix]*(1-a)+g.heights[jy*g.nx+jx]*a)*b;};
 for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i],n=Math.max(1,Math.ceil(distance(a,b)/(g.step/2)));for(let j=0;j<n;j++){const t=j/n,x=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t;out.push([x,y,j?height(x,y):a[2]]);}}
 if(path.length)out.push(path.at(-1));return out;
}
export function straightenRoute(g,path,ps,roadMode=false){
 if(path.length<3)return path;
 const sample=(a,b)=>{const n=Math.max(1,Math.ceil(distance(a,b)/(g.step/3))),out=[];let last=-1;
  for(let i=0;i<=n;i++){const f=i/n,x=a[0]+(b[0]-a[0])*f,y=a[1]+(b[1]-a[1])*f,k=cell(g,[x,y]);
   if(k<0||g.blocked[k]||!Number.isFinite(g.heights[k])||g.heights[k]<0)return null;
   if(last>=0&&k!==last){const ax=last%g.nx,ay=Math.floor(last/g.nx),bx=k%g.nx,by=Math.floor(k/g.nx);if(ax!==bx&&ay!==by&&(g.blocked[ay*g.nx+bx]||g.blocked[by*g.nx+ax]))return null;}
   out.push([x,y,i===0?a[2]:i===n?b[2]:g.heights[k]]);last=k;
  }return out;};
 const weighted=points=>{let cost=0;for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],d=distance(a,b);if(!d)continue;const road=g.roads?.[cell(g,a)]&&g.roads?.[cell(g,b)];const v=Math.min(...ps.map(p=>speed((b[2]-a[2])/d,road,p)));if(!v)return Infinity;cost+=d/v*(roadMode&&!road?4:1);}return cost;};
 const out=[path[0]];let at=0;
 while(at<path.length-1){let next=at+1;for(let j=Math.min(path.length-1,at+40);j>at+1;j--){const samples=sample(path[at],path[j]);if(samples&&weighted(samples)<=weighted(path.slice(at,j+1))*1.04){next=j;break;}}out.push(path[next]);at=next;}
 return out;
}
export function reachable(g,starts,seconds){
  // Separate profile searches preserve the originating unit's mobility. A
  // vehicle must not magically inherit another starting unit's position.
  const out=new Float32Array(g.nx*g.ny).fill(Infinity),groups=new Map();
  for(const s of starts){const key=JSON.stringify(s.profile);if(!groups.has(key))groups.set(key,{profile:s.profile,origins:[]});groups.get(key).origins.push(s.point);}
  for(const {profile,origins} of groups.values()){const ps=[profile],cost=new Float32Array(out.length*8).fill(Infinity),q=new Heap();
    for(const p of origins){const i=cell(g,p);if(i<0)continue;for(let d=0;d<8;d++){cost[i*8+d]=0;q.push([0,i*8+d]);}}
    while(q.a.length){const [t,s]=q.pop();if(t>cost[s]+.001||t>seconds)continue;const a=s>>3;out[a]=Math.min(out[a],t);
      for(const [b,d] of neighbors(g,a,profile.name===profiles.air.name,profile.name===profiles.water.name)){const v=t+edge(g,a,b,ps,s%8,d),k=b*8+d;if(v<=seconds&&v<cost[k]){cost[k]=v;q.push([cost[k],k]);}}
    }
  }return out; // An upper envelope: no stop at each cell and no traffic.
}
export function terrainVisible(from,to,height,step=5){
  const d=distance(from,to),n=Math.max(1,Math.ceil(d/step));
  for(let i=1;i<n;i++){const t=i/n,h=height(from[0]+(to[0]-from[0])*t,from[1]+(to[1]-from[1])*t);if(!Number.isFinite(h))return null;if(h>from[2]+(to[2]-from[2])*t)return false;}return true;
}
export function embark(passengers,vehicle,all,capacity){
  if(vehicle.mobility==='foot')throw Error('Выберите технику');
  const ids=new Set(passengers.map(p=>p.id)),occupied=all.filter(p=>p.carrier===vehicle.id&&!ids.has(p.id)).length;
  if(!Number.isInteger(capacity)||capacity<1)throw Error('Укажите подтверждённую вместимость машины');
  if(occupied+passengers.length>capacity)throw Error('В машине недостаточно мест');
  for(const p of passengers){if(p.mobility!=='foot')throw Error('Перетаскивайте только пехоту');p.carrier=vehicle.id;p.point=[...vehicle.point];}
}
