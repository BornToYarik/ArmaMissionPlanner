(()=>{
 const token=__TOKEN__,site=__SITE__,control=__CONTROL__,origin=new URL(site).origin;
 const frame=document.createElement('iframe');frame.src=site+'local-assets.html';frame.hidden=true;
 let ready=false,busy=false;
 const pending=new Map(),headers={'X-WOG-Local':token};
 const nativeFetch=window.fetch.bind(window);
 window.fetch=async(input,options)=>{
  try{return await nativeFetch(input,options);}catch(e){
   const url=new URL(typeof input==='string'?input:input.url,location.href);
   // A queued local resource may take longer than the online viewer's 20 s limit.
   // Explicit user cancellation stays cancellation; only timeout is retried.
   if(e.name!=='TimeoutError'||url.origin!==location.origin||!/^\/(models|maps|terrain|environment|vendor|icons|markers|fonts|roads)\//.test(url.pathname))throw e;
   return nativeFetch(input,{...options,signal:AbortSignal.timeout(300000)});
  }
 };
 const notice=document.createElement('div');notice.style.cssText='position:fixed;bottom:6px;left:8px;z-index:99999;background:#18252ee8;color:#eee;padding:5px 9px;font:12px Arial;display:none';
 // Start before module top-level await; DOMContentLoaded waits for the map itself.
 document.documentElement.append(frame,notice);
 addEventListener('message',async e=>{
  if(e.source!==frame.contentWindow||e.origin!==origin)return;
  if(e.data?.type==='ready'){
   if(!ready){ready=true;await fetch(control+'/__local/reset',{method:'POST',headers}).catch(()=>{});}
   return;
  }
  if(e.data?.type!=='asset'||!pending.has(e.data.id))return;
  const id=e.data.id;pending.delete(id);
  try{await fetch(control+'/__local/result/'+id,{method:'POST',headers:{...headers,'X-Asset-Status':String(e.data.status)},body:e.data.buffer});}catch{}
 });
 setInterval(async()=>{
  frame.contentWindow?.postMessage({type:'hello'},origin);
  if(busy)return;busy=true;
  try{
   const r=await fetch(control+'/__local/jobs?ready='+(ready?1:0),{headers});if(!r.ok)return;
   const state=await r.json();
   notice.style.display=state.waiting||state.failed?'block':'none';
   notice.textContent=state.failed?'Не все ресурсы загружены. Проверьте соединение и обновите страницу.':ready?'Загрузка ресурсов: '+state.done+' • осталось '+state.waiting:'Подключение к ресурсам сайта…';
   if(ready)for(const job of state.jobs){pending.set(job.id,Date.now());frame.contentWindow.postMessage({type:'asset',...job},origin);}
  }catch{}finally{busy=false;}
  for(const [id,time] of pending)if(Date.now()-time>150000)pending.delete(id);
 },350);
})();
