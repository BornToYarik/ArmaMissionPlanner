namespace ArmaMissionPlanner.Core.Models;

public class PlanningObject
{
    public int Id { get; set; }
    public int? GroupId { get; set; }
    public string Side { get; set; } = "";
    public string VehicleClass { get; set; } = "";
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    // Eden/SQM: east, altitude ASL, north. Angles: pitch, yaw, roll in radians.
    public float[] Position { get; set; } = [];
    public float[] Angles { get; set; } = [];
    public bool IsPlayable { get; set; }
    public string Init { get; set; } = "";
}
