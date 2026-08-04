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
    private static void CollectProperties(
        DiscoveryAssetExporter assets,
        DiscoveryVisualAssetRegistry visualAssets,
        DiscoverySnapshot result,
        Action<string>? progress)
    {
        var properties = Il2CppScheduleOne.Property.Property.Properties;
        if (properties is null)
        {
            return;
        }

        var allLoadingDocks = Resources.FindObjectsOfTypeAll<
            Il2CppScheduleOne.Delivery.LoadingDock>();

        for (var propertyIndex = 0; propertyIndex < properties.Count; propertyIndex++)
        {
            var property = properties[propertyIndex];
            if (property is null || string.IsNullOrWhiteSpace(property.PropertyCode))
            {
                continue;
            }

            var layout = new DiscoveryPropertyLayoutSnapshot
            {
                PropertyCode = property.PropertyCode,
                PropertyName = property.PropertyName ?? string.Empty,
                Position = VectorSnapshot3.FromVector(property.transform.position),
                Rotation = VectorSnapshot3.FromVector(property.transform.eulerAngles),
                SpawnPoint = TransformSnapshot.FromTransform(property.SpawnPoint),
                InteriorSpawnPoint = TransformSnapshot.FromTransform(property.InteriorSpawnPoint),
                NpcSpawnPoint = TransformSnapshot.FromTransform(property.NPCSpawnPoint),
                BoundingBox = ColliderSnapshot.FromCollider(
                    property.BoundingBox?.GetComponent<Collider>()),
                Visuals = CollectVisuals(
                    property.gameObject,
                    "properties",
                    property.PropertyCode,
                    assets,
                    visualAssets),
            };

            var colliders = property.GetComponentsInChildren<Collider>(true);
            for (var colliderIndex = 0; colliderIndex < colliders.Length; colliderIndex++)
            {
                var nativeCollider = colliders[colliderIndex];
                var collider = ColliderSnapshot.FromCollider(nativeCollider);
                if (collider is null)
                {
                    continue;
                }

                collider.Source = nativeCollider.GetComponentInParent<
                        Il2CppScheduleOne.EntityFramework.BuildableItem>() is null
                    ? "property-fixed"
                    : "placed-buildable";
                var meshCollider = nativeCollider.TryCast<MeshCollider>();
                if (meshCollider?.sharedMesh is not null)
                {
                    visualAssets.RegisterMesh(meshCollider.sharedMesh);
                }
                layout.Colliders.Add(collider);
            }

            var surfaces = property.GetComponentsInChildren<
                Il2CppScheduleOne.Building.Surface>(true);
            for (var surfaceIndex = 0; surfaceIndex < surfaces.Length; surfaceIndex++)
            {
                var surface = surfaces[surfaceIndex];
                if (surface is null)
                {
                    continue;
                }

                var surfaceSnapshot = new DiscoverySurfaceSnapshot
                {
                    Guid = surface.GUID.ToString(),
                    SurfaceType = surface.SurfaceType.ToString(),
                    Transform = TransformSnapshot.FromTransform(surface.transform),
                    Container = TransformSnapshot.FromTransform(surface.Container),
                };
                if (surface.ValidFaces is not null)
                {
                    for (var faceIndex = 0; faceIndex < surface.ValidFaces.Count; faceIndex++)
                    {
                        surfaceSnapshot.ValidFaces.Add(surface.ValidFaces[faceIndex].ToString());
                    }
                }

                layout.Surfaces.Add(surfaceSnapshot);
            }

            for (var dockIndex = 0; dockIndex < allLoadingDocks.Length; dockIndex++)
            {
                var dock = allLoadingDocks[dockIndex];
                if (dock is null || !DiscoveryReflection.IsSceneObject(dock.gameObject))
                {
                    continue;
                }

                var parentPropertyCode = dock.ParentProperty?.PropertyCode ?? string.Empty;
                var belongsToProperty = string.Equals(
                    parentPropertyCode,
                    property.PropertyCode,
                    StringComparison.OrdinalIgnoreCase);
                if (!belongsToProperty && parentPropertyCode.Length == 0)
                {
                    belongsToProperty = dock.transform.IsChildOf(property.transform);
                }
                if (!belongsToProperty)
                {
                    continue;
                }

                layout.LoadingDocks.Add(CreateLoadingDockSnapshot(dock));
            }

            if (property.propertyBoundsColliders is not null)
            {
                for (var colliderIndex = 0;
                     colliderIndex < property.propertyBoundsColliders.Count;
                     colliderIndex++)
                {
                    var collider = ColliderSnapshot.FromCollider(
                        property.propertyBoundsColliders[colliderIndex]);
                    if (collider is not null)
                    {
                        collider.Source = "property-boundary";
                        layout.BoundaryColliders.Add(collider);
                    }
                }
            }

            if (property.Grids is not null)
            {
                for (var gridIndex = 0; gridIndex < property.Grids.Count; gridIndex++)
                {
                    var grid = property.Grids[gridIndex];
                    if (grid is null)
                    {
                        continue;
                    }

                    var gridSnapshot = new DiscoveryGridSnapshot
                    {
                        Guid = grid.GUID.ToString(),
                        Width = grid.Width,
                        Height = grid.Height,
                        TileSize = Il2CppScheduleOne.Tiles.Grid.TileSize,
                        Origin = VectorSnapshot3.FromVector(grid.Origin),
                    };

                    if (grid.CoordinateTilePairs is not null)
                    {
                        for (var pairIndex = 0;
                             pairIndex < grid.CoordinateTilePairs.Count;
                             pairIndex++)
                        {
                            var pair = grid.CoordinateTilePairs[pairIndex];
                            if (pair?.coord is null || pair.tile is null)
                            {
                                continue;
                            }

                            gridSnapshot.Tiles.Add(new DiscoveryGridTileSnapshot
                            {
                                X = pair.coord.x,
                                Y = pair.coord.y,
                                AvailableOffset = pair.tile.AvailableOffset,
                                Position = VectorSnapshot3.FromVector(pair.tile.transform.position),
                                Rotation = VectorSnapshot3.FromVector(pair.tile.transform.eulerAngles),
                                BuildableOccupantCount = pair.tile.BuildableOccupants?.Count ?? 0,
                                TileTemperature = pair.tile.TileTemperature,
                            });
                        }
                    }

                    gridSnapshot.Tiles = gridSnapshot.Tiles
                        .OrderBy(x => x.X)
                        .ThenBy(x => x.Y)
                        .ToList();
                    layout.Grids.Add(gridSnapshot);
                }
            }

            if (property.BuildableItems is not null)
            {
                for (var itemIndex = 0;
                     itemIndex < property.BuildableItems.Count;
                     itemIndex++)
                {
                    var item = property.BuildableItems[itemIndex];
                    if (item is null)
                    {
                        continue;
                    }

                    layout.ItemsInLoadedSave.Add(new DiscoveryPlacedItemSnapshot
                    {
                        ItemId = item.ItemInstance?.Definition?.ID ?? string.Empty,
                        RuntimeType = item.GetType().FullName ?? string.Empty,
                        Position = VectorSnapshot3.FromVector(item.transform.position),
                        Rotation = VectorSnapshot3.FromVector(item.transform.eulerAngles),
                    });
                }
            }

            result.PropertyLayouts.Add(layout);
            result.Locations.Add(new DiscoveryLocationSnapshot
            {
                Kind = "property",
                Id = property.PropertyCode,
                Name = property.PropertyName ?? string.Empty,
                RuntimeType = property.GetType().FullName ?? string.Empty,
                Position = VectorSnapshot3.FromVector(property.transform.position),
                Rotation = VectorSnapshot3.FromVector(property.transform.eulerAngles),
                SceneName = property.gameObject.scene.name,
            });
            progress?.Invoke(
                $"Discovery 6/9 progress: {propertyIndex + 1}/{properties.Count} properties.");
        }
    }

    private static DiscoveryLoadingDockSnapshot CreateLoadingDockSnapshot(
        Il2CppScheduleOne.Delivery.LoadingDock dock)
    {
        var snapshot = new DiscoveryLoadingDockSnapshot
        {
            Guid = dock.GUID.ToString(),
            Name = dock.Name ?? string.Empty,
            ParentPropertyCode = dock.ParentProperty?.PropertyCode ?? string.Empty,
            Transform = TransformSnapshot.FromTransform(dock.transform),
            ParkingTransform = TransformSnapshot.FromTransform(dock.Parking?.transform),
            InputSlotCount = dock.InputSlots?.Count ?? 0,
            OutputSlotCount = dock.OutputSlots?.Count ?? 0,
        };
        if (dock.AccessPoints is not null)
        {
            for (var accessIndex = 0; accessIndex < dock.AccessPoints.Length; accessIndex++)
            {
                snapshot.AccessPoints.Add(
                    TransformSnapshot.FromTransform(dock.AccessPoints[accessIndex]));
            }
        }

        return snapshot;
    }

    private static void CollectPeople(
        DiscoveryAssetExporter assets,
        DiscoveryVisualAssetRegistry visualAssets,
        DiscoverySnapshot result,
        Action<string>? progress)
    {
        var people = Il2CppScheduleOne.NPCs.NPCManager.NPCRegistry;
        if (people is null)
        {
            return;
        }

        for (var personIndex = 0; personIndex < people.Count; personIndex++)
        {
            var person = people[personIndex];
            if (person is null || string.IsNullOrWhiteSpace(person.ID))
            {
                continue;
            }

            var objectPath = DiscoveryReflection.ObjectPath(person.transform);
            var instanceKey = $"{person.ID}:{objectPath}";
            var mugshot = assets.ExportSprite(person.MugshotSprite, "people", person.ID);
            result.People.Add(new DiscoveryPersonPresentationSnapshot
            {
                PersonId = person.ID,
                InstanceKey = instanceKey,
                RuntimeInstanceId = person.GetInstanceID(),
                DisplayName = person.FullName ?? string.Empty,
                ObjectPath = objectPath,
                Mugshot = mugshot,
                ModelVisuals = mugshot is null
                    ? CollectVisuals(
                        person.gameObject,
                        "people-models",
                        instanceKey,
                        assets,
                        visualAssets)
                    : new DiscoveryVisualCollectionSnapshot(),
                PositionInLoadedSave = VectorSnapshot3.FromVector(person.transform.position),
            });
            result.Locations.Add(new DiscoveryLocationSnapshot
            {
                Kind = "person-position-in-loaded-save",
                Id = instanceKey,
                Name = person.FullName ?? string.Empty,
                RuntimeType = person.GetType().FullName ?? string.Empty,
                Position = VectorSnapshot3.FromVector(person.transform.position),
                Rotation = VectorSnapshot3.FromVector(person.transform.eulerAngles),
                SceneName = person.gameObject.scene.name,
                PersonId = person.ID,
            });

            var manager = person.Behaviour?.ScheduleManager
                ?? person.GetComponent<Il2CppScheduleOne.NPCs.NPCScheduleManager>();
            if (manager?.ActionList is null)
            {
                if ((personIndex + 1) % 20 == 0 || personIndex + 1 == people.Count)
                {
                    progress?.Invoke(
                        $"Discovery 7/9 progress: {personIndex + 1}/{people.Count} people.");
                }
                continue;
            }

            result.ScheduleManagerCount++;

            var schedule = new DiscoveryNpcScheduleSnapshot
            {
                PersonId = person.ID,
                PersonInstanceKey = instanceKey,
            };
            for (var actionIndex = 0;
                 actionIndex < manager.ActionList.Count;
                 actionIndex++)
            {
                var action = manager.ActionList[actionIndex];
                if (action is null)
                {
                    continue;
                }

                schedule.Actions.Add(CollectScheduleAction(action));
                result.ScheduleActionCount++;
            }

            schedule.Actions = schedule.Actions
                .OrderBy(x => x.StartTime)
                .ThenBy(x => x.Priority)
                .ToList();
            result.NpcSchedules.Add(schedule);

            if ((personIndex + 1) % 20 == 0 || personIndex + 1 == people.Count)
            {
                progress?.Invoke(
                    $"Discovery 7/9 progress: {personIndex + 1}/{people.Count} people.");
            }
        }

        foreach (var group in result.People.GroupBy(x => x.PersonId, StringComparer.Ordinal))
        {
            var isDuplicate = group.Count() > 1;
            foreach (var person in group)
            {
                person.SharesArchetypeId = isDuplicate;
            }
        }

        result.UniquePersonArchetypeCount = result.People
            .Select(x => x.PersonId)
            .Distinct(StringComparer.Ordinal)
            .Count();
    }

    private static DiscoveryNpcScheduleActionSnapshot CollectScheduleAction(
        Il2CppScheduleOne.NPCs.Schedules.NPCAction action)
    {
        var snapshot = new DiscoveryNpcScheduleActionSnapshot
        {
            RuntimeType = DiscoveryReflection.RuntimeTypeName(action),
            Name = SafeCall(action.GetName, action.ActionName ?? string.Empty),
            StartTime = action.StartTime,
            EndTime = SafeCall(action.GetEndTime, 0),
            TimeDescription = SafeCall(action.GetTimeDescription, string.Empty),
            Priority = action.Priority,
            IsEvent = action.IsEvent,
            IsSignal = action.IsSignal,
        };

        var eventAction = action.TryCast<Il2CppScheduleOne.NPCs.Schedules.NPCEvent>();
        if (eventAction is not null)
        {
            snapshot.Duration = eventAction.Duration;
        }

        var signalAction = action.TryCast<Il2CppScheduleOne.NPCs.Schedules.NPCSignal>();
        if (signalAction is not null)
        {
            snapshot.MaxDuration = signalAction.MaxDuration;
        }

        var walk = action.TryCast<
            Il2CppScheduleOne.NPCs.Schedules.NPCSignal_WalkToLocation>();
        var locationDialogue = action.TryCast<
            Il2CppScheduleOne.NPCs.Schedules.NPCEvent_LocationDialogue>();
        var locationAction = action.TryCast<
            Il2CppScheduleOne.NPCs.Schedules.NPCEvent_LocationBasedAction>();
        var conversate = action.TryCast<
            Il2CppScheduleOne.NPCs.Schedules.NPCEvent_Conversate>();
        var stay = action.TryCast<
            Il2CppScheduleOne.NPCs.Schedules.NPCEvent_StayInBuilding>();
        var drive = action.TryCast<
            Il2CppScheduleOne.NPCs.Schedules.NPCSignal_DriveToCarPark>();
        var useAtm = action.TryCast<
            Il2CppScheduleOne.NPCs.Schedules.NPCSignal_UseATM>();
        var useVending = action.TryCast<
            Il2CppScheduleOne.NPCs.Schedules.NPCSignal_UseVendingMachine>();
        var sit = action.TryCast<Il2CppScheduleOne.NPCs.Schedules.NPCEvent_Sit>();
        var cartelGoonExit = action.TryCast<
            Il2CppScheduleOne.NPCs.Schedules.NPCEvent_CartelGoonExit>();

        snapshot.Location =
            LocationReference("Destination", walk?.Destination) ??
            LocationReference("Destination", locationDialogue?.Destination) ??
            LocationReference("Destination", locationAction?.Destination) ??
            LocationReference("StandPoint", conversate?.StandPoint) ??
            LocationReference("Building", stay?.Building?.transform) ??
            LocationReference("Building", cartelGoonExit?.Building?.transform) ??
            LocationReference("ParkingLot", drive?.ParkingLot?.transform) ??
            LocationReference("ATM", useAtm?.ATM?.transform) ??
            LocationReference(
                "VendingMachine",
                (useVending?.TargetMachine ?? useVending?.MachineOverride)?.transform) ??
            LocationReference("Seat", sit?.targetSeat?.transform) ??
            LocationReference("SeatSet", sit?.SeatSet?.transform);

        if (snapshot.Location is null)
        {
            snapshot.TargetResolution = useAtm is not null
                ? "runtime-selected-atm"
                : useVending is not null
                    ? "runtime-selected-vending-machine"
                    : locationDialogue is not null || locationAction is not null
                        ? "explicit-destination-unset"
                        : cartelGoonExit is not null
                            ? "cartel-goon-exit-without-building"
                            : string.Empty;
        }

        return snapshot;
    }

    private static DiscoveryLocationReferenceSnapshot? LocationReference(
        string member,
        Transform? transform) => transform is null
        ? null
        : new DiscoveryLocationReferenceSnapshot
        {
            Member = member,
            ObjectName = transform.name ?? string.Empty,
            ObjectPath = DiscoveryReflection.ObjectPath(transform),
            Position = VectorSnapshot3.FromVector(transform.position),
            Rotation = VectorSnapshot3.FromVector(transform.eulerAngles),
        };

    private static T SafeCall<T>(Func<T> call, T fallback)
    {
        try
        {
            return call();
        }
        catch
        {
            return fallback;
        }
    }

    private static void SummarizeVisualInventory(DiscoverySnapshot result)
    {
        var collections = result.Buildables.Select(x => x.Visuals)
            .Concat(result.PropertyLayouts.Select(x => x.Visuals))
            .Concat(result.ItemPresentations.Select(x => x.FallbackVisuals))
            .Concat(result.People.Select(x => x.ModelVisuals))
            .ToList();
        var meshReferences = collections.SelectMany(x => x.Meshes)
            .Select(x => x.MeshAssetReferenceKey)
            .Concat(collections.SelectMany(x => x.Renderers)
                .Select(x => x.MeshAssetReferenceKey))
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .ToList();
        var materialReferences = collections.SelectMany(x => x.Renderers)
            .SelectMany(x => x.MaterialAssetReferenceKeys)
            .ToList();
        var materialsByKey = result.VisualAssets.Materials
            .ToDictionary(x => x.AssetReferenceKey, StringComparer.Ordinal);
        var textures = materialReferences
            .Where(materialsByKey.ContainsKey)
            .SelectMany(x => materialsByKey[x].Textures)
            .ToList();

        result.VisualRendererCount = collections.Sum(x => x.Renderers.Count);
        result.VisualMeshInstanceCount = meshReferences.Count;
        result.VisualMaterialReferenceCount = materialReferences.Count;
        result.VisualTextureReferenceCount = textures.Count;
        result.UniqueMeshAssetCount = result.VisualAssets.Meshes.Count;
        result.UniqueTextureAssetCount = textures
            .Select(x => x.AssetReferenceKey)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.Ordinal)
            .Count();
    }

}
