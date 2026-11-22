export function taskProgress(keys,notify){
 const pending=new Set(keys),done=new Set();
 const emit=()=>notify({done:done.size,total:pending.size,percent:pending.size?Math.floor(done.size*100/pending.size):100});
 emit();return key=>{if(pending.has(key)&&!done.has(key)){done.add(key);emit();}};
}

// A tile with some visible meshes is still incomplete while its job is active.
export function environmentProgress(wanted,buildings,nature,active,failed){
 let done=0,errors=0;
 for(const id of wanted||[]){
  const store=id.startsWith('b:')?buildings:nature;
  if(store?.has(id.slice(2))&&!active?.has(id)&&!failed?.has(id))done++;
  else if(failed?.has(id))errors++;
 }
 const total=wanted?.size||0;
 return {done,total,errors,percent:total?Math.floor(done*100/total):100};
}
