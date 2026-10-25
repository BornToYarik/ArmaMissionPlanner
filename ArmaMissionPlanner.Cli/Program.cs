using ArmaMissionPlanner.Core.Pbo;
using ArmaMissionPlanner.Core.Sqm;

const string missionPath = @"F:\projects\wog_160_balkan_gambit_11.cup_chernarus_A3.pbo";

using var archive = PboArchive.Open(missionPath);
var sqmEntry = archive.Entries.First(e => e.FileName.Equals("mission.sqm", StringComparison.OrdinalIgnoreCase));
var root = RapReader.ReadFromBytes(archive.GetFileData(sqmEntry));

var mission = MissionExtractor.Extract(root, archive, missionPath);

Console.WriteLine($"Миссия: {mission.Name} | Остров: {mission.WorldName} | Автор: {mission.Author}");
Console.WriteLine($"Описание лобби: {mission.Overview}");
Console.WriteLine($"WMT: Прорисовка={mission.WmtSettings.ViewDistance}м, Земля={mission.WmtSettings.TerrainViewDistance}м, ТПВ={mission.WmtSettings.ThermalMode}, Время={mission.WmtSettings.MissionTimeMinutes} мин");

Console.WriteLine($"\n--- Модули WMT (все атрибуты: {mission.WmtSettings.RawModuleAttributes.Count}) ---");
foreach (var kv in mission.WmtSettings.RawModuleAttributes)
    Console.WriteLine($"  {kv.Key} = {kv.Value}");

Console.WriteLine($"\n--- Брифинг (вкладок: {mission.Briefing.Count}, картинок форм: {mission.BriefingImages.Count}) ---");
foreach (var b in mission.Briefing)
    Console.WriteLine($"  [{b.Title}] ({b.HtmlText.Length} симв.)");
foreach (var img in mission.BriefingImages)
    Console.WriteLine($"  Картинка: {img}");

Console.WriteLine($"\n--- Отделения ({mission.Groups.Count}) ---");
foreach (var g in mission.Groups.Take(5))
{
    Console.WriteLine($"[{g.Side}] {g.CallSign} (Слотов: {g.Units.Count})");
    foreach (var u in g.Units.Take(3))
    {
        var posStr = u.Position.Length >= 3 ? $"X={u.Position[0]:F0}, Y={u.Position[2]:F0}" : "Нет координат";
        Console.WriteLine($"   - {u.RoleDescription} ({u.VehicleClass}) | Пушка: {u.PrimaryWeapon} | Форма: {u.Loadout.Uniform} | Предметов: {u.Loadout.ItemsAndMagazines.Values.Sum()} | [{posStr}]");
    }
}

Console.WriteLine($"\n--- Техника и ящики ({mission.Vehicles.Count}) ---");
foreach (var v in mission.Vehicles.Where(x => x.Cargo.HasAnyCargo || !string.IsNullOrEmpty(x.InitScript)).Take(10))
{
    var posStr = v.Position.Length >= 3 ? $"X={v.Position[0]:F0}, Y={v.Position[2]:F0}" : "Нет координат";
    Console.WriteLine($"  [{v.VehicleClass}] Имя: {v.CustomName} | [{posStr}] | Пушек в кузове: {v.Cargo.Weapons.Values.Sum()}, БК: {v.Cargo.Magazines.Values.Sum()}, Предметов: {v.Cargo.Items.Values.Sum()}");
}