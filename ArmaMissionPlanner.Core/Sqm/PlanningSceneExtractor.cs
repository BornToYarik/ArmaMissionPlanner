using ArmaMissionPlanner.Core.Models;

namespace ArmaMissionPlanner.Core.Sqm;

// Separate from booking extraction: scenery and non-playable objective units
// must survive without changing which slots the existing booking UI offers.
public static class PlanningSceneExtractor
{
    public static List<PlanningObject> Extract(SqmClass entities)
    {
        var result = new List<PlanningObject>();
        Visit(entities, result, null, "");
        return result;
    }

    private static void Visit(SqmClass parent, List<PlanningObject> result, int? group, string side)
    {
        foreach (var item in parent.Children.OfType<SqmClass>())
        {
            var type = item.GetProperty("dataType")?.AsString();
            var ownSide = item.GetProperty("side")?.AsString() ?? side;
            var id = item.GetProperty("id")?.AsInt() ?? -1;
            if (type == "Object")
            {
                var info = item.GetClass("PositionInfo");
                var attributes = item.GetClass("Attributes");
                var position = Numbers(info?.GetProperty("position") ?? item.GetProperty("position"));
                if (position.Length == 3 && position.All(float.IsFinite))
                    result.Add(new PlanningObject
                    {
                        Id = id, GroupId = group, Side = ownSide,
                        VehicleClass = item.GetProperty("type")?.AsString() ?? "",
                        Name = attributes?.GetProperty("name")?.AsString() ?? "",
                        Description = attributes?.GetProperty("description")?.AsString() ?? "",
                        Position = position, Angles = Numbers(info?.GetProperty("angles")),
                        IsPlayable = (attributes?.GetProperty("isPlayable")?.AsInt() ?? 0) == 1
                            || (attributes?.GetProperty("isPlayer")?.AsInt() ?? 0) == 1,
                        Init = attributes?.GetProperty("init")?.AsString() ?? ""
                    });
            }
            var nested = item.GetClass("Entities");
            if (nested != null) Visit(nested, result, type == "Group" ? id : group, ownSide);
        }
    }

    private static float[] Numbers(SqmProperty? property) =>
        property?.AsArray().Select(Convert.ToSingle).ToArray() ?? [];
}
