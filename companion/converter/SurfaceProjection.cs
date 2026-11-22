using System;
using System.IO;
using System.Linq;
using System.Numerics;
using System.Collections.Generic;
using System.Text.Json;

public static class SurfaceProjection {
 static Vector3 Closest(Vector3 p,Vector3 a,Vector3 b,Vector3 c){
  var ab=b-a;var ac=c-a;var ap=p-a;float d1=Vector3.Dot(ab,ap),d2=Vector3.Dot(ac,ap);
  if(d1<=0&&d2<=0)return new(1,0,0);
  var bp=p-b;float d3=Vector3.Dot(ab,bp),d4=Vector3.Dot(ac,bp);
  if(d3>=0&&d4<=d3)return new(0,1,0);
  float vc=d1*d4-d3*d2;
  if(vc<=0&&d1>=0&&d3<=0){float v=d1/(d1-d3);return new(1-v,v,0);}
  var cp=p-c;float d5=Vector3.Dot(ab,cp),d6=Vector3.Dot(ac,cp);
  if(d6>=0&&d5<=d6)return new(0,0,1);
  float vb=d5*d2-d1*d6;
  if(vb<=0&&d2>=0&&d6<=0){float w=d2/(d2-d6);return new(1-w,0,w);}
  float va=d3*d6-d5*d4;
  if(va<=0&&d4-d3>=0&&d5-d6>=0){float w=(d4-d3)/((d4-d3)+(d5-d6));return new(0,1-w,w);}
  float total=va+vb+vc;if(Math.Abs(total)<1e-18)return new(1,0,0);
  return new(1-vb/total-vc/total,vb/total,vc/total);
 }
 public static int Run(string input,string output){
  try{
   using var doc=JsonDocument.Parse(File.ReadAllText(input));var root=doc.RootElement;var b=root.GetProperty("base");
   var old=JsonSerializer.Deserialize<float[]>(b.GetProperty("positions"));var pos=JsonSerializer.Deserialize<float[]>(root.GetProperty("positions"));
   var indices=JsonSerializer.Deserialize<int[]>(b.GetProperty("indices"));var uv=JsonSerializer.Deserialize<float[]>(b.GetProperty("uvs"));
   int[] parts=null;if(b.TryGetProperty("rig",out var rig)&&rig.TryGetProperty("parts",out var ps))parts=JsonSerializer.Deserialize<int[]>(ps);
   var verts=new Vector3[old.Length/3];for(int i=0;i<verts.Length;i++)verts[i]=new(old[i*3],old[i*3+1],old[i*3+2]);
   var low=verts.Aggregate(Vector3.Min);var high=verts.Aggregate(Vector3.Max);var span=high-low;float extent=Math.Max(span.X,Math.Max(span.Y,span.Z));float limit=Math.Max(.03f,extent*(root.GetProperty("detail").GetBoolean()?.12f:.025f));
   int n=indices.Length/3;var materials=new int[n];
   foreach(var g in b.GetProperty("groups").EnumerateArray())for(int i=g.GetProperty("start").GetInt32()/3;i<(g.GetProperty("start").GetInt32()+g.GetProperty("count").GetInt32())/3;i++)materials[i]=g.GetProperty("materialIndex").GetInt32();
   var lows=new Vector3[n];var highs=new Vector3[n];
   for(int i=0;i<n;i++){var a=verts[indices[i*3]];var c=verts[indices[i*3+1]];var d=verts[indices[i*3+2]];lows[i]=Vector3.Min(a,Vector3.Min(c,d));highs[i]=Vector3.Max(a,Vector3.Max(c,d));}
   var memo=new Dictionary<Vector3,double[]>();var result=new double[pos.Length/3][];
   for(int j=0;j<result.Length;j++){
    var p=new Vector3(pos[j*3],pos[j*3+1],pos[j*3+2]);if(memo.TryGetValue(p,out var known)){result[j]=known;continue;}
    float distance=limit*limit;int best=-1;Vector3 weights=default;
    for(int i=0;i<n;i++){
     var delta=p-Vector3.Clamp(p,lows[i],highs[i]);if(delta.LengthSquared()>distance)continue;
     var a=verts[indices[i*3]];var c=verts[indices[i*3+1]];var d=verts[indices[i*3+2]];var w=Closest(p,a,c,d);float ds=Vector3.DistanceSquared(p,a*w.X+c*w.Y+d*w.Z);
     if(ds<=distance){distance=ds;best=i;weights=w;}
    }
    if(best<0)throw new Exception("Новая поверхность не совмещается с проверенной моделью");
    int ia=indices[best*3],ib=indices[best*3+1],ic=indices[best*3+2];int main=weights.X>=weights.Y&&weights.X>=weights.Z?ia:weights.Y>=weights.Z?ib:ic;
    result[j]=new double[]{materials[best],uv[ia*2]*weights.X+uv[ib*2]*weights.Y+uv[ic*2]*weights.Z,uv[ia*2+1]*weights.X+uv[ib*2+1]*weights.Y+uv[ic*2+1]*weights.Z,parts==null?0:parts[main],Math.Sqrt(distance)};memo[p]=result[j];
   }
   File.WriteAllText(output,JsonSerializer.Serialize(result));return 0;
  }catch(Exception e){Console.WriteLine(e.Message);return 1;}
 }
}
