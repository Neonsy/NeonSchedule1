using System.Reflection;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Il2CppInterop.Runtime;
using MelonLoader;
using S1API.Lifecycle;
using UnityEngine;
using Effect = Il2CppScheduleOne.Effects.Effect;
using EffectList = Il2CppSystem.Collections.Generic.List<Il2CppScheduleOne.Effects.Effect>;
using EffectMixCalculator = Il2CppScheduleOne.Effects.EffectMixCalculator;
using DrugType = Il2CppScheduleOne.Product.EDrugType;
using NativeProductManager = Il2CppScheduleOne.Product.ProductManager;
using NativePropertyUtility = Il2CppScheduleOne.Product.PropertyUtility;

namespace NeonSchedule1.GameDataExporter;

internal static class ExportJson
{
    internal static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        NumberHandling = JsonNumberHandling.Strict,
    };
}
