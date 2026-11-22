import {AFK_SECONDS} from './stationary.js';
import {t} from './i18n.js';
export const ISOLATION_DELAY=60,OWN_SQUAD_DISTANCE=2000,ALLY_DISTANCE=500,IDLE_HIDE_SECONDS=AFK_SECONDS;
const alive=p=>p&&p[4]!==0&&Number.isFinite(p[1])&&Number.isFinite(p[2])&&p[1]>=0&&p[2]>=0;
const distance2=(a,b)=>(a[1]-b[1])**2+(a[2]-b[2])**2;
const drone=e=>/uav|drone|бпла/i.test(`${e.category||''} ${e.className||''}`);
const airborne=e=>/heli|plane|air/i.test(e.category||'')||drone(e);
// Full mission membership and positions, independent of camera and label filters.
export function isolatedInfantry(entities,positions){
 const units=entities.filter(e=>e.type==='unit'&&!drone(e)&&e.side&&e.group&&alive(positions.get(e.id)));
 const seats=new Map();
 for(const e of entities){const p=positions.get(e.id);if(e.type!=='vehicle'||!alive(p)||!Array.isArray(p[5]))continue;
  for(const id of p[5]){const unit=positions.get(id);if(!unit?.[5])continue;const previous=seats.get(id);if(!previous||distance2(unit,p)<distance2(unit,previous.position))seats.set(id,{position:p,air:airborne(e),vehicleId:e.id});}
 }
 const result=new Set();
 for(const e of units){
  const state=positions.get(e.id);if(state[4]!==1)continue;
  const p=seats.get(e.id)?.position||state;
  let own=Infinity,other=Infinity,ownCount=0;
  for(const peer of units){if(peer.id===e.id||peer.side!==e.side)continue;
   const ownGroup=peer.group===e.group;if(ownGroup)ownCount++;
   // Own squad always counts, including passengers. Other airborne squads do not
   // interrupt ground isolation unless travelling in the candidate's own vehicle.
   const seat=seats.get(peer.id);if(!ownGroup&&seat?.air&&seat.vehicleId!==seats.get(e.id)?.vehicleId)continue;
   const q=seat?.position||positions.get(peer.id),d=distance2(p,q);
   if(ownGroup)own=Math.min(own,d);else other=Math.min(other,d);
  }
  if(ownCount&&own>OWN_SQUAD_DISTANCE**2&&other>ALLY_DISTANCE**2)result.add(e.id);
 }
 return result;
}
export class IsolationIntervals{
 constructor(delay){this.delay=delay;this.open=new Map();this.intervals={};}
 step(frame,ids){
  for(const [id,start]of this.open)if(!ids.has(id)){
   if((frame-start)*this.delay>ISOLATION_DELAY)(this.intervals[id]??=[]).push([start,frame]);
   this.open.delete(id);
  }
  for(const id of ids)if(!this.open.has(id))this.open.set(id,frame);
 }
 finish(frame){this.step(frame,new Set());return this.intervals;}
}
export function isolationSeconds(intervals,frame,delay,position,idleSeconds=null){
 if(!alive(position)||position[4]!==1||idleSeconds>=IDLE_HIDE_SECONDS||!intervals?.length)return null;
 let lo=0,hi=intervals.length-1;
 while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(intervals[mid][0]<=frame)lo=mid;else hi=mid-1;}
 const [start,end]=intervals[lo],seconds=(frame-start)*delay;
 return frame>=start&&frame<end&&seconds>ISOLATION_DELAY?Math.floor(seconds):null;
}
export function isolationCaption(seconds,locale){return `${t('Away from squad for:',locale)} ${Math.floor(seconds/60)} ${t('min',locale)} ${seconds%60} ${t('sec',locale)}`;}
