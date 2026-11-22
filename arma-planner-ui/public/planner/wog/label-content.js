// Dynamic timers/altitudes must not grow the text measurement cache indefinitely.
export class TextMeasurements{
 constructor(measure,limit=2048){this.measure=measure;this.limit=limit;this.values=new Map();}
 get(text){
  if(this.values.has(text))return this.values.get(text);
  const width=Math.ceil(this.measure(text));
  if(this.values.size>=this.limit)this.values.delete(this.values.keys().next().value);
  this.values.set(text,width);return width;
 }
}
// Keep the existing text and timer nodes while their content is unchanged.
export function memberName(el,name){
 const signature='member:'+name;
 if(el.dataset.signature===signature)return;
 el.textContent=name;el.dataset.signature=signature;
}
export function stationaryNote(el,text){statusNote(el,text,'stationary-note');}
export function statusNote(el,text,className){
 let note=el.querySelector('.'+className);
 if(!note){note=document.createElement('small');note.className=className;el.append(note);}
 if(note.textContent!==text)note.textContent=text;
}
