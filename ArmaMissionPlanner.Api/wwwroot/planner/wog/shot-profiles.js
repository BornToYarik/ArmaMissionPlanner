// Only unanimous compatible simulations select a visual family. This is not
// a claim about the loaded magazine, calibre or exact recorded ammunition.
export function shotEffectProfile(options,status){
 if(status!=='recorded'||!options.length)return null;
 const kinds=new Set(options.map(o=>String(o.ammo?.simulation||'').toLowerCase()));
 if(kinds.size!==1)return null;
 const kind=[...kinds][0];
 if(kind==='shotbullet')return 'bullet';
 if(kind==='shotshell')return 'shell';
 if(kind==='shotrocket'||kind==='shotmissile')return 'rocket';
 return null;
}
export function shotEffectAge(now,born,profile){
 const age=(now-born)/1000;if(age<0||!profile)return null;
 const flashDuration=profile==='bullet'?.065:.12,smokeDuration=profile==='bullet'?0:1.2;
 return {age,flash:Math.max(0,1-age/flashDuration),smoke:smokeDuration?Math.max(0,1-age/smokeDuration):0};
}
// A small visual plume, not a measurement of exhaust lifetime or guidance.
// Fixed mission-time samples make pause/seek independent of render cadence.
export function rocketSmokeTrail(age,duration){
 if(!(duration>0)||age<0||age>duration+.6)return [];
 const samples=[];
 for(let i=0;i<6;i++){const time=age-i*.1;if(time<0||time>duration)continue;const fade=1-i/6;samples.push({time,alpha:fade*.16,size:.35+i*.12});}
 return samples;
}
