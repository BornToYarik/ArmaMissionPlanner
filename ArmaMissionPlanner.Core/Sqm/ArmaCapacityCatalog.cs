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
    private static string? FindInventoryJsonPath()
{
    // Стартуем от базовой папки запуска (или текущей рабочей директории)
    var dir = new DirectoryInfo(AppContext.BaseDirectory);

    while (dir != null)
    {
        string[] candidates =
        {
            Path.Combine(dir.FullName, "inventory.json"),
            Path.Combine(dir.FullName, "invetory.json"), // на случай опечатки в имени файла
            Path.Combine(dir.FullName, "arma-icons", "inventory.json"),
            Path.Combine(dir.FullName, "arma-icons", "invetory.json")
        };

        foreach (var path in candidates)
        {
            if (File.Exists(path))
                return path;
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
                using var doc = JsonDocument.Parse(File.ReadAllText(foundPath));
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
                Console.WriteLine($"[ArmaCapacity] Загружено {Entries.Count} записей веса и вместимости из {foundPath}");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ArmaCapacity] Ошибка чтения invetory.json: {ex.Message}");
            }
        }
    }
    }

    public static double GetItemMass(string className)
    {
        EnsureLoaded();
        if (string.IsNullOrWhiteSpace(className)) return 0;
        if (Entries.TryGetValue(className, out var entry) && entry.Mass > 0)
            return entry.Mass;

        // Фоллбэк, если кастомного предмета нет в дампе
        var lower = className.ToLowerInvariant();
        if (lower.Contains("100rnd") || lower.Contains("150rnd") || lower.Contains("200rnd")) return 25;
        if (lower.Contains("pg7") || lower.Contains("og7") || lower.Contains("rpg")) return 45;
        if (lower.Contains("rnd") || lower.Contains("mag")) return 8;
        if (lower.Contains("grenade") || lower.Contains("rgd") || lower.Contains("f1") || lower.Contains("smoke") || lower.Contains("vog")) return 5;
        if (lower.Contains("toolkit")) return 80;
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
