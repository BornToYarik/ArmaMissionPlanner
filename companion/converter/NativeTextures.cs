using System;
using System.IO;
using System.Linq;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Globalization;
using System.Text.RegularExpressions;
using System.Collections.Generic;

public static class NativeTextures {
 static Dictionary<string,object> cache=new();
 public static object Material(string name,string directory,int maxSize) {
  var key=directory+"|"+maxSize+"|"+name.ToLowerInvariant();
  if(cache.TryGetValue(key,out var known))return known;
  object result;
  try {
   var color=Regex.Match(name,@"color\(([^)]+)\)",RegexOptions.IgnoreCase);
   if(color.Success){var rgb=color.Groups[1].Value.Split(',').Take(3).Select(x=>double.Parse(x,CultureInfo.InvariantCulture)).ToArray();return new{texture=(string)null,color=rgb,alphaTest=0,doubleSided=true};}
   if(string.IsNullOrWhiteSpace(name)||name.StartsWith("#"))return new{texture=(string)null,color=new[]{.55,.55,.5},alphaTest=0,doubleSided=true};
   byte[] raw=Program.ReadResource(name);using var stream=new MemoryStream(raw);var paa=new BIS.PAA.PAA(stream,name.EndsWith(".pac",StringComparison.OrdinalIgnoreCase));
   var mip=paa.Mipmaps.FirstOrDefault(m=>m.Width<=maxSize&&m.Height<=maxSize)??paa.Mipmaps.Last();
   var pixels=BIS.PAA.PAA.GetARGB32PixelData(paa,stream,mip);bool alpha=false;
   for(int i=3;i<pixels.Length;i+=4)if(pixels[i]<250){alpha=true;break;}
   string hash=Convert.ToHexString(SHA256.HashData(raw)).ToLowerInvariant()+"-"+mip.Width+"x"+mip.Height+".png";
   Directory.CreateDirectory(directory);string target=Path.Combine(directory,hash);
   if(!File.Exists(target)){
    using var bitmap=new Bitmap(mip.Width,mip.Height,PixelFormat.Format32bppArgb);
    var bits=bitmap.LockBits(new Rectangle(0,0,mip.Width,mip.Height),ImageLockMode.WriteOnly,PixelFormat.Format32bppArgb);
    try{for(int y=0;y<mip.Height;y++)Marshal.Copy(pixels,y*mip.Width*4,bits.Scan0+y*bits.Stride,mip.Width*4);}finally{bitmap.UnlockBits(bits);}
    using(var png=File.Create(target+".tmp"))bitmap.Save(png,ImageFormat.Png);File.Move(target+".tmp",target,true);
   }
   result=new{texture="models/local-textures/"+hash,color=new[]{1,1,1},alphaTest=alpha?.35:0,doubleSided=true,width=mip.Width,height=mip.Height};
  }catch(Exception e){result=new{texture=(string)null,color=new[]{.55,.55,.5},alphaTest=0,doubleSided=true,missingTexture=name,textureError=e.Message};}
  cache[key]=result;return result;
 }
}
