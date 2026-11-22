// Lossless transport formats. Public callers still receive the original bytes.
const scales=[100,100,100,1e6,1e6,1e6,1e6,1e6,1e6,1e6,1e6,1e6,1000];
const bytes=input=>input instanceof ArrayBuffer?new Uint8Array(input):new Uint8Array(input.buffer,input.byteOffset,input.byteLength);
function magic(b,name){return b.length>=4&&name.split('').every((c,i)=>b[i]===c.charCodeAt(0));}
export function unpackPlacements(input){
 const b=bytes(input);if(!magic(b,'WOGP'))return b;
 if(b.length<12)throw Error('Truncated placements header');
 const v=new DataView(b.buffer,b.byteOffset,b.byteLength),n=v.getUint32(4,true),exceptions=v.getUint32(8,true);
 if(b.length!==12+n*54+exceptions*8||exceptions>n*13)throw Error('Invalid packed placements length');
 const out=new Uint8Array(4+n*54),d=new DataView(out.buffer);d.setUint32(0,n,true);
 for(let lane=0;lane<54;lane++)for(let row=0;row<n;row++)out[4+row*54+lane]=b[12+lane*n+row];
 for(let row=0;row<n;row++)for(let col=0;col<13;col++){
  const offset=6+row*54+col*4,value=d.getInt32(offset,true);
  d.setFloat32(offset,value===-2147483648?-0:value/scales[col],true);
 }
 for(let i=0,offset=12+n*54;i<exceptions;i++,offset+=8){
  const index=v.getUint32(offset,true);if(index>=n*13)throw Error('Invalid placement exception');
  d.setUint32(6+Math.floor(index/13)*54+(index%13)*4,v.getUint32(offset+4,true),true);
 }
 return out;
}
export function unpackHeights(input){
 const b=bytes(input);if(!magic(b,'WOGH'))return b;
 if(b.length<12)throw Error('Truncated heights header');
 const v=new DataView(b.buffer,b.byteOffset,b.byteLength),n=v.getUint32(4,true),mode=v.getUint32(8,true);
 if(b.length!==12+n*4||(mode!==1&&mode!==2))throw Error('Invalid packed heights length');
 const out=new Uint8Array(n*4),d=new DataView(out.buffer);
 let previous=0;
 for(let i=0;i<n;i++){
  let value=(b[12+i]|b[12+n+i]<<8|b[12+n*2+i]<<16|b[12+n*3+i]<<24)>>>0;
  if(mode===1)value=(value+previous)>>>0;
  d.setUint32(i*4,value,true);previous=value;
 }
 return out;
}
