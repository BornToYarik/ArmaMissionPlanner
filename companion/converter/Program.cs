using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json;
using System.Numerics;
using System.Text.RegularExpressions;
using System.Globalization;
using BIS.Core.Streams;
using BIS.P3D.ODOL;
namespace BIS.Core { public static class Terminal { public static void Muted(string s) {} } }
public class Program {
 static Dictionary<string,JsonElement> resources;
 static string Normalize(string p) {p=p.TrimStart('\\').Replace('/','\\').ToLowerInvariant();return p.EndsWith(".p3d")?p:p+".p3d";}
 public static byte[] ReadResource(string name) {
  name=name.TrimStart('\\').Replace('/','\\').ToLowerInvariant();
  if(!resources.ContainsKey(name)&&Path.GetExtension(name)!=".p3d")name=Path.ChangeExtension(name,".paa");
  var e=resources[name];using var f=File.OpenRead(e.GetProperty("archive").GetString());f.Seek(e.GetProperty("offset").GetInt64(),SeekOrigin.Begin);
  byte[] bytes=new byte[e.GetProperty("size").GetInt32()];f.ReadExactly(bytes);
  if(e.GetProperty("method").GetUInt32()!=0){using var zip=new MemoryStream(bytes);BIS.Core.Compression.LZSS.ReadLZSS(zip,out bytes,e.GetProperty("rawSize").GetUInt32(),false);}return bytes;
 }
 static ODOL ReadModel(string name){using var stream=new MemoryStream(ReadResource(Normalize(name)));var model=new ODOL();model.Read(new BinaryReaderEx(stream));return model;}
 static int Tri(LOD l)=>l.Polygons.Faces.Sum(f=>Math.Max(0,f.VertexIndices.Length-2));
 static LOD Choose(ODOL model,int budget) {var visual=model.Lods.Where(l=>l.Resolution>=0&&l.Resolution<1000&&Tri(l)>0).ToArray();return visual.Where(l=>Tri(l)<=budget&&Tri(l)>=budget*.35).OrderByDescending(Tri).FirstOrDefault()??visual.OrderBy(l=>Math.Abs(Tri(l)-budget)).First();}
 static string[] Bones(ODOL model,LOD lod) {
  var names=model.ModelInfo.Skeleton?.SkeletonBoneNames??Array.Empty<SkeletonBoneName>();var map=lod.SubSkeletonsToSkeleton;
  if(lod.VertexBoneRef==null||map==null)return Enumerable.Repeat("",lod.Vertices.Count).ToArray();
  return lod.VertexBoneRef.Select(b=>b.Count>0&&b.Data[0]<map.Length&&map[b.Data[0]]<names.Length?names[map[b.Data[0]]].BoneName.ToLowerInvariant():"").ToArray();
 }
 static void Append(LOD lod,string[] bones,Matrix4x4 transform,List<double> positions,List<double> uvs,List<int[]> triangles,List<string> textures,List<string> vertexBones) {
  var allUv=lod.UvSets.Select(s=>s.GetUV()).ToArray();
  var proxySections=(lod.RawProxies??Array.Empty<Proxy>()).Select(p=>p.SectionIndex).ToHashSet();var seen=new HashSet<Polygon>();
  var hiddenFaces=new HashSet<Polygon>();
  foreach(var selection in lod.NamedSelections) {
   string n=selection.Name.ToLowerInvariant();
   if(!(n.Contains("zasleh")||n.Contains("muzzle")||n.Contains("rotorblur")||n.Contains("rotor_blur")||n.Contains("vrtule blur")||n.Contains("tarnnetz")||n.Contains("camonet")||n.Contains("camo_net")||n=="clan"||n=="n1"||n=="n2"||n=="n3"))continue;
   foreach(var i in selection.SelectedFaces)if(i>=0&&i<lod.Polygons.Faces.Length)hiddenFaces.Add(lod.Polygons.Faces[i]);
   foreach(var i in selection.Sections)if(i>=0&&i<lod.Sections.Length)foreach(var f in lod.Sections[i].GetFaces(lod.Polygons.Faces))hiddenFaces.Add(f);
  }
  foreach(var pair in lod.Sections.Select((s,i)=>(s,i))) {
   if(proxySections.Contains(pair.i)||pair.s.TextureIndex<0&&pair.s.MaterialIndex<0)continue;
   string texture=pair.s.TextureIndex>=0&&pair.s.TextureIndex<lod.Textures.Length?lod.Textures[pair.s.TextureIndex]:"";
   int uvSet=0;Matrix4x4 uvTransform=Matrix4x4.Identity;
   if(string.IsNullOrEmpty(texture)&&pair.s.MaterialIndex>=0&&pair.s.MaterialIndex<lod.Materials.Length){
    var mat=lod.Materials[pair.s.MaterialIndex];int chosen=0;
    if(mat.PixelShader==103&&mat.StageTextures.Length>4){
     var mask=Regex.Match(mat.StageTextures[4].Texture,@"color\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*mask\)",RegexOptions.IgnoreCase);
     if(mask.Success){var rgb=Enumerable.Range(1,3).Select(i=>double.Parse(mask.Groups[i].Value,CultureInfo.InvariantCulture)).ToArray();if(rgb.Count(v=>v==1)==1&&rgb.All(v=>v==0||v==1))chosen=Array.IndexOf(rgb,1)+1;}
    }
    if(mat.StageTextures.Length>chosen){texture=mat.StageTextures[chosen].Texture;int id=chosen>0?chosen:(int)mat.StageTextures[chosen].StageID;if(id<mat.StageTransforms.Length){var t=mat.StageTransforms[id];uvSet=t.UvSource==5&&allUv.Length>1?1:0;uvTransform=t.Transformation.Matrix;}}
   }
   string textureLower=texture.ToLowerInvariant();
   if(textureLower.Contains("_netz_")||textureLower.Contains("net_parts")||textureLower.Contains("camonet"))continue;
   var color=Regex.Match(textureLower,@"color\(([^)]+)\)");
   if(color.Success){var values=color.Groups[1].Value.Split(',');if(values.Length>=4&&double.TryParse(values[3],NumberStyles.Float,CultureInfo.InvariantCulture,out double alpha)&&alpha<=.1)continue;}
   int tex=textures.IndexOf(texture);if(tex<0){tex=textures.Count;textures.Add(texture);}
   var mapped=new Dictionary<int,int>();
   int Map(int i){if(mapped.TryGetValue(i,out int j))return j;j=positions.Count/3;mapped[i]=j;var p=lod.Vertices[i];var v=Vector3.Transform(new Vector3(p.X,p.Y,p.Z),transform);positions.AddRange(new[]{Math.Round((double)-v.X,4),Math.Round((double)v.Y,4),Math.Round((double)v.Z,4)});var uv=Vector3.Zero;if(allUv.Length>uvSet&&allUv[uvSet].Length>i){var q=allUv[uvSet][i];uv=Vector3.Transform(new Vector3(q.X,q.Y,0),uvTransform);}uvs.Add(double.IsFinite(uv.X)?uv.X:0);uvs.Add(double.IsFinite(uv.Y)?1-uv.Y:0);vertexBones.Add(i<bones.Length?bones[i]:"");return j;}
   foreach(var face in pair.s.GetFaces(lod.Polygons.Faces)) {if(hiddenFaces.Contains(face)||!seen.Add(face)||face.VertexIndices.Any(i=>i<bones.Length&&(bones[i].Contains("blur")||bones[i].Contains("muzzleflash")||bones[i].Contains("zasleh"))))continue;var vs=face.VertexIndices;for(int i=1;i<vs.Length-1;i++)triangles.Add(new[]{Map(vs[0]),Map(vs[i+1]),Map(vs[i]),tex});}
  }
 }
 public static int Main(string[] args){
  Console.SetError(TextWriter.Null);
  resources=JsonSerializer.Deserialize<Dictionary<string,JsonElement>>(File.ReadAllText(args[0]));
  var jobs=JsonDocument.Parse(File.ReadAllText(args[1])).RootElement;
  int good=0,bad=0;
  foreach(var job in jobs.EnumerateArray()) {
   string output=job.GetProperty("output").GetString(),source=job.GetProperty("source").GetString();
   try {
    var model=ReadModel(source);var lod=job.TryGetProperty("highestDetail",out var highest)&&highest.GetBoolean()?model.Lods.Where(l=>l.Resolution>=0&&l.Resolution<1000&&Tri(l)>0).OrderBy(l=>l.Resolution).First():job.TryGetProperty("lod",out var exact)?model.Lods.FirstOrDefault(l=>Math.Abs(l.Resolution-exact.GetDouble())<.0001)??Choose(model,12000):Choose(model,job.TryGetProperty("budget",out var budget)?budget.GetInt32():12000);var positions=new List<double>();var uvs=new List<double>();var triangles=new List<int[]>();var textures=new List<string>();
    var reference=job.TryGetProperty("referenceLod",out var refLod)?model.Lods.FirstOrDefault(l=>Math.Abs(l.Resolution-refLod.GetDouble())<.0001)??lod:lod;
    var proxyIds=(reference.RawProxies??Array.Empty<Proxy>()).Select(p=>p.SectionIndex).ToHashSet();
    var originalVertices=reference.Sections.Select((s,i)=>(s,i)).Where(p=>!proxyIds.Contains(p.i)&&(p.s.TextureIndex>=0||p.s.MaterialIndex>=0)).SelectMany(p=>p.s.GetFaces(reference.Polygons.Faces)).SelectMany(f=>f.VertexIndices).Distinct().Select(i=>reference.Vertices[i]).ToArray();
    var legacyOrigin=new[]{(originalVertices.Min(v=>(double)v.X)+originalVertices.Max(v=>(double)v.X))/2,originalVertices.Min(v=>(double)v.Y),(originalVertices.Min(v=>(double)v.Z)+originalVertices.Max(v=>(double)v.Z))/2};
    var parts=new List<object>();var vertexBones=new List<string>();Append(lod,Bones(model,lod),Matrix4x4.Identity,positions,uvs,triangles,textures,vertexBones);parts.Add(new{start=0,count=triangles.Count,source});var proxies=new List<string>();var missing=new List<string>();
    foreach(var p in lod.RawProxies??Array.Empty<Proxy>()) {
     var path=Normalize(p.ProxyModel);var file=path.Split('\\').Last();
     // Character-seat proxies are animation placeholders, not vehicle geometry.
     if(path.Contains("characters")||path.Contains("\\proxy\\crew")||file.StartsWith("driver")||file.StartsWith("cargo")||file.StartsWith("gunner")||file.StartsWith("commander")||file.StartsWith("pilot")||file.Contains("getin")||file.Contains("getout"))continue;
     if(path.Contains("muzzle")||path.Contains("blur")||file.Contains("_folded")||file.Contains("_destroyed")||file.Contains("plane_flag")||path.Contains("volumelight")||path.Contains("damagewheel")||path.Contains("\\flags\\")||path.Contains("tarnnetz")||path.Contains("camonet")||path.Contains("clutter")||file.Contains("lightcone")||file.Contains("camochassis")||file.Contains("camoturret")||file.Contains("_netz_"))continue;
     if(!resources.ContainsKey(path)){missing.Add(path);continue;}
     try {var detail=ReadModel(path);var plod=Choose(detail,4000);if(file.Contains("_int_")||plod.Materials.Any(m=>m.MaterialName.ToLowerInvariant().Contains("camonet")))continue;int partStart=triangles.Count;var parentBones=model.ModelInfo.Skeleton?.SkeletonBoneNames??Array.Empty<SkeletonBoneName>();string attached=p.BoneIndex>=0&&p.BoneIndex<parentBones.Length?parentBones[p.BoneIndex].BoneName.ToLowerInvariant():"";Append(plod,Enumerable.Repeat(attached,plod.Vertices.Count).ToArray(),p.Transformation.Matrix,positions,uvs,triangles,textures,vertexBones);parts.Add(new{start=partStart,count=triangles.Count-partStart,source=path});proxies.Add(path);}catch{missing.Add(path);}
    }
    if(triangles.Count==0)throw new Exception("No visual triangles");

    object[] nativeMaterials=job.TryGetProperty("textureDirectory",out var td)?textures.Select(t=>NativeTextures.Material(t,td.GetString(),job.TryGetProperty("textureSize",out var ts)?ts.GetInt32():2048)).ToArray():null;
    var bones=(model.ModelInfo.Skeleton?.SkeletonBoneNames??Array.Empty<SkeletonBoneName>()).Select(b=>new{name=b.BoneName.ToLowerInvariant(),parent=b.ParentBoneName.ToLowerInvariant()});
    var payload=new{orientationConvention="forward-negative-z",positions,uvs,triangles,textures,nativeMaterials,vertexBones,bones,legacyOrigin,lod=lod.Resolution,sourceTriangles=model.Lods.Where(l=>l.Resolution>=0&&l.Resolution<1000).Max(Tri),source,proxies,parts,missingProxies=missing};
    File.WriteAllText(output,JsonSerializer.Serialize(payload));good++;
   }catch(Exception ex){File.WriteAllText(output+".error",ex.ToString());bad++;}
   Console.WriteLine($"{good} exported, {bad} failed: {source}");
  }
  return bad>0?1:0;
 }
}
