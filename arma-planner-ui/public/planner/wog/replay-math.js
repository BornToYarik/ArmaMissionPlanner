export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
// OCAP's surface-relative height can be zero on an upstairs floor.
// Absolute altitude (track slot 6) preserves floors, ladders and rooftops.
export function infantryElevation(position,ground){
 const absolute=position?.[6];
 // Slot 9 is native WRP ground sampled offline, not OCAP private data.
 if(Number.isFinite(absolute)&&Number.isFinite(position?.[9]))return ground+Math.max(0,absolute-position[9]);
 return Math.max(ground,Number.isFinite(absolute)?absolute:ground+Math.max(0,position?.[7]||0));
}
export function terrainHeight(t,x,north){
 const n=t.resolution,gx=clamp(x/t.worldSize*(n-1),0,n-1),gy=clamp(north/t.worldSize*(n-1),0,n-1),ix=Math.min(n-2,Math.floor(gx)),iy=Math.min(n-2,Math.floor(gy)),u=gx-ix,v=gy-iy;
 const a=t.heights[iy*n+ix],b=t.heights[iy*n+ix+1],c=t.heights[(iy+1)*n+ix],d=t.heights[(iy+1)*n+ix+1];
 return u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v);
}
const normalize=v=>{const l=Math.hypot(...v);return v.map(x=>x/l);};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export function surfacePose(height,x,north,heading,width,length,center=[0,0]){
 const radius=Math.max(.5,Math.min(width,length)/2),dx=(height(x+radius,north)-height(x-radius,north))/(2*radius),dz=(height(x,north-radius)-height(x,north+radius))/(2*radius);
 const up=normalize([-dx,1,-dz]),a=heading*Math.PI/180,f=[Math.sin(a),0,-Math.cos(a)],dot=f.reduce((s,v,i)=>s+v*up[i],0),forward=normalize(f.map((v,i)=>v-dot*up[i]));
 const right=normalize(cross(forward,up)),back=forward.map(v=>-v);let y=-Infinity;
 for(const sx of [-.5,0,.5])for(const sz of [-.5,0,.5]){const local=right.map((v,i)=>v*(sx*width+center[0])+back[i]*(sz*length+center[1]));y=Math.max(y,height(x+local[0],north-local[2])-local[1]);}
 return {right,up,back,y:y+.08};
}
export function interpolateTrack(track,f){
 if(!track?.length||f<track[0][0])return null;let lo=0,hi=track.length-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(track[mid][0]<=f)lo=mid;else hi=mid-1;}const a=track[lo],b=track[lo+1];
 if(!b||a[4]===0||(a[4]!==b[4]&&b[0]-a[0]>1)||b[0]-a[0]>6||Math.hypot(b[1]-a[1],b[2]-a[2])>300)return a;
 const t=(f-a[0])/(b[0]-a[0]);return [f,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t,a[3]+(((b[3]-a[3]+540)%360)-180)*t,a[4],a[5],a[6]+(b[6]-a[6])*t,a[7]+(b[7]-a[7])*t,a[8]??null,Number.isFinite(a[9])&&Number.isFinite(b[9])?a[9]+(b[9]-a[9])*t:null];
}

// Parachutes are vehicles in OCAP, but must never use ground-vehicle placement.
export function isParachute(entity){
 return entity?.type!=='unit'&&/parachute|paraglid/i.test((entity?.category||'')+' '+(entity?.className||''));
}

export function aircraftHeight(entity,position,height,worldSize){
 if((!isParachute(entity)&&!/heli|plane|air|uav|drone/i.test(entity?.category||''))||!position)return null;
 const inside=position[1]>=0&&position[2]>=0&&position[1]<=worldSize&&position[2]<=worldSize;
 const value=inside&&Number.isFinite(position[6])?position[6]-height(position[1],position[2]):position[7];
 return Number.isFinite(value)?Math.max(0,Math.round(value)):null;
}
