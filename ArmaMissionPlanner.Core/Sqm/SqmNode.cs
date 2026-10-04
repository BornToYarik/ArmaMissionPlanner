namespace ArmaMissionPlanner.Core.Sqm;

public abstract class SqmNode
{
    public string Name { get; set; } = string.Empty;
}

public class SqmClass : SqmNode
{
    public List<SqmNode> Children { get; } = new();

    public SqmProperty? GetProperty(string name) =>
        Children.OfType<SqmProperty>().FirstOrDefault(p => p.Name.Equals(name, StringComparison.OrdinalIgnoreCase));

    public SqmClass? GetClass(string name) =>
        Children.OfType<SqmClass>().FirstOrDefault(c => c.Name.Equals(name, StringComparison.OrdinalIgnoreCase));

    public IEnumerable<SqmClass> GetClasses(string name) =>
        Children.OfType<SqmClass>().Where(c => c.Name.Equals(name, StringComparison.OrdinalIgnoreCase));
}

public class SqmProperty : SqmNode
{
    public object? Value { get; set; }

    public string AsString() => Value?.ToString() ?? string.Empty;
    public int AsInt() => Value is int i ? i : Convert.ToInt32(Value);
    public float AsFloat() => Value is float f ? f : Convert.ToSingle(Value);
    public object[] AsArray() => Value as object[] ?? Array.Empty<object>();
}