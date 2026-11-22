export async function decodeBrotli(bytes){
 let stream;try{stream=new DecompressionStream('brotli');}catch{}
 if(stream)return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
 const {decompress}=await import('./vendor/brotli-decoder.js');return decompress(new Uint8Array(bytes));
}

export function packedAssetUrl(url){return url;}
