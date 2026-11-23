import test from 'node:test';
import assert from 'node:assert/strict';
import {cachedRequest,retryAsset,assetJson} from '../arma-planner-ui/public/planner/asset-loading.mjs';

test('simultaneous users share a model request; a rejected request can recover',async()=>{
 const cache=new Map();let calls=0;const broken=()=>{calls++;throw Error('connection reset');};
 const a=cachedRequest(cache,'model',broken),b=cachedRequest(cache,'model',broken);assert.equal(a,b);
 await assert.rejects(a,/connection reset/);assert.equal(calls,1);assert.equal(cache.has('model'),false);
 const model={triangles:[1,2,3]};assert.equal(await cachedRequest(cache,'model',()=>model),model);
 assert.equal(await cachedRequest(cache,'model',()=>{throw Error('duplicate');}),model);
});

test('transient texture errors retry in bounded order; missing assets do not loop',async()=>{
 const waits=[];let n=0;assert.equal(await retryAsset(()=>{if(++n<3)throw Error('network');return 'loaded';},{wait:ms=>waits.push(ms)}),'loaded');
 assert.deepEqual(waits,[200,400]);n=0;
 await assert.rejects(retryAsset(()=>{n++;throw Object.assign(Error('missing'),{status:404});},{wait:()=>{throw Error('unexpected wait');}}),/missing/);assert.equal(n,1);
 n=0;await assert.rejects(retryAsset(()=>{n++;throw Error('offline');},{wait:()=>{}}),/offline/);assert.equal(n,3);
});

test('JSON retries a failed backend response and preserves the successful geometry',async()=>{
 let n=0;const geometry={positions:[0,1,2],indices:[0]};
 const result=await assetJson('/model.json',async()=>++n===1?{ok:false,status:503}:{ok:true,json:async()=>geometry});
 assert.equal(result,geometry);assert.equal(n,2);
});
