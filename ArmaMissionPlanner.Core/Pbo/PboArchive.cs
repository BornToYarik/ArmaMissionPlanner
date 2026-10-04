using System.Text;

namespace ArmaMissionPlanner.Core.Pbo;

public class PboArchive : IDisposable
{
    private readonly Stream _stream;
    private readonly bool _leaveOpen;
    private readonly List<PboEntry> _entries = new();

    public IReadOnlyList<PboEntry> Entries => _entries;

    private PboArchive(Stream stream, bool leaveOpen = false)
    {
        _stream = stream;
        _leaveOpen = leaveOpen;
    }

    public static PboArchive Open(string filePath)
    {
        var fileStream = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read);
        var archive = new PboArchive(fileStream);
        archive.ReadHeader();
        return archive;
    }

    public static PboArchive Open(Stream stream, bool leaveOpen = false)
    {
        var archive = new PboArchive(stream, leaveOpen);
        archive.ReadHeader();
        return archive;
    }

    private void ReadHeader()
    {
        using var reader = new BinaryReader(_stream, Encoding.UTF8, leaveOpen: true);

        while (true)
        {
            var entry = ReadEntryHeader(reader);
            if (entry == null) break;

            // Если это расширенный заголовок (метаданные PBO, имя пустое, но PackingMethod == 0x56657273 ('sreV'))
            if (entry.IsEmpty && entry.PackingMethod == 0x56657273)
            {
                // Пропускаем метаданные до двух нулевых байт подряд
                SkipHeaderExtension(reader);
                continue;
            }

            // Пустая запись с нулями — признак конца заголовка
            if (entry.IsEmpty)
            {
                break;
            }

            _entries.Add(entry);
        }

        // Вычисляем смещения данных в файле
        long currentOffset = _stream.Position;
        foreach (var entry in _entries)
        {
            entry.DataOffset = currentOffset;
            currentOffset += entry.DataSize;
        }
    }

    private static PboEntry? ReadEntryHeader(BinaryReader reader)
    {
        var nameBytes = new List<byte>();
        byte b;
        
        while ((b = reader.ReadByte()) != 0)
        {
            nameBytes.Add(b);
        }

        var fileName = Encoding.UTF8.GetString(nameBytes.ToArray());

        var packingMethod = reader.ReadUInt32();
        var originalSize = reader.ReadUInt32();
        var reserved = reader.ReadUInt32();
        var timestamp = reader.ReadUInt32();
        var dataSize = reader.ReadUInt32();

        return new PboEntry
        {
            FileName = fileName,
            PackingMethod = packingMethod,
            OriginalSize = originalSize,
            Reserved = reserved,
            Timestamp = timestamp,
            DataSize = dataSize
        };
    }

    private static void SkipHeaderExtension(BinaryReader reader)
    {
        while (true)
        {
            byte b1 = reader.ReadByte();
            if (b1 == 0)
            {
                // Конец блока пар ключ-значение
                break;
            }
            // Пропускаем ключ
            while (reader.ReadByte() != 0) { }
            // Пропускаем значение
            while (reader.ReadByte() != 0) { }
        }
    }

    public byte[] GetFileData(PboEntry entry)
    {
        _stream.Seek(entry.DataOffset, SeekOrigin.Begin);
        var buffer = new byte[entry.DataSize];
        _stream.ReadExactly(buffer, 0, (int)entry.DataSize);
        return buffer;
    }

    public string GetFileContentAsString(string fileName)
    {
        var entry = _entries.FirstOrDefault(e => 
            e.FileName.Equals(fileName, StringComparison.OrdinalIgnoreCase));

        if (entry == null)
            throw new FileNotFoundException($"Файл {fileName} не найден в PBO архиве.");

        var bytes = GetFileData(entry);
        return Encoding.UTF8.GetString(bytes);
    }

    public void Dispose()
    {
        if (!_leaveOpen)
        {
            _stream.Dispose();
        }
    }
}