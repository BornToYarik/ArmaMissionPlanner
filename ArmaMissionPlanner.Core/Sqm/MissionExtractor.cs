using System.Text.RegularExpressions;
using ArmaMissionPlanner.Core.Models;
using ArmaMissionPlanner.Core.Pbo;

namespace ArmaMissionPlanner.Core.Sqm;

public static class MissionExtractor
{
    public static MissionInfo Extract(SqmClass root, PboArchive? archive = null)
    {
        var mission = new MissionInfo();

        var scenarioData = root.GetClass("ScenarioData");
        if (scenarioData != null)
        {
            mission.Author = scenarioData.GetProperty("author")?.AsString() ?? "Unknown";
        }

        var missionClass = root.GetClass("Mission");
        if (missionClass == null) return mission;

        var intel = missionClass.GetClass("Intel");
        if (intel != null)
        {
            mission.Name = intel.GetProperty("briefingName")?.AsString() ?? "No name";
            mission.Overview = intel.GetProperty("overviewText")?.AsString() ?? string.Empty;
        }

        var entities = missionClass.GetClass("Entities");
        if (entities != null)
        {
            // Рекурсивно собираем все сущности (с учетом слоев Layer)
            CollectEntitiesRecursive(entities, mission, archive);
        }

        return mission;
    }

    private static void CollectEntitiesRecursive(SqmClass container, MissionInfo mission, PboArchive? archive)
    {
        foreach (var item in container.Children.OfType<SqmClass>())
        {
            var dataType = item.GetProperty("dataType")?.AsString();

            if (dataType == "Group")
            {
                var group = ExtractGroup(item, archive);
                if (group.Units.Count > 0)
                {
                    mission.Groups.Add(group);
                }
            }
            else if (dataType == "Object")
            {
                var veh = ExtractVehicle(item);
                if (veh != null)
                {
                    mission.Vehicles.Add(veh);
                }
            }
            else if (dataType == "Marker")
            {
                var marker = ExtractMarker(item);
                if (marker != null)
                {
                    mission.Markers.Add(marker);
                }
            }
            else if (dataType == "Layer")
            {
                // Если это слой, внутри него в Entities лежит техника или отряды
                var layerEntities = item.GetClass("Entities");
                if (layerEntities != null)
                {
                    CollectEntitiesRecursive(layerEntities, mission, archive);
                }
            }
        }
    }

    private static SquadGroup ExtractGroup(SqmClass groupClass, PboArchive? archive)
    {
        var group = new SquadGroup
        {
            Id = groupClass.GetProperty("id")?.AsInt() ?? 0,
            Side = groupClass.GetProperty("side")?.AsString() ?? "Unknown"
        };

        // Ищем позывной отделения в CustomAttributes
        group.CallSign = FindAttributeValue(groupClass, "groupID");

        var subEntities = groupClass.GetClass("Entities");
        if (subEntities != null)
        {
            foreach (var unitClass in subEntities.Children.OfType<SqmClass>())
            {
                var unit = new SquadUnit
                {
                    Id = unitClass.GetProperty("id")?.AsInt() ?? 0,
                    VehicleClass = unitClass.GetProperty("type")?.AsString() ?? string.Empty
                };

                // Имя слота из лобби сидит в атрибуте description или в корневом свойстве
                var desc = FindAttributeValue(unitClass, "description");
                if (string.IsNullOrEmpty(desc))
                {
                    desc = unitClass.GetProperty("description")?.AsString();
                }
                unit.RoleDescription = desc ?? string.Empty;

                // Init скрипт (может быть свойством init или атрибутом)
                var init = unitClass.GetProperty("init")?.AsString();
                if (string.IsNullOrEmpty(init))
                {
                    init = FindAttributeValue(unitClass, "init");
                }
                unit.InitScript = init ?? string.Empty;

                // Если есть ссылка на архив, вытаскиваем оружие из sqf
                if (archive != null)
                {
                    ExtractWeaponsFromScript(unit, archive, group.Side);
                }

                // Позиция
                var posProp = unitClass.GetProperty("position");
                if (posProp?.Value is object[] posArray)
                {
                    unit.Position = posArray.Select(Convert.ToSingle).ToArray();
                }

                group.Units.Add(unit);
            }
        }

        return group;
    }

    private static void ExtractWeaponsFromScript(SquadUnit unit, PboArchive archive, string side)
    {
        // 1. Ищем путь к sqf в поле init (например: execVM "saf\ko.sqf" или preprocessFileLineNumbers "saf\ko.sqf")
        string? scriptPath = null;
        if (!string.IsNullOrEmpty(unit.InitScript))
        {
            var match = Regex.Match(unit.InitScript, @"[""']([^""']+\.sqf)[""']", RegexOptions.IgnoreCase);
            if (match.Success)
            {
                scriptPath = match.Groups[1].Value.Replace("/", "\\");
            }
        }

        if (string.IsNullOrEmpty(scriptPath)) return;

        // 2. Ищем файл в PBO
        var entry = archive.Entries.FirstOrDefault(e => e.FileName.Equals(scriptPath, StringComparison.OrdinalIgnoreCase));
        if (entry == null) return;

        try
        {
            var scriptText = archive.GetFileContentAsString(entry.FileName);

            // Регулярка для addWeapon: _unit addWeapon "rhs_weap_ak74m";
            var weaponMatches = Regex.Matches(scriptText, @"addWeapon\s+[""']([^""']+)[""']", RegexOptions.IgnoreCase);

            var weapons = weaponMatches.Select(m => m.Groups[1].Value).Distinct().ToList();

            foreach (var w in weapons)
            {
                var lower = w.ToLower();
                if (lower.Contains("rpg") || lower.Contains("launch") || lower.Contains("at4") || lower.Contains("nlaw") || lower.Contains("m72"))
                {
                    unit.SecondaryWeapon = w;
                }
                else if (lower.Contains("pistol") || lower.Contains("makarov") || lower.Contains("pya") || lower.Contains("m9"))
                {
                    unit.Handgun = w;
                }
                else
                {
                    if (string.IsNullOrEmpty(unit.PrimaryWeapon))
                        unit.PrimaryWeapon = w;
                    else
                        unit.SecondaryWeapon = w; // Если вторая пушка
                }
            }
        }
        catch
        {
            // Пропускаем битые файлы
        }
    }

    private static string? FindAttributeValue(SqmClass parentClass, string attributeName)
    {
        var customAttributes = parentClass.GetClass("CustomAttributes");
        if (customAttributes == null) return null;

        foreach (var attr in customAttributes.Children.OfType<SqmClass>())
        {
            var propName = attr.GetProperty("property")?.AsString();
            if (string.Equals(propName, attributeName, StringComparison.OrdinalIgnoreCase))
            {
                var valClass = attr.GetClass("Value");
                if (valClass != null)
                {
                    return valClass.GetProperty("data")?.AsString();
                }
                return attr.GetProperty("expression")?.AsString();
            }
        }

        return null;
    }

    private static MissionVehicle? ExtractVehicle(SqmClass item)
    {
        var veh = new MissionVehicle
        {
            Id = item.GetProperty("id")?.AsInt() ?? 0,
            Side = item.GetProperty("side")?.AsString() ?? "Unknown",
            VehicleClass = item.GetProperty("type")?.AsString() ?? string.Empty
        };

        var initProp = item.GetProperty("init");
        if (initProp != null) veh.InitScript = initProp.AsString();

        return veh;
    }

    private static MissionMarker? ExtractMarker(SqmClass item)
    {
        return new MissionMarker
        {
            Name = item.GetProperty("name")?.AsString() ?? string.Empty,
            MarkerType = item.GetProperty("markerType")?.AsString() ?? string.Empty
        };
    }
}