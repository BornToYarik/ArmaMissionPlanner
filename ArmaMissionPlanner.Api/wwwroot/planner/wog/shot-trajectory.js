// These OCAP records contain XY endpoints, not a sampled projectile path.
// Curvature and animation timing are illustrative; ammunition remains unknown.
import {indirectWeapons,indirectVehicles,launcherAmmunition,directMountedWeapons} from './indirect-fire-catalog.js';
// S-60 is exported as static-mortar in some recordings. Its installed weapon
// configs have direct-fire modes, not mortar charges; the coarse category must
// not manufacture an indirect arc. Includes static and MTLB-mounted variants.
const s60Family=/(?:^|[^a-zа-я0-9])[sс][\s_-]?60(?=$|[^a-zа-я0-9])/i;
export function surfaceShotPoint(x,north,height,half){
 return [x-half,height(x,north),half-north];
}
export function artilleryKind(entity,shot=null){
 if(/heli|plane|aircraft/i.test(entity?.category||''))return null;
 const ammo=String(shot?.ammo||'').toLowerCase();
 if(launcherAmmunition[ammo])return launcherAmmunition[ammo];
 const weapon=String(shot?.weapon||'').toLowerCase();
 // A machine gun mounted on a howitzer must retain its direct-fire trace.
 if(shot?.effect==='bullet'||directMountedWeapons.has(weapon)||s60Family.test(weapon))return null;
 if(indirectWeapons[weapon])return indirectWeapons[weapon];
 if(entity?.type!=='vehicle')return null;
 const known=indirectVehicles[String(entity.className||'').toLowerCase()];if(known)return known;
 if(s60Family.test([entity.className,entity.name].join(' ')))return null;
 const text=[entity.category,entity.className,entity.name].join(' ').toLowerCase();
 if(/mortar|podnos|2b14|2b25|mrs120|мином/.test(text))return 'mortar';
 if(/artillery|howitzer|akatsiya|(?:^|[_\s])2s[139](?:_|\b)|(?:^|[_\s])(?:m142|m270|m119|m777|m109d?|d[-_ ]?20|d[-_ ]?30)(?:_|\b)|гаубиц|артиллер|mlrs|himars|smerch|rm[-_ ]?70|bm[-_ ]?21|(?:^|[_\s])grad(?:p|_|\b)|рсзо|смерч|ураган|град/.test(text))return 'artillery';
 return null;
}
export function trajectoryRise(from,to,kind,{surfaceAnchored=false}={}){
 const range=Math.hypot(to.x-from.x,to.z-from.z);
 // Unknown ammunition cannot support a solved trajectory. This small display
 // arc is explicitly schematic, not a recovered velocity or launch angle.
 // It is independent of terrain: never lift it to manufacture hill clearance.
 if(!kind)return surfaceAnchored?range*.015:0;
 // A conservative schematic GL arc, not a solved or recorded launch angle.
 // Short-range fire stays shallow; never raise an arc to clear a detected hill.
 const grenadeRise=Math.max(0,range*.12*.75);
 if(kind==='grenade')return grenadeRise;
 // Unguided AT launchers use a shallower illustrative path. Do not apply a
 // grenade lob to guided missiles or claim to recover unrecorded motor phases.
 if(kind==='launcher')return grenadeRise*.6;
 return Math.max(15,range*(kind==='mortar'?.65:.3),Math.abs(to.y-from.y)*.4);
}
export function trajectoryPoint(from,to,rise,t){
 t=Math.max(0,Math.min(1,t));
 return [from.x+(to.x-from.x)*t,from.y+(to.y-from.y)*t+4*rise*t*(1-t),from.z+(to.z-from.z)*t];
}
// Stop at the first terrain contact: an illustrative OCAP line must not emerge
// from the far side of a hill. Work is done once per shot, never every render.
export function terrainTrajectoryLimit(from,to,rise,height,step=2){
 const clearance=t=>{const [x,y,z]=trajectoryPoint(from,to,rise,t),ground=height(x,z);return Number.isFinite(ground)?y-ground:Infinity;};
 if(clearance(0)<0)return 0;
 const count=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.z-from.z)/step));
 let previous=0;
 for(let i=1;i<=count;i++){
  const current=i/count;
  if(clearance(current)<=0){let lo=previous,hi=current;for(let n=0;n<24;n++){const mid=(lo+hi)/2;if(clearance(mid)>0)lo=mid;else hi=mid;}return lo;}
  previous=current;
 }
 return 1;
}
