using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using ArmaMissionPlanner.Core.Models;
using ArmaMissionPlanner.Core.Pbo;
using ArmaMissionPlanner.Core.Sqm;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
        policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod());
});

builder.Services.AddSingleton<MissionStateService>();
builder.Services.AddSingleton<ArmaAssetsCatalogService>();

var app = builder.Build();

app.UseCors();
app.UseDefaultFiles();
app.UseStaticFiles();

static string? FindExternalDataDir(string startPath)
{
    var dir = new DirectoryInfo(startPath);
    while (dir != null)
    {
        var candidate = Path.Combine(dir.FullName, "ArmaMissionPlannerData");
        if (Directory.Exists(candidate))
            return candidate;

        dir = dir.Parent;
    }
    return null;
}
// Инициализируем каталог иконок при старте
var assetsCatalog = app.Services.GetRequiredService<ArmaAssetsCatalogService>();
assetsCatalog.Initialize(builder.Environment.ContentRootPath);


var externalDataDir = FindExternalDataDir(builder.Environment.ContentRootPath)
                      ?? FindExternalDataDir(AppContext.BaseDirectory);

Console.WriteLine($"[Startup] Папка данных ArmaMissionPlannerData: {externalDataDir ?? "НЕ НАЙДЕНА"}");

string? ResolveMapDirectory(string worldName)
{
    var safeWorld = Path.GetFileName(worldName.ToLowerInvariant());
    var candidates = new List<string>();

    if (externalDataDir != null)
    {
        // 1. F:\projects\ArmaMissionPlannerData\maps\<worldName>
        candidates.Add(Path.Combine(externalDataDir, "maps", safeWorld));
        // 2. На случай если карты лежат сразу в F:\projects\ArmaMissionPlannerData\<worldName>
        candidates.Add(Path.Combine(externalDataDir, safeWorld));
    }

    // Запасные старые пути
    candidates.Add(Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, "..", "maps", safeWorld)));
    candidates.Add(Path.Combine(builder.Environment.ContentRootPath, "maps", safeWorld));

    return candidates.FirstOrDefault(Directory.Exists);
}

// 1. Загрузка и разбор PBO файла
app.MapPost("/api/mission/upload", async (IFormFile file, MissionStateService state) =>
{
    if (file == null || file.Length == 0)
        return Results.BadRequest("Файл пустой.");

    var ms = new MemoryStream();
    await file.CopyToAsync(ms);
    ms.Position = 0;

    var mission = state.LoadMission(ms, file.FileName);
    return Results.Ok(mission);
}).DisableAntiforgery();

// 2. Получение текущей загруженной миссии
app.MapGet("/api/mission/current", (MissionStateService state) =>
{
    return state.CurrentMission != null
        ? Results.Ok(state.CurrentMission)
        : Results.NotFound();
});

// 3. Отдача картинок из PBO
app.MapGet("/api/mission/image", (string path, MissionStateService state) =>
{
    var bytes = state.GetFileBytes(path);
    if (bytes == null) return Results.NotFound();

    var ext = Path.GetExtension(path).ToLowerInvariant();
    var contentType = ext switch
    {
        ".jpg" or ".jpeg" => "image/jpeg",
        ".png" => "image/png",
        _ => "application/octet-stream"
    };

    return Results.File(bytes, contentType);
});

// 4. Словарь русских названий и доступных иконок из arma_assets_dump_fixed.json
app.MapGet("/api/assets/catalog", (ArmaAssetsCatalogService catalog) =>
{
    return Results.Ok(catalog.DisplayNames);
});

// 4b. Полный список маркеров и цветов из дампа Arma 3 (CfgMarkers и CfgMarkerColors)
app.MapGet("/api/assets/markers", (ArmaAssetsCatalogService catalog) =>
{
    return Results.Ok(new
    {
        markers = catalog.Markers,
        colors = catalog.MarkerColors
    });
});

// 5. Универсальная отдача PNG-иконки по классу оружия/снаряжения/техники/маркера!
app.MapGet("/api/assets/icon/{className}", (string className, ArmaAssetsCatalogService catalog) =>
{
    var filePath = catalog.ResolveIconFilePath(className);
    if (filePath != null && File.Exists(filePath))
    {
        return Results.File(filePath, "image/png");
    }
    return Results.NotFound();
});

// 6. Отдача конфигурации карты map.json
app.MapGet("/api/maps/{worldName}/map.json", (string worldName) =>
{
    var mapDir = ResolveMapDirectory(worldName);
    if (mapDir != null)
    {
        var jsonPath = Path.Combine(mapDir, "map.json");
        if (File.Exists(jsonPath))
            return Results.File(jsonPath, "application/json");
    }

    return Results.NotFound(new { error = $"map.json для '{worldName}' не найден." });
});

// 7. Раздача тайлов топографической карты OCAP
app.MapGet("/api/maps/{worldName}/{z:int}/{x:int}/{y:int}.png", (string worldName, int z, int x, int y) =>
{
    if (x < 0 || y < 0 || z < 0) return Results.NotFound();

    var safeWorld = Path.GetFileName(worldName.ToLowerInvariant());
    var mapDir = ResolveMapDirectory(safeWorld)
                 ?? Path.Combine(builder.Environment.ContentRootPath, "maps", safeWorld);

    var localPathTopo = Path.Combine(mapDir, "topo", z.ToString(), x.ToString(), $"{y}.png");
    var localPathDirect = Path.Combine(mapDir, z.ToString(), x.ToString(), $"{y}.png");

    if (File.Exists(localPathTopo))
        return Results.File(localPathTopo, "image/png");
    if (File.Exists(localPathDirect))
        return Results.File(localPathDirect, "image/png");

    return Results.NotFound();
});

app.MapFallbackToFile("index.html");

app.Run("http://localhost:5123");

public record ArmaMarkerDef(
    int SwtIdx,
    string Id,
    string Name,
    bool HasIcon,
    bool IsFullColor,
    bool IsPureBlack,
    string DefaultColorHex
);

public record ArmaColorDef(
    int SwtIdx,
    string ArmaClass,
    string Name,
    string Hex
);

// Сервис каталога иконок и названий классов из arma_assets_dump_fixed.json
public class ArmaAssetsCatalogService
{
    private string? _iconsDir;
    // className -> pngFileName (например "rhs_weap_ak74m" -> "rhs_weap_ak74m_ca.png")
    private readonly Dictionary<string, string> _classToIconFile = new(StringComparer.OrdinalIgnoreCase);
    // className -> DisplayName (например "rhs_weap_ak74m" -> "АК-74М")
    public Dictionary<string, string> DisplayNames { get; } = new(StringComparer.OrdinalIgnoreCase);
    public List<ArmaMarkerDef> Markers { get; } = new();
    public List<ArmaColorDef> MarkerColors { get; } = new();

    public void Initialize(string contentRoot)
    {
        // Ищем папку с PNG иконками
        var iconDirCandidates = new[]
        {
            Path.GetFullPath(Path.Combine(contentRoot, "../..","ArmaMissionPlannerData", "arma-icons")),
            Path.GetFullPath(Path.Combine(contentRoot, "..", "arma-planner-ui", "public", "arma-icons")),
            Path.Combine(contentRoot, "arma-icons"),
            Path.Combine(contentRoot, "wwwroot", "arma-icons")
        };
        _iconsDir = iconDirCandidates.FirstOrDefault(Directory.Exists);

        // Ищем arma_assets_dump_fixed.json
        var jsonCandidates = new[]
        {
            Path.GetFullPath(Path.Combine(contentRoot, "../..","ArmaMissionPlannerData", "arma-icons", "arma_assets_dump_fixed.json")),
            Path.GetFullPath(Path.Combine(contentRoot, "../..","ArmaMissionPlannerData", "arma_assets_dump_fixed.json")),
            Path.GetFullPath(Path.Combine(contentRoot, "..", "arma-icons", "arma_assets_dump_fixed.json")),
            Path.GetFullPath(Path.Combine(contentRoot, "..", "arma-planner-ui", "public", "arma_assets_dump_fixed.json")),
            Path.GetFullPath(Path.Combine(contentRoot, "..", "arma-planner-ui", "src", "arma_assets_dump_fixed.json")),
            Path.Combine(contentRoot, "arma_assets_dump_fixed.json")
        };

        var jsonPath = jsonCandidates.FirstOrDefault(File.Exists);
        if (jsonPath == null && _iconsDir != null)
        {
            var inIcons = Path.Combine(_iconsDir, "arma_assets_dump_fixed.json");
            if (File.Exists(inIcons)) jsonPath = inIcons;
        }

        if (jsonPath != null)
        {
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(jsonPath));
                var root = doc.RootElement;
                if (root.ValueKind == JsonValueKind.Array)
                {
                    // [0] = Markers ([cls, name, iconPath, color])
                    if (root.GetArrayLength() > 0 && root[0].ValueKind == JsonValueKind.Array)
                    {
                        int mIdx = 0;
                        foreach (var el in root[0].EnumerateArray())
                        {
                            if (el.ValueKind == JsonValueKind.Array && el.GetArrayLength() >= 3)
                            {
                                var cls = el[0].GetString() ?? "";
                                var disp = el[1].GetString() ?? "";
                                var paaPath = el[2].GetString() ?? "";
                                RegisterAsset(cls, disp, paaPath);

                                var (defHex, isFullColor) = ParseMarkerDefaultColor(cls, el.GetArrayLength() >= 4 ? el[3] : default);
                                bool hasIcon = ResolveIconFilePath(cls) != null;
                                bool isPureBlack = cls.StartsWith("group_", StringComparison.OrdinalIgnoreCase);

                                Markers.Add(new ArmaMarkerDef(
                                    mIdx,
                                    cls,
                                    string.IsNullOrWhiteSpace(disp) ? cls : disp,
                                    hasIcon,
                                    isFullColor,
                                    isPureBlack,
                                    defHex
                                ));
                            }
                            mIdx++;
                        }
                    }

                    // [1] = MarkerColors ([colorClass, displayName, rgbaArray])
                    if (root.GetArrayLength() > 1 && root[1].ValueKind == JsonValueKind.Array)
                    {
                        int cIdx = 0;
                        foreach (var el in root[1].EnumerateArray())
                        {
                            if (el.ValueKind == JsonValueKind.Array && el.GetArrayLength() >= 3)
                            {
                                var colorCls = el[0].GetString() ?? "";
                                var disp = el[1].GetString() ?? "";
                                var hex = ParseColorArrayToHex(colorCls, el[2]);
                                MarkerColors.Add(new ArmaColorDef(
                                    cIdx,
                                    colorCls,
                                    $"{cIdx:D2}. {disp} ({colorCls})",
                                    hex
                                ));
                            }
                            cIdx++;
                        }
                    }

                    // [2] = Weapons / Magazines / Vehicles ([cls, displayName, picturePath])
                    if (root.GetArrayLength() > 2 && root[2].ValueKind == JsonValueKind.Array)
                    {
                        foreach (var el in root[2].EnumerateArray())
                        {
                            if (el.ValueKind == JsonValueKind.Array && el.GetArrayLength() >= 3)
                            {
                                var cls = el[0].GetString() ?? "";
                                var disp = el[1].GetString() ?? "";
                                var paaPath = el[2].GetString() ?? "";
                                RegisterAsset(cls, disp, paaPath);
                            }
                        }
                    }
                }
                Console.WriteLine($"[ArmaAssets] Загружено классов: {_classToIconFile.Count}, маркеров: {Markers.Count}, цветов: {MarkerColors.Count}, папка иконок: {_iconsDir ?? "не найдена"}");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ArmaAssets] Ошибка чтения JSON: {ex.Message}");
            }
        }
    }

    private static (string Hex, bool IsFullColor) ParseMarkerDefaultColor(string cls, JsonElement colorEl)
    {
        if (colorEl.ValueKind == JsonValueKind.Array && colorEl.GetArrayLength() >= 2)
        {
            var rawStr = colorEl.ToString();
            if (rawStr.Contains("Map_BLUFOR", StringComparison.OrdinalIgnoreCase)) return ("#004d99", false);
            if (rawStr.Contains("Map_OPFOR", StringComparison.OrdinalIgnoreCase)) return ("#800000", false);
            if (rawStr.Contains("Map_Independent", StringComparison.OrdinalIgnoreCase)) return ("#008000", false);
            if (rawStr.Contains("Civilian", StringComparison.OrdinalIgnoreCase)) return ("#660080", false);
            if (rawStr.Contains("Map_Unknown", StringComparison.OrdinalIgnoreCase)) return ("#b39900", false);

            if (colorEl.GetArrayLength() >= 3 &&
                colorEl[0].TryGetDouble(out double r) &&
                colorEl[1].TryGetDouble(out double g) &&
                colorEl[2].TryGetDouble(out double b))
            {
                if (r >= 0.99 && g >= 0.99 && b >= 0.99 && !cls.Equals("White", StringComparison.OrdinalIgnoreCase))
                {
                    return ("#ffffff", true);
                }

                int ri = Math.Clamp((int)Math.Round(r * 255), 0, 255);
                int gi = Math.Clamp((int)Math.Round(g * 255), 0, 255);
                int bi = Math.Clamp((int)Math.Round(b * 255), 0, 255);
                return ($"#{ri:x2}{gi:x2}{bi:x2}", false);
            }
        }
        return ("#000000", false);
    }

    private static string ParseColorArrayToHex(string colorCls, JsonElement colorEl)
    {
        if (colorCls.Equals("Default", StringComparison.OrdinalIgnoreCase)) return "#000000";
        if (colorCls.Equals("colorBLUFOR", StringComparison.OrdinalIgnoreCase)) return "#1d4ed8";
        if (colorCls.Equals("ColorWEST", StringComparison.OrdinalIgnoreCase)) return "#004d99";
        if (colorCls.Equals("colorOPFOR", StringComparison.OrdinalIgnoreCase)) return "#b91c1c";
        if (colorCls.Equals("ColorEAST", StringComparison.OrdinalIgnoreCase)) return "#800000";
        if (colorCls.Equals("colorIndependent", StringComparison.OrdinalIgnoreCase)) return "#15803d";
        if (colorCls.Equals("ColorGUER", StringComparison.OrdinalIgnoreCase)) return "#008000";
        if (colorCls.Equals("colorCivilian", StringComparison.OrdinalIgnoreCase)) return "#7e22ce";
        if (colorCls.Equals("ColorCIV", StringComparison.OrdinalIgnoreCase)) return "#660080";
        if (colorCls.Equals("ColorUNKNOWN", StringComparison.OrdinalIgnoreCase)) return "#b39900";

        if (colorEl.ValueKind == JsonValueKind.Array && colorEl.GetArrayLength() >= 3 &&
            colorEl[0].TryGetDouble(out double r) &&
            colorEl[1].TryGetDouble(out double g) &&
            colorEl[2].TryGetDouble(out double b))
        {
            int ri = Math.Clamp((int)Math.Round(r * 255), 0, 255);
            int gi = Math.Clamp((int)Math.Round(g * 255), 0, 255);
            int bi = Math.Clamp((int)Math.Round(b * 255), 0, 255);
            return ($"#{ri:x2}{gi:x2}{bi:x2}");
        }

        return "#000000";
    }

    private void RegisterAsset(string className, string displayName, string paaPath)
    {
        if (string.IsNullOrWhiteSpace(className)) return;
        if (!string.IsNullOrWhiteSpace(displayName) && !DisplayNames.ContainsKey(className))
        {
            DisplayNames[className] = displayName;
        }

        if (string.IsNullOrWhiteSpace(paaPath) || paaPath.StartsWith("#(")) return;

        var normalized = paaPath.Replace('/', '\\');
        var fileNameNoExt = Path.GetFileNameWithoutExtension(normalized);
        if (string.IsNullOrWhiteSpace(fileNameNoExt) || fileNameNoExt.Equals("clear_empty", StringComparison.OrdinalIgnoreCase))
            return;

        _classToIconFile[className] = fileNameNoExt.ToLowerInvariant() + ".png";
    }

    public string? ResolveIconFilePath(string className)
    {
        if (_iconsDir == null || string.IsNullOrWhiteSpace(className)) return null;

        // 1. Точное совпадение по словарю из дампа
        if (_classToIconFile.TryGetValue(className, out var pngName))
        {
            var full = Path.Combine(_iconsDir, pngName);
            if (File.Exists(full)) return full;
        }

        // 2. Фоллбэк: пробуем имя самого класса (напр. b_inf.png или ak74m_ca.png)
        var direct = Path.Combine(_iconsDir, className.ToLowerInvariant() + ".png");
        if (File.Exists(direct)) return direct;

        var directCa = Path.Combine(_iconsDir, className.ToLowerInvariant() + "_ca.png");
        if (File.Exists(directCa)) return directCa;

        return null;
    }
}

public class MissionStateService
{
    private readonly object _lock = new();
    private PboArchive? _currentArchive;
    private MemoryStream? _currentStream;

    public MissionInfo? CurrentMission { get; private set; }

    public MissionInfo LoadMission(MemoryStream pboStream, string fileName)
    {
        lock (_lock)
        {
            _currentArchive?.Dispose();
            _currentStream?.Dispose();

            _currentStream = pboStream;
            _currentArchive = PboArchive.Open(_currentStream, leaveOpen: true);

            var sqmEntry = _currentArchive.Entries.FirstOrDefault(e =>
                e.FileName.Equals("mission.sqm", StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException("В PBO нет файла mission.sqm");

            var root = RapReader.ReadFromBytes(_currentArchive.GetFileData(sqmEntry));
            CurrentMission = MissionExtractor.Extract(root, _currentArchive, fileName);
            return CurrentMission;
        }
    }

    public byte[]? GetFileBytes(string relativePath)
    {
        lock (_lock)
        {
            if (_currentArchive == null) return null;
            var normalized = relativePath.Replace("/", "\\").TrimStart('\\');
            var entry = _currentArchive.Entries.FirstOrDefault(e =>
                e.FileName.Equals(normalized, StringComparison.OrdinalIgnoreCase));

            return entry != null ? _currentArchive.GetFileData(entry) : null;
        }
    }
}