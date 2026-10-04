namespace ArmaMissionPlanner.Core.Models;

public class MissionInfo
{
    public string Name { get; set; } = string.Empty;
    public string Author { get; set; } = string.Empty;
    public string Overview { get; set; } = string.Empty;
    public List<SquadGroup> Groups { get; set; } = new();
    public List<MissionVehicle> Vehicles { get; set; } = new();
    public List<MissionMarker> Markers { get; set; } = new();
}

public class SquadGroup
{
    public int Id { get; set; }
    public string Side { get; set; } = string.Empty;
    public string CallSign { get; set; } = string.Empty;
    public List<SquadUnit> Units { get; set; } = new();
}

public class SquadUnit
{
    public int Id { get; set; }
    public string RoleDescription { get; set; } = string.Empty; // "КО", "Пулеметчик"
    public string VehicleClass { get; set; } = string.Empty;    // "rhssaf_army_o_m10_digital_gl"
    public string InitScript { get; set; } = string.Empty;      // "nul = [this] execVM 'saf\ko.sqf';"
    
    public string PrimaryWeapon { get; set; } = string.Empty;   // Автомат / Пулемет
    public string SecondaryWeapon { get; set; } = string.Empty; // Труба / РПГ
    public string Handgun { get; set; } = string.Empty;
    
    public float[] Position { get; set; } = Array.Empty<float>();
    public bool IsPlayable { get; set; }
}

public class MissionVehicle
{
    public int Id { get; set; }
    public string Side { get; set; } = string.Empty;
    public string VehicleClass { get; set; } = string.Empty;
    public string CustomName { get; set; } = string.Empty;
    public string InitScript { get; set; } = string.Empty;
    public float[] Position { get; set; } = Array.Empty<float>();
}

public class MissionMarker
{
    public string Name { get; set; } = string.Empty;
    public string MarkerType { get; set; } = string.Empty;
    public float[] Position { get; set; } = Array.Empty<float>();
}