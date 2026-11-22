using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace ArmaMissionPlanner.Core.Sqm;

public record ArmaCapacityEntry(double Mass, double MaxLoad, double AceCargoSpace);

public static class ArmaCapacityCatalog
{
    private static readonly object LockObj = new();
    private static bool _loaded;
    private static readonly Dictionary<string, ArmaCapacityEntry> Entries = new(StringComparer.OrdinalIgnoreCase);

    public static IReadOnlyDictionary<string, ArmaCapacityEntry> GetAll()
    {
        EnsureLoaded();
        return Entries;
    }
    private static string? FindInventoryJsonPath(string? baseDir = null)
{
    var dir = new DirectoryInfo(baseDir ?? AppContext.BaseDirectory);

    while (dir != null)
    {
        // Проверяем и саму папку, и соседнюю/дочернюю ArmaMissionPlannerData
        string[] foldersToCheck =
        {
            Path.Combine(dir.FullName,"../..", "ArmaMissionPlannerData"),
            Path.Combine(dir.FullName, "ArmaMissionPlannerData", "arma-icons"),
            dir.FullName
        };

        foreach (var folder in foldersToCheck)  
        {
            if (!Directory.Exists(folder)) continue;

            // Проверяем оба варианта названия (с 'n' и с опечаткой без 'n')
            var p1 = Path.Combine(folder, "inventory.json");
            if (File.Exists(p1)) return p1;
        }

        dir = dir.Parent;
    }

    return null;
}
    public static void EnsureLoaded(string? baseDir = null)
    {
        lock (LockObj)
        {
            if (_loaded && Entries.Count > 0) return;

           var jsonPath = FindInventoryJsonPath();
            if (jsonPath == null)
            {
                Console.WriteLine($"[ArmaCapacity] ОШИБКА: Файл inventory.json не найден! Проверено от: {AppContext.BaseDirectory}");
                return;
            }

            Console.WriteLine($"[ArmaCapacity] Найден файл весов: {jsonPath}");

            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(jsonPath));
                if (doc.RootElement.ValueKind == JsonValueKind.Array)
                {
                    foreach (var el in doc.RootElement.EnumerateArray())
                    {
                        if (el.ValueKind == JsonValueKind.Array && el.GetArrayLength() >= 4)
                        {
                            var cls = el[0].GetString();
                            if (string.IsNullOrWhiteSpace(cls)) continue;
                            double mass = el[1].TryGetDouble(out var m) ? m : 0;
                            double maxLoad = el[2].TryGetDouble(out var ml) ? ml : 0;
                            double aceSpace = el[3].TryGetDouble(out var ac) ? ac : 0;
                            Entries[cls] = new ArmaCapacityEntry(mass, maxLoad, aceSpace);
                        }
                    }
                }
                _loaded = true;
                Console.WriteLine($"[ArmaCapacity] Загружено {Entries.Count} записей веса и вместимости из {jsonPath}");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ArmaCapacity] Ошибка чтения invetory.json: {ex.Message}");
            }
        }
    }
    

    public static double GetItemMass(string className)
    {
        EnsureLoaded();
        if (string.IsNullOrWhiteSpace(className)) return 0;
        if (Entries.TryGetValue(className, out var entry) && entry.Mass > 0)
            return entry.Mass;

        // Фоллбэк, если кастомного предмета или оружия (WeaponSlotsInfo >> mass) нет в дампе
        var lower = className.ToLowerInvariant();
        if (lower.Contains("100rnd") || lower.Contains("150rnd") || lower.Contains("200rnd")) return 25;
        if (lower.Contains("pg7") || lower.Contains("og7") || lower.Contains("tbg7")) return 45;
        if (lower.Contains("rnd") || lower.Contains("mag")) return 8;
        if (lower.Contains("grenade") || lower.Contains("rgd") || lower.Contains("f1") || lower.Contains("smoke") || lower.Contains("vog") || lower.Contains("grd40") || lower.Contains("vg40")) return 5;
        if (lower.Contains("toolkit")) return 80;

        // Тяжелые ПТРК / ПЗРК / многоразовые гранатометы
        if (lower.Contains("igla") || lower.Contains("strela") || lower.Contains("stinger") || lower.Contains("fim92") ||
            lower.Contains("fgm148") || lower.Contains("jav") || lower.Contains("smaw") || lower.Contains("maaws") ||
            lower.Contains("nlaw") || lower.Contains("rpg7") || lower.Contains("metis") || lower.Contains("titan") ||
            lower.Contains("vorona"))
            return 100;

        // Одноразовые гранатометы и трубы (M72, РПГ-18/22/26, РШГ, AT4, M136)
        if (lower.Contains("m72") || lower.Contains("rpg18") || lower.Contains("rpg22") || lower.Contains("rpg26") ||
            lower.Contains("rpg27") || lower.Contains("rshg") || lower.Contains("rmg") || lower.Contains("at4") ||
            lower.Contains("m136") || lower.Contains("launch") || lower.Contains("rpg") || lower.Contains("panzerfaust") ||
            lower.Contains("pzf"))
            return 50;

        // Пулеметы и крупнокалиберные снайперские винтовки
        if (lower.Contains("m82") || lower.Contains("m107") || lower.Contains("asvk") || lower.Contains("kord") ||
            lower.Contains("pkp") || lower.Contains("pkm") || lower.Contains("pecheneg") || lower.Contains("minimi") ||
            lower.Contains("m249") || lower.Contains("m240") || lower.Contains("lmg_") || lower.Contains("mmg_"))
            return 110;

        // Пистолеты и ПП
        if (lower.Contains("hgun") || lower.Contains("pistol") || lower.Contains("makarov") || lower.Contains("pya") ||
            lower.Contains("glock") || lower.Contains("m9") || lower.Contains("tt33") || lower.Contains("aps") ||
            lower.Contains("scorpion") || lower.Contains("vz61") || lower.Contains("rsp30") || lower.Contains("flare"))
            return 20;

        // Бинокли и дальномеры
        if (lower.Contains("binocular") || lower.Contains("vector") || lower.Contains("pdu4") || lower.Contains("zrak") ||
            lower.Contains("rd7j") || lower.Contains("lerca") || lower.Contains("tr8") || lower.Contains("rangefinder") ||
            lower.Contains("laserdesignator") || lower.Contains("soflam"))
            return 10;

        // Автоматы, карабины и винтовки (в рюкзаке или кузове)
        if (lower.Contains("weap_") || lower.Contains("arifle_") || lower.Contains("srifle_") || lower.Contains("smg_") ||
            lower.Contains("ak74") || lower.Contains("akm") || lower.Contains("m4a1") || lower.Contains("m16") ||
            lower.Contains("m21") || lower.Contains("hk416") || lower.Contains("sr25") || lower.Contains("svd") ||
            lower.Contains("asval") || lower.Contains("vss"))
            return 70;

        return 2;
    }

    public static double? GetContainerMaxLoad(string className)
    {
        EnsureLoaded();
        if (string.IsNullOrWhiteSpace(className)) return null;
        if (Entries.TryGetValue(className, out var entry) && entry.MaxLoad > 0)
            return entry.MaxLoad;
        return null;
    }

    public static (string ClassName, double MaxLoad) GetMinContainerMaxLoad(
        IReadOnlyList<string>? variants,
        string primaryClass,
        double defaultMaxLoad)
    {
        EnsureLoaded();
        var candidates = (variants != null && variants.Count > 0)
            ? variants.Where(v => !string.IsNullOrWhiteSpace(v)).ToList()
            : (!string.IsNullOrWhiteSpace(primaryClass) ? new List<string> { primaryClass } : new List<string>());

        if (candidates.Count == 0)
            return (primaryClass, defaultMaxLoad);

        string minCls = candidates[0];
        double minLoad = double.MaxValue;

        foreach (var cls in candidates)
        {
            var load = GetContainerMaxLoad(cls);
            if (load.HasValue && load.Value > 0 && load.Value < minLoad)
            {
                minLoad = load.Value;
                minCls = cls;
            }
        }

        if (minLoad == double.MaxValue)
            return (minCls, defaultMaxLoad);

        return (minCls, minLoad);
    }

    public static double? GetVehicleAceCargoSpace(string className)
    {
        EnsureLoaded();
        if (string.IsNullOrWhiteSpace(className)) return null;
        if (Entries.TryGetValue(className, out var entry) && entry.AceCargoSpace > 0)
            return entry.AceCargoSpace;
        return null;
    }

    public static double CalculateItemsMass(Dictionary<string, int> items)
    {
        double total = 0;
        foreach (var (cls, count) in items)
        {
            total += GetItemMass(cls) * count;
        }
        return Math.Round(total, 1);
    }
}
