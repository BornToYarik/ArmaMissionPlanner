namespace ArmaMissionPlanner.Core.Pbo;

public class PboEntry
{
    public string FileName { get; set; } = string.Empty;
    public uint PackingMethod { get; set; }
    public uint OriginalSize { get; set; }
    public uint Reserved { get; set; }
    public uint Timestamp { get; set; }
    public uint DataSize { get; set; }
    
    // Смещение начала содержимого файла относительно начала PBO потока
    public long DataOffset { get; set; }

    public bool IsEmpty => string.IsNullOrEmpty(FileName);
}