export function cachedRequest(cache,key,load){
 if(!cache.has(key)){
  const request=Promise.resolve().then(load).catch(error=>{if(cache.get(key)===request)cache.delete(key);throw error;});
  cache.set(key,request);
 }
 return cache.get(key);
}
export async function mapLimited(values,limit,fn){
 const results=new Array(values.length);let next=0,error;
 await Promise.all(Array.from({length:Math.min(limit,values.length)},async()=>{
  while(next<values.length&&!error){const i=next++;try{results[i]=await fn(values[i],i);}catch(e){error=e;}}
 }));
 if(error){for(const item of results)item?.dispose?.();throw error;}
 return results;
}
export function createLimiter(limit){
 let active=0;const waiting=[];
 const start=()=>{while(active<limit&&waiting.length){const {load,resolve,reject}=waiting.shift();active++;Promise.resolve().then(load).then(resolve,reject).finally(()=>{active--;start();});}};
 return load=>new Promise((resolve,reject)=>{waiting.push({load,resolve,reject});start();});
}
