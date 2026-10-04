using System.Text;

namespace ArmaMissionPlanner.Core.Sqm;

public class RapReader
{
    private readonly BinaryReader _reader;
    private readonly Stream _stream;

    public RapReader(Stream stream)
    {
        _stream = stream;
        _reader = new BinaryReader(stream, Encoding.UTF8, leaveOpen: true);
    }

    public static SqmClass ReadFromBytes(byte[] data)
    {
        using var ms = new MemoryStream(data);
        var reader = new RapReader(ms);
        return reader.Parse();
    }

    public SqmClass Parse()
{
    _stream.Seek(0, SeekOrigin.Begin);

    byte b0 = _reader.ReadByte();
    byte b1 = _reader.ReadByte();
    byte b2 = _reader.ReadByte();
    byte b3 = _reader.ReadByte();

    if (b0 != 0 || b1 != 'r' || b2 != 'a' || b3 != 'P')
        throw new InvalidDataException("Файл не является бинарным RAP");

    // Заголовок RAP: 4 байта сигнатура + 12 байт системные
    _reader.ReadUInt32(); // 0x00000000
    _reader.ReadUInt32(); // 0x00000008
    uint enumOffset = _reader.ReadUInt32(); // 0x00041676

    var root = new SqmClass { Name = "Root" };
    ReadClassContent(root);
    return root;
}

private void ReadClassContent(SqmClass currentClass)
{
    string baseClass = ReadAsciiz();
    int entriesCount = ReadCompressedInt();

    var subClassesToRead = new List<(string Name, uint Offset)>();

    for (int i = 0; i < entriesCount; i++)
    {
        byte entryType = _reader.ReadByte();

        if (entryType == 0) // Подкласс (Class)
        {
            string className = ReadAsciiz();
            uint bodyOffset = _reader.ReadUInt32();
            subClassesToRead.Add((className, bodyOffset));
        }
        else if (entryType == 1) // Простое свойство (Property)
        {
            byte varType = _reader.ReadByte();
            string propName = ReadAsciiz();
            var prop = new SqmProperty { Name = propName };

            switch (varType)
            {
                case 0: // String
                    prop.Value = ReadAsciiz();
                    break;
                case 1: // Float
                    prop.Value = _reader.ReadSingle();
                    break;
                case 2: // Int32
                    prop.Value = _reader.ReadInt32();
                    break;
                default:
                    throw new NotSupportedException($"Неизвестный тип значения: {varType} в свойстве {propName}");
            }

            currentClass.Children.Add(prop);
        }
        else if (entryType == 2) // Массив (Array Property: имя[] = { ... })
        {
            string propName = ReadAsciiz();
            int arrayLen = ReadCompressedInt();
            var arr = new object[arrayLen];

            for (int a = 0; a < arrayLen; a++)
            {
                // В бинарном RAP элементы массива часто имеют явный маркер типа (0 - строка, 1 - float, 2 - int)
                // Если тип не указан, для строк читаем Asciiz. Проверим тип первого байта элемента:
                byte elemType = _reader.ReadByte();
                arr[a] = elemType switch
                {
                    0 => ReadAsciiz(),
                    1 => _reader.ReadSingle(),
                    2 => _reader.ReadInt32(),
                    _ => throw new NotSupportedException($"Неизвестный тип элемента массива {propName}[{a}]: {elemType}")
                };
            }

            var prop = new SqmProperty
            {
                Name = propName,
                Value = arr
            };
            currentClass.Children.Add(prop);
        }
    }

    // Сохраняем позицию конца объявлений заголовков
    long returnPos = _stream.Position;

    // Рекурсивно читаем все найденные подклассы
    foreach (var (subClassName, offset) in subClassesToRead)
    {
        _stream.Seek(offset, SeekOrigin.Begin);
        var subClass = new SqmClass { Name = subClassName };
        currentClass.Children.Add(subClass);
        ReadClassContent(subClass);
    }

    _stream.Seek(returnPos, SeekOrigin.Begin);
}

    private string ReadAsciiz()
    {
        var bytes = new List<byte>();
        byte b;
        while ((b = _reader.ReadByte()) != 0)
        {
            bytes.Add(b);
        }
        return Encoding.UTF8.GetString(bytes.ToArray());
    }

    private int ReadCompressedInt()
    {
        int result = 0;
        int shift = 0;
        while (true)
        {
            byte b = _reader.ReadByte();
            result |= (b & 0x7F) << shift;
            if ((b & 0x80) == 0)
                break;
            shift += 7;
        }
        return result;
    }
}