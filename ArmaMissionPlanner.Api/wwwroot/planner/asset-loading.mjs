// Share successful requests, but never retain a rejected model/texture promise.
export {cachedRequest} from './wog/resource-cache.js';
export async function retryAsset(load,{attempts=3,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 for(let attempt=0;;attempt++)try{return await load();}catch(error){
  const status=Number(error.status)||0;
  if(attempt+1>=attempts||status>=400&&status<500&&status!==408&&status!==429)throw error;
  await wait(200*2**attempt);
 }
}
export async function assetJson(url,fetcher=fetch){
 return retryAsset(async()=>{const r=await fetcher(url,{signal:AbortSignal.timeout(60000)});
  if(!r.ok){const error=Error(`${url}: ${r.status}`);error.status=r.status;throw error;}return r.json();});
}
