using System.Reflection;
using System.Security.Cryptography;
using System.Globalization;
using System.Text;
using Il2CppInterop.Runtime;
using Unity.AI.Navigation;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.UI;

namespace NeonSchedule1.GameDataExporter;

internal static class DiscoveryReflection
{
    internal static string RuntimeTypeName(Il2CppSystem.Object? value)
    {
        if (value is null)
        {
            return string.Empty;
        }

        try
        {
            return value.GetIl2CppType()?.FullName ??
                   value.GetType().FullName ??
                   string.Empty;
        }
        catch
        {
            return value.GetType().FullName ?? string.Empty;
        }
    }

    internal static Dictionary<string, string> ReadMembers(object? instance, params string[] names)
    {
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        if (instance is null)
        {
            return result;
        }

        var type = instance.GetType();
        foreach (var name in names)
        {
            try
            {
                var property = type.GetProperty(name, BindingFlags.Instance | BindingFlags.Public);
                if (property is not null && property.GetIndexParameters().Length == 0)
                {
                    result[name] = DescribeValue(property.GetValue(instance));
                    continue;
                }

                var field = type.GetField(name, BindingFlags.Instance | BindingFlags.Public);
                if (field is not null)
                {
                    result[name] = DescribeValue(field.GetValue(instance));
                }
            }
            catch (Exception exception)
            {
                result[name] = $"error:{exception.GetType().Name}";
            }
        }

        return result;
    }

    internal static DiscoveryLocationReferenceSnapshot? FindLocation(
        object instance,
        params string[] names)
    {
        var type = instance.GetType();
        foreach (var name in names)
        {
            object? value = null;
            try
            {
                value = type.GetProperty(name, BindingFlags.Instance | BindingFlags.Public)
                    ?.GetValue(instance);
                value ??= type.GetField(name, BindingFlags.Instance | BindingFlags.Public)
                    ?.GetValue(instance);
            }
            catch
            {
                continue;
            }

            var transform = TransformFromValue(value);
            if (transform is not null)
            {
                return new DiscoveryLocationReferenceSnapshot
                {
                    Member = name,
                    ObjectName = transform.name ?? string.Empty,
                    ObjectPath = ObjectPath(transform),
                    Position = VectorSnapshot3.FromVector(transform.position),
                    Rotation = VectorSnapshot3.FromVector(transform.eulerAngles),
                };
            }
        }

        return null;
    }

    internal static string DescribeValue(object? value)
    {
        if (value is null)
        {
            return string.Empty;
        }

        if (value is Transform transform)
        {
            return $"transform:{ObjectPath(transform)}@{VectorSnapshot3.FromVector(transform.position)}";
        }

        if (value is Component component)
        {
            return $"component:{component.GetType().FullName}:{ObjectPath(component.transform)}";
        }

        if (value is GameObject gameObject)
        {
            return $"gameObject:{ObjectPath(gameObject.transform)}";
        }

        if (value is Vector2 vector2)
        {
            return $"({vector2.x:R},{vector2.y:R})";
        }

        if (value is Vector3 vector3)
        {
            return $"({vector3.x:R},{vector3.y:R},{vector3.z:R})";
        }

        if (value is Vector4 vector4)
        {
            return $"({vector4.x:R},{vector4.y:R},{vector4.z:R},{vector4.w:R})";
        }

        if (value is Color color)
        {
            return $"#{ColorUtility.ToHtmlStringRGBA(color)}";
        }

        return Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture)
            ?? value.GetType().FullName
            ?? string.Empty;
    }

    internal static string DescribeUnityObject(UnityEngine.Object? value)
    {
        if (value is null)
        {
            return string.Empty;
        }

        var transform = TransformFromValue(value);
        return transform is null
            ? $"{value.GetType().FullName}:{value.name}"
            : $"{value.GetType().FullName}:{ObjectPath(transform)}@{VectorSnapshot3.FromVector(transform.position)}";
    }

    internal static Transform? TransformFromValue(object? value) => value switch
    {
        Transform transform => transform,
        Component component => component.transform,
        GameObject gameObject => gameObject.transform,
        _ => null,
    };

    internal static bool IsSceneObject(GameObject gameObject) =>
        gameObject.scene.IsValid() && gameObject.scene.isLoaded;

    internal static string ObjectPath(Transform? transform)
    {
        if (transform is null)
        {
            return string.Empty;
        }

        var parts = new List<string>();
        var current = transform;
        while (current is not null)
        {
            parts.Add(current.name ?? string.Empty);
            current = current.parent;
        }

        parts.Reverse();
        return string.Join('/', parts);
    }
}
