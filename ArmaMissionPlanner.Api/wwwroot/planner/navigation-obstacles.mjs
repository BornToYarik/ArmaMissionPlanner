// Shared by point-to-point routes and reachability. Grid nodes alone miss thin
// walls: test each connecting edge against the actual projected model bounds.
const directions=[[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
const cross=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
export function footprint(points){
 const sorted=points.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]).filter((p,i,a)=>!i||p[0]!==a[i-1][0]||p[1]!==a[i-1][1]);
 if(sorted.length<3)return [];
 const half=items=>{const out=[];for(const p of items){while(out.length>1&&cross(out.at(-2),out.at(-1),p)<=0)out.pop();out.push(p);}return out.slice(0,-1);};
 return [...half(sorted),...half(sorted.slice().reverse())];
}
export function segmentHits(polygon,a,b){
 let low=0,high=1;
 for(let i=0;i<polygon.length;i++){const p=polygon[i],q=polygon[(i+1)%polygon.length],start=cross(p,q,a),delta=cross(p,q,b)-start;
  if(Math.abs(delta)<1e-9){if(start< -1e-7)return false;continue;}
  const t=(-1e-7-start)/delta;if(delta>0)low=Math.max(low,t);else high=Math.min(high,t);if(low>high)return false;
 }return true;
}
export function addObstacle(g,polygon){
 if(polygon.length<3)return;
 g.polygons??=[];g.obstacleBins??=new Map();g.edgeMasks??=new Uint8Array(g.nx*g.ny);
 const id=g.polygons.length;g.polygons.push(polygon);
 const lo=[Math.min(...polygon.map(p=>p[0])),Math.min(...polygon.map(p=>p[1]))],hi=[Math.max(...polygon.map(p=>p[0])),Math.max(...polygon.map(p=>p[1]))];
 for(let y=Math.floor(lo[1]/128);y<=Math.floor(hi[1]/128);y++)for(let x=Math.floor(lo[0]/128);x<=Math.floor(hi[0]/128);x++){const key=x+':'+y;if(!g.obstacleBins.has(key))g.obstacleBins.set(key,[]);g.obstacleBins.get(key).push(id);}
 for(let y=Math.max(0,Math.floor((lo[1]-g.y)/g.step)-1);y<=Math.min(g.ny-1,Math.ceil((hi[1]-g.y)/g.step)+1);y++)for(let x=Math.max(0,Math.floor((lo[0]-g.x)/g.step)-1);x<=Math.min(g.nx-1,Math.ceil((hi[0]-g.x)/g.step)+1);x++){
  const k=y*g.nx+x,a=[g.x+x*g.step,g.y+y*g.step];if(segmentHits(polygon,a,a))g.blocked[k]=1;
  for(let d=0;d<8;d++){const [dx,dy]=directions[d],xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=g.nx||yy>=g.ny)continue;
   if(segmentHits(polygon,a,[a[0]+dx*g.step,a[1]+dy*g.step]))g.edgeMasks[k]|=1<<d;
  }
 }
}
export function segmentClear(g,a,b){
 if(!g.obstacleBins)return true;
 const seen=new Set();for(let y=Math.floor(Math.min(a[1],b[1])/128);y<=Math.floor(Math.max(a[1],b[1])/128);y++)for(let x=Math.floor(Math.min(a[0],b[0])/128);x<=Math.floor(Math.max(a[0],b[0])/128);x++){
  for(const id of g.obstacleBins.get(x+':'+y)||[]){if(seen.has(id))continue;seen.add(id);if(segmentHits(g.polygons[id],a,b))return false;}
 }return true;
}
// Connect the exact recorded start to a nearby free node without crossing a
// wall. Never clear an occupied cell or teleport the start out of a courtyard.
export function navigationNode(g,p,air=false,water=false,maxSlope=Infinity){
 const x=Math.round((p[0]-g.x)/g.step),y=Math.round((p[1]-g.y)/g.step);let best=-1,distance=Infinity;
 for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=g.nx||yy>=g.ny)continue;const i=yy*g.nx+xx,h=g.heights[i],q=[g.x+xx*g.step,g.y+yy*g.step,h];
  if(!Number.isFinite(h)||!air&&(g.blocked[i]||(water?h>0:h<0)||!segmentClear(g,p,q)))continue;
  const d=Math.hypot(p[0]-q[0],p[1]-q[1]);if(!air&&!water&&d>.001&&Math.abs(h-p[2])/d>maxSlope)continue;if(d<distance){best=i;distance=d;}
 }return best;
}
