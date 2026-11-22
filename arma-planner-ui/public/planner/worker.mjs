import {route,reachable} from './core.mjs';
let grid;
self.onmessage=({data:m})=>{try{if(m.type==='grid'){grid=m.grid;postMessage({id:m.id,ok:true});return;}
  const result=m.type==='route'?route(grid,m.from,m.to,m.profiles,m.mode):reachable(grid,m.starts,m.seconds);
  postMessage({id:m.id,result});}catch(e){postMessage({id:m.id,error:e.message});}};
