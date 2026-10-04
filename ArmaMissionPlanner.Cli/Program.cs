using ArmaMissionPlanner.Core.Pbo;
using ArmaMissionPlanner.Core.Sqm;

const string missionPath = @"F:\projects\wog_160_balkan_gambit_11.cup_chernarus_A3.pbo"; // Твой путь

using var archive = PboArchive.Open(missionPath);
var sqmEntry = archive.Entries.First(e => e.FileName.Equals("mission.sqm", StringComparison.OrdinalIgnoreCase));
var root = RapReader.ReadFromBytes(archive.GetFileData(sqmEntry));

Console.WriteLine("=== 1. ИНСПЕКТОР ЮНИТА (ID 15: I_officer_F) ===");

// Рекурсивный поиск класса юнита с id = 15
SqmClass? FindUnitById(SqmClass current, int targetId)
{
    var idProp = current.GetProperty("id");
    if (idProp != null && idProp.AsInt() == targetId)
        return current;

    foreach (var sub in current.Children.OfType<SqmClass>())
    {
        var found = FindUnitById(sub, targetId);
        if (found != null) return found;
    }
    return null;
}

var unit15 = FindUnitById(root, 15);
if (unit15 != null)
{
    Console.WriteLine($"Класс найден: {unit15.Name}");
    Console.WriteLine("--- Все прямые свойства юнита ---");
    foreach (var p in unit15.Children.OfType<SqmProperty>())
    {
        Console.WriteLine($"  {p.Name} = {p.Value}");
    }

    Console.WriteLine("--- Все подклассы юнита ---");
    void DumpSubTree(SqmClass cls, int depth = 1)
    {
        var prefix = new string(' ', depth * 2);
        Console.WriteLine($"{prefix}[class] {cls.Name}");
        foreach (var p in cls.Children.OfType<SqmProperty>())
            Console.WriteLine($"{prefix}  {p.Name} = {p.Value}");
        foreach (var sub in cls.Children.OfType<SqmClass>())
            DumpSubTree(sub, depth + 1);
    }
    foreach (var sub in unit15.Children.OfType<SqmClass>())
    {
        DumpSubTree(sub);
    }
}
else
{
    Console.WriteLine("Юнит с ID 15 не найден.");
}

Console.WriteLine("\n=== 2. СОДЕРЖИМОЕ saf\\ko.sqf (первые 300 символов) ===");
try
{
    var koText = archive.GetFileContentAsString(@"saf\ko.sqf");
    Console.WriteLine(koText.Length > 300 ? koText[..300] + "..." : koText);
}
catch (Exception ex)
{
    Console.WriteLine($"Ошибка чтения saf\\ko.sqf: {ex.Message}");
}

Console.WriteLine("\n=== 3. СОДЕРЖИМОЕ init.sqf (первые 300 символов) ===");
try
{
    var initText = archive.GetFileContentAsString("init.sqf");
    Console.WriteLine(initText.Length > 300 ? initText[..300] + "..." : initText);
}
catch (Exception ex)
{
    Console.WriteLine($"Ошибка чтения init.sqf: {ex.Message}");
}