const attributes=new WeakMap(),styles=new WeakMap();
export function labelAttribute(node,key,value){
 let cache=attributes.get(node);if(!cache){cache=new Map();attributes.set(node,cache);}
 value=String(value);if(cache.get(key)===value)return;cache.set(key,value);node.setAttribute(key,value);
}
export function labelStyle(node,key,value){
 let cache=styles.get(node);if(!cache){cache=new Map();styles.set(node,cache);}
 value=String(value);if(cache.get(key)===value)return;cache.set(key,value);node.style.setProperty(key,value);
}
export function labelField(object,key,value){if(object[key]!==value)object[key]=value;}
// Camera motion changes compositing position, not the layout of every caption.
export function labelPosition(node,x,y){
 labelField(node.style,'left','0px');labelField(node.style,'top','0px');
 labelField(node.style,'transform',`translate3d(${x}px,${y}px,0) translate(-50%,-50%)`);
}
