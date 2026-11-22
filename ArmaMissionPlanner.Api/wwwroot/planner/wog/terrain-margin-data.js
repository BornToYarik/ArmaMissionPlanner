import {MAP_MARGIN,inMapExtent} from './map-extent.js';
export function validateMargin(data,world,size){
 if(data?.world!==world||data.worldSize!==size||data.margin!==MAP_MARGIN||data.grids?.length!==8||!/^[a-f0-9]{16}\.webp$/.test(data.groundTexture))throw Error('Invalid outside terrain metadata');
 const seen=new Set();let count=0;
 for(const g of data.grids){
  const b=g.bounds;if(!Array.isArray(b)||b.length!==4||!b.every(Number.isFinite)||!inMapExtent(b[0],b[1],size)||!inMapExtent(b[2],b[3],size)||b[2]<=b[0]||b[3]<=b[1])throw Error('Invalid outside terrain bounds');
  const band=(lo,hi)=>lo===-MAP_MARGIN&&hi===0?0:lo===0&&hi===size?1:lo===size&&hi===size+MAP_MARGIN?2:-1;
  const x=band(b[0],b[2]),y=band(b[1],b[3]),key=x+':'+y;
  if(x<0||y<0||x===1&&y===1||seen.has(key))throw Error('Invalid outside terrain coverage');seen.add(key);
  if(!Number.isInteger(g.columns)||!Number.isInteger(g.rows)||g.columns<2||g.rows<2||g.columns*g.rows!==g.heights?.length||!g.heights.every(Number.isFinite))throw Error('Invalid outside terrain heights');
  count+=g.heights.length;if(count>3000000)throw Error('Outside terrain too large');
 }
 return data;
}
export async function loadMargin(world,size){
 const response=await fetch(`terrain/margins/${world}.json.gz?v=engine-1`);if(!response.ok)throw Error('Outside terrain '+response.status);
 let bytes=await response.arrayBuffer();const signature=new Uint8Array(bytes);
 if(signature[0]===31&&signature[1]===139)bytes=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
 return validateMargin(JSON.parse(new TextDecoder().decode(bytes)),world,size);
}
export function nativeMarginHeight(data,x,y){
 for(const g of data.grids){
  const b=g.bounds;if(x<b[0]||x>b[2]||y<b[1]||y>b[3])continue;
  const gx=(x-b[0])/(b[2]-b[0])*(g.columns-1),gy=(y-b[1])/(b[3]-b[1])*(g.rows-1),c=Math.min(g.columns-2,Math.floor(gx)),r=Math.min(g.rows-2,Math.floor(gy)),u=gx-c,v=gy-r,k=r*g.columns+c,h=g.heights;
  const a=h[k],bb=h[k+1],cc=h[k+g.columns],d=h[k+g.columns+1];return u+v<=1?a+(bb-a)*u+(cc-a)*v:d+(cc-d)*(1-u)+(bb-d)*(1-v);
 }
 return null;
}
