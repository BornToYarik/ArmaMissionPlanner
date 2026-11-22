// Temporary materials are released after transitions; shared assets stay intact.
export class MeshReveal{
 constructor(duration=550){this.duration=duration;this.active=new Map();this.pool=new WeakMap();}
 acquire(material){
  const list=this.pool.get(material),copy=list?.pop()||material.clone();copy.onBeforeCompile=material.onBeforeCompile;copy.customProgramCacheKey=material.customProgramCacheKey;copy.transparent=true;copy.depthWrite=false;copy.opacity=material.opacity;copy.alphaTest=material.alphaTest;if(!material.transparent)copy.forceSinglePass=true;return copy;
 }
 recycle(source,copy){let list=this.pool.get(source);if(!list){list=[];this.pool.set(source,list);}if(list.length<8)list.push(copy);else copy.dispose();}
 add(mesh,now=performance.now()){this.transition(mesh,1,null,now);}
 hide(mesh,done,now=performance.now()){this.transition(mesh,0,done,now);}
 transition(mesh,target,done,now){
  let state=this.active.get(mesh);
  if(state?.target===target){if(done)state.done=done;return;}
  if(!mesh.material||!mesh.parent){done?.();return;}
  if(state)this.apply(state,now);
  else{
   const original=mesh.material,source=Array.isArray(original)?original:[original],materials=source.map(m=>this.acquire(m));
   state={original,source,materials,cutouts:source.map(m=>m.alphaTest),opacities:source.map(m=>m.opacity),amount:target===1?0:1};
   mesh.material=Array.isArray(original)?materials:materials[0];this.active.set(mesh,state);
  }
  state.from=state.amount;state.target=target;state.start=now;state.done=done;state.duration=Math.max(1,this.duration*Math.abs(target-state.from));this.apply(state,now);
 }
 apply(state,now){
  const fraction=Math.max(0,Math.min(1,(now-state.start)/state.duration)),ease=fraction*fraction*(3-2*fraction);
  state.amount=state.from+(state.target-state.from)*ease;
  for(const [i,material]of state.materials.entries()){material.opacity=state.opacities[i]*state.amount;material.alphaTest=state.cutouts[i]*Math.max(.000001,state.amount);}
  return fraction===1;
 }
 release(mesh){const state=this.active.get(mesh);if(!state)return;mesh.material=state.original;for(let i=0;i<state.materials.length;i++)this.recycle(state.source[i],state.materials[i]);this.active.delete(mesh);}
 tick(now){let ready=0;for(const [mesh,state]of this.active){if(this.apply(state,now)||!mesh.parent){this.release(mesh);state.done?.();if(state.target===1&&mesh.parent&&mesh.visible)ready++;}}return ready;}
}
