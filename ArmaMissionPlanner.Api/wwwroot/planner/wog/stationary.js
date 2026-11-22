import {t} from './i18n.js';
export const STATIONARY_SECONDS=600,STATIONARY_RADIUS=2,AFK_SECONDS=2700;
const eligible=p=>p&&p[4]===1&&!p[5]&&Number.isFinite(p[1])&&Number.isFinite(p[2])&&p[1]>=0&&p[2]>=0;
// Fixed anchors prevent a slowly moving soldier from accumulating stationary time.
export function stationaryIntervals(track,delay){
 const result=[];let start=null,last=null;
 const finish=()=>{if(start&&last&&(last[0]-start[0])*delay>STATIONARY_SECONDS)result.push([start[0],last[0],start[1],start[2]]);};
 for(const p of track){
  if(last&&p[0]<=last[0])continue;
  if(!eligible(p)){finish();start=last=null;continue;}
  if(!start||p[0]-last[0]>6||Math.hypot(p[1]-start[1],p[2]-start[2])>STATIONARY_RADIUS){finish();start=p;}
  last=p;
 }
 finish();return result;
}
export function stationaryElapsed(intervals,frame,delay,position){
 if(!eligible(position)||!intervals?.length)return null;
 let lo=0,hi=intervals.length-1;
 while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(intervals[mid][0]<=frame)lo=mid;else hi=mid-1;}
 const [start,end,x,y]=intervals[lo],seconds=(frame-start)*delay;
 return frame<=end&&seconds>STATIONARY_SECONDS&&Math.hypot(position[1]-x,position[2]-y)<=STATIONARY_RADIUS?Math.floor(seconds):null;
}
export function stationarySeconds(intervals,frame,delay,position){const seconds=stationaryElapsed(intervals,frame,delay,position);return seconds>=AFK_SECONDS?null:seconds;}
export function isAFK(intervals,frame,delay,position){return stationaryElapsed(intervals,frame,delay,position)>=AFK_SECONDS;}
export function stationaryCaption(seconds,locale){return `${t('Stationary for:',locale)} ${Math.floor(seconds/60)} ${t('min',locale)} ${seconds%60} ${t('sec',locale)}`;}
