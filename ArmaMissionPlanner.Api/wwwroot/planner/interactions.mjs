// Shared state for mouse previews and committed measurements.
export class RulerGesture {
  constructor(){this.reset();}
  reset(){this.start=null;this.end=null;}
  move(point){return this.end?[this.start,this.end]:[this.start||point,this.start?point:null];}
  click(point){
    if(this.end)this.reset();
    if(!this.start)this.start=[...point];else this.end=[...point];
    return [this.start,this.end];
  }
}

export function labelSelection(target,units){
  const node=target.closest?.('[data-member-ids],[data-member-id],[data-unitid]');
  if(!node)return [];
  const ids=(node.dataset.memberIds??node.dataset.memberId??node.dataset.unitid).split(',');
  return units.filter(u=>ids.includes(String(u.id))).map(u=>u.id);
}

export function selectIds(current,ids,additive=false){
  const result=new Set(additive?current:[]);
  const remove=additive&&ids.length>0&&ids.every(id=>result.has(id));
  for(const id of ids)if(remove)result.delete(id);else result.add(id);
  return result;
}
