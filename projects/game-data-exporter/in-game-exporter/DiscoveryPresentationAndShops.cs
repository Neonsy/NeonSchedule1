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

internal static partial class DiscoveryCollector
{
    private static void CollectPresentationCandidates(
        IReadOnlyList<Il2CppScheduleOne.ItemFramework.ItemDefinition> items,
        DiscoveryAssetExporter assets,
        DiscoverySnapshot result)
    {
        var itemById = items
            .Where(x => !string.IsNullOrWhiteSpace(x.ID))
            .GroupBy(x => x.ID, StringComparer.Ordinal)
            .ToDictionary(x => x.Key, x => x.First(), StringComparer.Ordinal);
        var subjects = result.ItemPresentations
            .Where(x => x.Icon is null)
            .Select(x => new PresentationSubject(
                "item",
                x.ItemId,
                itemById.TryGetValue(x.ItemId, out var item)
                    ? item.Name ?? string.Empty
                    : string.Empty))
            .Concat(result.People
                .Where(x => x.Mugshot is null)
                .GroupBy(x => x.PersonId, StringComparer.Ordinal)
                .Select(x => new PresentationSubject(
                    "person",
                    x.Key,
                    x.First().DisplayName)))
            .ToList();
        if (subjects.Count == 0)
        {
            return;
        }

        var sprites = Resources.FindObjectsOfTypeAll<Sprite>();
        foreach (var subject in subjects)
        {
            var tokens = new[] { subject.Id, subject.DisplayName }
                .Concat(subject.DisplayName.Split(' ', StringSplitOptions.RemoveEmptyEntries))
                .Select(NormalizeName)
                .Where(x => x.Length >= 4)
                .Distinct(StringComparer.Ordinal)
                .ToList();
            var candidates = new List<(Sprite Sprite, int Score)>();
            for (var spriteIndex = 0; spriteIndex < sprites.Length; spriteIndex++)
            {
                var sprite = sprites[spriteIndex];
                if (sprite is null)
                {
                    continue;
                }

                var spriteName = NormalizeName(sprite.name ?? string.Empty);
                var textureName = NormalizeName(sprite.texture?.name ?? string.Empty);
                var score = tokens
                    .Select(token => spriteName == token || textureName == token
                        ? 100
                        : spriteName.Contains(token, StringComparison.Ordinal) ||
                          textureName.Contains(token, StringComparison.Ordinal)
                            ? 50 + token.Length
                            : 0)
                    .DefaultIfEmpty()
                    .Max();
                if (score > 0)
                {
                    candidates.Add((sprite, score));
                }
            }

            var ranked = candidates
                .OrderByDescending(x => x.Score)
                .ThenBy(x => x.Sprite.name, StringComparer.Ordinal)
                .Take(12)
                .ToList();
            for (var rank = 0; rank < ranked.Count; rank++)
            {
                var candidate = ranked[rank];
                result.PresentationAssetCandidates.Add(
                    new DiscoveryPresentationAssetCandidateSnapshot
                    {
                        SubjectKind = subject.Kind,
                        SubjectId = subject.Id,
                        DisplayName = subject.DisplayName,
                        MatchScore = candidate.Score,
                        SpriteName = candidate.Sprite.name ?? string.Empty,
                        TextureName = candidate.Sprite.texture?.name ?? string.Empty,
                        Asset = assets.ExportSprite(
                            candidate.Sprite,
                            "presentation-candidates",
                            $"{subject.Kind}-{subject.Id}-{rank + 1}"),
                    });
            }
        }
    }

    private static string NormalizeName(string value) => string.Concat(
        value.Where(char.IsLetterOrDigit).Select(char.ToLowerInvariant));

    private sealed record PresentationSubject(string Kind, string Id, string DisplayName);

    private static void CollectShops(DiscoverySnapshot result)
    {
        var shops = Il2CppScheduleOne.UI.Shop.ShopInterface.AllShops;
        if (shops is null)
        {
            return;
        }

        for (var index = 0; index < shops.Count; index++)
        {
            var shop = shops[index];
            if (shop is null)
            {
                continue;
            }

            var holder = FindShopHolder(shop);
            var scheduleAction = holder is null
                ? null
                : FindShopScheduleAction(result, holder.InstanceKey, shop);
            var location = scheduleAction?.Location;
            var locationSource = location is null ? string.Empty : "shopkeeper-schedule";
            VectorSnapshot3? physicalPosition = location?.Position;
            VectorSnapshot3? physicalRotation = location?.Rotation;
            var physicalSceneName = holder?.SceneName ?? string.Empty;

            if (physicalPosition is null && shop.DeliveryBays is not null)
            {
                for (var bayIndex = 0; bayIndex < shop.DeliveryBays.Count; bayIndex++)
                {
                    var bay = shop.DeliveryBays[bayIndex];
                    if (bay is null || !DiscoveryReflection.IsSceneObject(bay.gameObject))
                    {
                        continue;
                    }

                    physicalPosition = VectorSnapshot3.FromVector(bay.transform.position);
                    physicalRotation = VectorSnapshot3.FromVector(bay.transform.eulerAngles);
                    physicalSceneName = bay.gameObject.scene.name;
                    locationSource = "delivery-bay";
                    break;
                }
            }

            if (holder?.IsSupplier == true && physicalPosition is null)
            {
                locationSource = "supplier-phone-interface";
            }

            var detail = new DiscoveryShopDetailSnapshot
            {
                Code = shop.ShopCode ?? string.Empty,
                Name = shop.ShopName ?? string.Empty,
                Description = shop.ShopDescription ?? string.Empty,
                PaymentType = shop.PaymentType.ToString(),
                Position = physicalPosition,
                Rotation = physicalRotation,
                SceneName = physicalSceneName,
                InterfaceTransform = TransformSnapshot.FromTransform(shop.transform),
                LocationSource = locationSource,
                HolderPersonId = holder?.PersonId ?? string.Empty,
                HolderInstanceKey = holder?.InstanceKey ?? string.Empty,
                HolderRuntimeType = holder?.RuntimeType ?? string.Empty,
                OpenTime = scheduleAction?.StartTime,
                CloseTime = scheduleAction?.EndTime,
                DeliveryBayCount = shop.DeliveryBays?.Count ?? 0,
                State = DiscoveryReflection.DescribeValue(shop.State),
                StateMembers = DiscoveryReflection.ReadMembers(
                    shop.State,
                    "OpenTime",
                    "CloseTime",
                    "OpeningTime",
                    "ClosingTime",
                    "IsOpen",
                    "Enabled"),
            };
            if (shop.DeliveryBays is not null)
            {
                for (var bayIndex = 0; bayIndex < shop.DeliveryBays.Count; bayIndex++)
                {
                    var bay = shop.DeliveryBays[bayIndex];
                    if (bay is not null)
                    {
                        detail.DeliveryBayPositions.Add(
                            VectorSnapshot3.FromVector(bay.transform.position));
                    }
                }
            }
            result.ShopDetails.Add(detail);
            result.Locations.Add(new DiscoveryLocationSnapshot
            {
                Kind = "shop",
                Id = detail.HolderInstanceKey.Length > 0
                    ? $"{detail.Code}:{detail.HolderInstanceKey}"
                    : detail.Code,
                Name = detail.Name,
                Description = detail.Description,
                RuntimeType = shop.GetType().FullName ?? string.Empty,
                Position = detail.Position,
                Rotation = detail.Rotation,
                SceneName = detail.SceneName,
                PersonId = detail.HolderPersonId,
            });
        }
    }

    private static ShopHolderSnapshot? FindShopHolder(
        Il2CppScheduleOne.UI.Shop.ShopInterface shop)
    {
        var people = Il2CppScheduleOne.NPCs.NPCManager.NPCRegistry;
        var candidates = new List<Il2CppScheduleOne.NPCs.NPC>();
        if (people is not null)
        {
            for (var index = 0; index < people.Count; index++)
            {
                var person = people[index];
                if (person is not null)
                {
                    candidates.Add(person);
                }
            }
        }
        var steves = Resources.FindObjectsOfTypeAll<
            Il2CppScheduleOne.NPCs.CharacterClasses.Steve>();
        for (var index = 0; index < steves.Length; index++)
        {
            var steve = steves[index];
            if (steve is not null && candidates.All(candidate =>
                    candidate.GetInstanceID() != steve.GetInstanceID()))
            {
                candidates.Add(steve);
            }
        }

        foreach (var person in candidates)
        {
            if (person is null)
            {
                continue;
            }

            Il2CppScheduleOne.UI.Shop.ShopInterface? ownedShop = null;
            var supplier = person.GetComponent<Il2CppScheduleOne.Economy.Supplier>();
            if (supplier is not null)
            {
                ownedShop = supplier.Shop;
            }
            ownedShop ??= person.TryCast<
                Il2CppScheduleOne.NPCs.CharacterClasses.Albert>()?.Shop;
            ownedShop ??= person.TryCast<
                Il2CppScheduleOne.NPCs.CharacterClasses.Dan>()?.ShopInterface;
            ownedShop ??= person.TryCast<
                Il2CppScheduleOne.NPCs.CharacterClasses.Fiona>()?.ShopInterface;
            ownedShop ??= person.TryCast<
                Il2CppScheduleOne.NPCs.CharacterClasses.Herbert>()?.ShopInterface;
            ownedShop ??= person.TryCast<
                Il2CppScheduleOne.NPCs.CharacterClasses.Oscar>()?.ShopInterface;
            ownedShop ??= person.TryCast<
                Il2CppScheduleOne.NPCs.CharacterClasses.Phil>()?.Shop;
            ownedShop ??= person.TryCast<
                Il2CppScheduleOne.NPCs.CharacterClasses.Salvador>()?.Shop;
            ownedShop ??= person.TryCast<
                Il2CppScheduleOne.NPCs.CharacterClasses.Shirley>()?.Shop;
            ownedShop ??= person.TryCast<
                Il2CppScheduleOne.NPCs.CharacterClasses.Steve>()?.ShopInterface;
            ownedShop ??= person.TryCast<Il2CppScheduleOne.NPCs.Stan>()?.ShopInterface;
            if (ownedShop is null || ownedShop.GetInstanceID() != shop.GetInstanceID())
            {
                continue;
            }

            var objectPath = DiscoveryReflection.ObjectPath(person.transform);
            return new ShopHolderSnapshot
            {
                PersonId = person.ID,
                InstanceKey = $"{person.ID}:{objectPath}",
                RuntimeType = DiscoveryReflection.RuntimeTypeName(person),
                SceneName = person.gameObject.scene.name,
                IsSupplier = supplier is not null,
            };
        }

        return null;
    }

    private static DiscoveryNpcScheduleActionSnapshot? FindShopScheduleAction(
        DiscoverySnapshot result,
        string holderInstanceKey,
        Il2CppScheduleOne.UI.Shop.ShopInterface shop)
    {
        var schedule = result.NpcSchedules.FirstOrDefault(candidate =>
            candidate.PersonInstanceKey == holderInstanceKey);
        if (schedule is null)
        {
            return null;
        }

        var shopTokens = new[] { shop.ShopCode, shop.ShopName }
            .Where(token => !string.IsNullOrWhiteSpace(token))
            .Select(token => NormalizeName(token!))
            .Where(token => token.Length >= 3)
            .Distinct(StringComparer.Ordinal)
            .ToList();
        return schedule.Actions
            .Where(action => action.Location is not null)
            .Select(action => new
            {
                Action = action,
                Score = ShopActionScore(action, shopTokens),
            })
            .Where(candidate => candidate.Score > 0)
            .OrderByDescending(candidate => candidate.Score)
            .ThenByDescending(candidate => DailyDuration(
                candidate.Action.StartTime,
                candidate.Action.EndTime))
            .ThenBy(candidate => candidate.Action.StartTime)
            .Select(candidate => candidate.Action)
            .FirstOrDefault();
    }

    private static int ShopActionScore(
        DiscoveryNpcScheduleActionSnapshot action,
        IReadOnlyList<string> shopTokens)
    {
        var locationText = NormalizeName(
            $"{action.Location?.Member} {action.Location?.ObjectName} " +
            $"{action.Location?.ObjectPath}");
        var actionText = NormalizeName($"{action.Name} {action.TimeDescription}");
        var score = 0;
        if (locationText.Contains("standpoint", StringComparison.Ordinal) ||
            locationText.Contains("shopstand", StringComparison.Ordinal))
        {
            score += 100;
        }
        if (actionText.Contains("shop", StringComparison.Ordinal) ||
            actionText.Contains("work", StringComparison.Ordinal))
        {
            score += 35;
        }
        foreach (var token in shopTokens)
        {
            if (locationText.Contains(token, StringComparison.Ordinal))
            {
                score += 50;
            }
            if (actionText.Contains(token, StringComparison.Ordinal))
            {
                score += 25;
            }
        }
        return score;
    }

    private static int DailyDuration(int startTime, int endTime)
    {
        var startMinutes = ((startTime / 100) * 60) + (startTime % 100);
        var endMinutes = ((endTime / 100) * 60) + (endTime % 100);
        return endMinutes >= startMinutes
            ? endMinutes - startMinutes
            : (24 * 60) - startMinutes + endMinutes;
    }

    private sealed class ShopHolderSnapshot
    {
        public string PersonId { get; init; } = string.Empty;
        public string InstanceKey { get; init; } = string.Empty;
        public string RuntimeType { get; init; } = string.Empty;
        public string SceneName { get; init; } = string.Empty;
        public bool IsSupplier { get; init; }
    }

    private static void AssociateTimedAccessZones(DiscoverySnapshot result)
    {
        foreach (var zone in result.TimedAccessZones)
        {
            if (zone.Position is null)
            {
                continue;
            }

            zone.NearestShops = result.ShopDetails
                .Where(x => x.Position is not null)
                .Select(x => new DiscoveryNearbyShopSnapshot
                {
                    ShopCode = x.Code,
                    Distance = Distance(zone.Position, x.Position!),
                })
                .OrderBy(x => x.Distance)
                .ThenBy(x => x.ShopCode, StringComparer.Ordinal)
                .Take(3)
                .ToList();
        }
    }

    private static float Distance(VectorSnapshot3 left, VectorSnapshot3 right)
    {
        var x = left.X - right.X;
        var y = left.Y - right.Y;
        var z = left.Z - right.Z;
        return MathF.Sqrt((x * x) + (y * y) + (z * z));
    }
}
