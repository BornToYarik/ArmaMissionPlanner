using ArmaMissionPlanner.Core.Sqm;

namespace ArmaMissionPlanner.Core.Tests;

public class PlanningSceneTests
{
    [Test]
    public void PreservesSceneryAndNonPlayableGroupMemberWithFullTransform()
    {
        var root = new SqmClass {Name = "Entities"};
        var group = new SqmClass {Name="Item0"};
        group.Children.AddRange([Prop("dataType","Group"),Prop("id",8),Prop("side","WEST")]);
        var children = new SqmClass {Name="Entities"}; group.Children.Add(children); root.Children.Add(group);
        children.Children.Add(Object(12,"B_Soldier_F"));root.Children.Add(Object(13,"Land_Tower_F"));
        var scene = PlanningSceneExtractor.Extract(root);
        Assert.That(scene.Count, Is.EqualTo(2));
        Assert.That(scene[0].GroupId, Is.EqualTo(8));Assert.That(scene[0].Side, Is.EqualTo("WEST"));
        Assert.That(scene[0].IsPlayable, Is.False);
        Assert.That(scene[1].Position, Is.EqualTo(new float[]{100,23,200}));
        Assert.That(scene[1].Angles, Is.EqualTo(new float[]{.1f,.2f,.3f}));
    }
    private static SqmProperty Prop(string name, object value) => new(){Name=name,Value=value};
    private static SqmClass Object(int id,string type)
    {
        var o = new SqmClass();o.Children.AddRange([Prop("dataType","Object"),Prop("id",id),Prop("type",type)]);
        var p = new SqmClass {Name="PositionInfo"};p.Children.AddRange([Prop("position",new object[]{100f,23f,200f}),Prop("angles",new object[]{.1f,.2f,.3f})]);o.Children.Add(p);return o;
    }
}
