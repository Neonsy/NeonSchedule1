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
    internal static DiscoverySnapshot Collect(
        IReadOnlyList<Il2CppScheduleOne.ItemFramework.ItemDefinition> items,
        string assetDirectory,
        string assetDirectoryName,
        Action<string>? progress)
    {
        var assets = new DiscoveryAssetExporter(assetDirectory, assetDirectoryName);
        var visualAssets = new DiscoveryVisualAssetRegistry(assets);
        var result = new DiscoverySnapshot
        {
            AssetDirectory = assetDirectoryName,
        };

        progress?.Invoke($"Discovery 1/9: item icons and buildable visual inventory ({items.Count} items).");
        CollectItems(items, assets, visualAssets, result, progress);
        progress?.Invoke($"Discovery 1/9 complete: {result.Buildables.Count} buildables.");
        progress?.Invoke("Discovery 2/9: effect presentation metadata.");
        CollectEffectVisuals(result);
        progress?.Invoke($"Discovery 2/9 complete: {result.EffectVisuals.Count} effects.");
        progress?.Invoke("Discovery 3/9: maps, regions, and point-of-interest icons.");
        CollectMap(assets, result);
        progress?.Invoke("Discovery 3/9: typed and physical map services.");
        CollectMapServices(result);
        progress?.Invoke(
            $"Discovery 3/9 complete: {result.Map.Regions.Count} regions and " +
            $"{result.MapServices.Count} typed map services.");
        progress?.Invoke("Discovery 4/9: active navigation surfaces and sampled walkability graph.");
        CollectNavigation(result, progress);
        progress?.Invoke(
            $"Discovery 4/9 complete: {result.Navigation.Samples.Count} samples, " +
            $"{result.Navigation.Edges.Count / 2} verified edges.");
        progress?.Invoke("Discovery 5/9: timed access zones.");
        CollectTimedAccessZones(result);
        progress?.Invoke($"Discovery 5/9 complete: {result.TimedAccessZones.Count} zones.");
        progress?.Invoke("Discovery 6/9: property collision, surfaces, docks, grids, and visuals.");
        CollectProperties(assets, visualAssets, result, progress);
        progress?.Invoke($"Discovery 6/9 complete: {result.PropertyLayouts.Count} properties.");
        progress?.Invoke("Discovery 7/9: people, mugshots, positions, and typed schedules.");
        CollectPeople(assets, visualAssets, result, progress);
        progress?.Invoke($"Discovery 7/9 complete: {result.People.Count} people, {result.NpcSchedules.Count} schedules.");
        progress?.Invoke("Discovery 8/9: alternate presentation asset candidates.");
        CollectPresentationCandidates(items, assets, result);
        progress?.Invoke($"Discovery 8/9 complete: {result.PresentationAssetCandidates.Count} candidates.");
        progress?.Invoke("Discovery 9/9: shop locations, delivery bays, and access-zone proximity.");
        CollectShops(result);
        AssociateTimedAccessZones(result);
        progress?.Invoke($"Discovery 9/9 complete: {result.ShopDetails.Count} shops.");
        result.VisualAssets = visualAssets.CreateSnapshot();
        result.VisualMeshFileCount = result.VisualAssets.Meshes.Count(mesh =>
            !string.IsNullOrWhiteSpace(mesh.Asset?.RelativePath));
        result.VisualMeshExportErrorCount = result.VisualAssets.Meshes.Count(mesh =>
            !string.IsNullOrWhiteSpace(mesh.Asset?.Error));
        result.VisualTextureFileCount = result.VisualAssets.Materials
            .SelectMany(material => material.Textures)
            .Where(texture => !string.IsNullOrWhiteSpace(texture.Asset?.RelativePath))
            .Select(texture => texture.Asset!.RelativePath)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Count();
        result.VisualTextureExportErrorCount = result.VisualAssets.Materials
            .SelectMany(material => material.Textures)
            .Count(texture => !string.IsNullOrWhiteSpace(texture.Asset?.Error));
        result.AssetCount = assets.ExportedAssetCount;
        result.AssetFileCount = assets.CountPhysicalFiles();
        result.AssetVerificationErrors = assets.VerifyExportedAssets();
        SummarizeVisualInventory(result);

        result.ItemPresentations = result.ItemPresentations
            .OrderBy(x => x.ItemId, StringComparer.Ordinal)
            .ToList();
        result.Buildables = result.Buildables
            .OrderBy(x => x.ItemId, StringComparer.Ordinal)
            .ToList();
        result.PropertyLayouts = result.PropertyLayouts
            .OrderBy(x => x.PropertyCode, StringComparer.Ordinal)
            .ToList();
        result.Locations = result.Locations
            .OrderBy(x => x.Kind, StringComparer.Ordinal)
            .ThenBy(x => x.Id, StringComparer.Ordinal)
            .ToList();
        result.People = result.People
            .OrderBy(x => x.PersonId, StringComparer.Ordinal)
            .ThenBy(x => x.InstanceKey, StringComparer.Ordinal)
            .ToList();
        result.NpcSchedules = result.NpcSchedules
            .OrderBy(x => x.PersonId, StringComparer.Ordinal)
            .ThenBy(x => x.PersonInstanceKey, StringComparer.Ordinal)
            .ToList();
        result.ShopDetails = result.ShopDetails
            .OrderBy(x => x.Code, StringComparer.Ordinal)
            .ThenBy(x => x.HolderInstanceKey, StringComparer.Ordinal)
            .ToList();
        result.MapServices = result.MapServices
            .OrderBy(x => x.Kind, StringComparer.Ordinal)
            .ThenBy(x => x.Id, StringComparer.Ordinal)
            .ToList();
        progress?.Invoke("Discovery complete. Preparing the report.");
        return result;
    }

    private static void CollectItems(
        IReadOnlyList<Il2CppScheduleOne.ItemFramework.ItemDefinition> items,
        DiscoveryAssetExporter assets,
        DiscoveryVisualAssetRegistry visualAssets,
        DiscoverySnapshot result,
        Action<string>? progress)
    {
        for (var itemIndex = 0; itemIndex < items.Count; itemIndex++)
        {
            var item = items[itemIndex];
            var presentation = new DiscoveryItemPresentationSnapshot
            {
                ItemId = item.ID,
                Description = item.Description ?? string.Empty,
                Icon = assets.ExportSprite(item.Icon, "items", item.ID),
            };
            result.ItemPresentations.Add(presentation);

            var definition = item.TryCast<Il2CppScheduleOne.ItemFramework.BuildableItemDefinition>();
            if (definition?.BuiltItem is null)
            {
                var storable = item.TryCast<
                    Il2CppScheduleOne.ItemFramework.StorableItemDefinition>();
                var fallbackRoot = item.Equippable?.gameObject ??
                    storable?.StoredItem?.gameObject ??
                    storable?.StationItem?.gameObject;
                if (presentation.Icon is null && fallbackRoot is not null)
                {
                    presentation.FallbackVisuals = CollectVisuals(
                        fallbackRoot,
                        "item-models",
                        item.ID,
                        assets,
                        visualAssets);
                }

                if ((itemIndex + 1) % 20 == 0 || itemIndex + 1 == items.Count)
                {
                    progress?.Invoke(
                        $"Discovery 1/9 progress: {itemIndex + 1}/{items.Count} items, " +
                        $"{result.Buildables.Count} buildables.");
                }
                continue;
            }

            var buildable = CollectBuildable(
                item.ID,
                definition.BuiltItem,
                assets,
                visualAssets);
            result.Buildables.Add(buildable);
            if (presentation.Icon is null)
            {
                presentation.FallbackVisuals = buildable.Visuals;
            }

            if ((itemIndex + 1) % 20 == 0 || itemIndex + 1 == items.Count)
            {
                progress?.Invoke(
                    $"Discovery 1/9 progress: {itemIndex + 1}/{items.Count} items, " +
                    $"{result.Buildables.Count} buildables.");
            }
        }
    }

    private static DiscoveryBuildableSnapshot CollectBuildable(
        string itemId,
        Il2CppScheduleOne.EntityFramework.BuildableItem builtItem,
        DiscoveryAssetExporter assets,
        DiscoveryVisualAssetRegistry visualAssets)
    {
        var snapshot = new DiscoveryBuildableSnapshot
        {
            ItemId = itemId,
            RuntimeType = builtItem.GetType().FullName ?? string.Empty,
            HoldDistance = builtItem.HoldDistance,
            BuildPoint = TransformSnapshot.FromTransform(builtItem.BuildPoint),
            MidAirCenterPoint = TransformSnapshot.FromTransform(builtItem.MidAirCenterPoint),
            BoundingCollider = ColliderSnapshot.FromCollider(builtItem.BoundingCollider),
        };

        var gridItem = builtItem.TryCast<Il2CppScheduleOne.EntityFramework.GridItem>();
        if (gridItem is not null)
        {
            snapshot.PlacementKind = "grid";
            snapshot.FootprintWidth = gridItem.FootprintX;
            snapshot.FootprintHeight = gridItem.FootprintY;
        }

        var procedural = builtItem.TryCast<Il2CppScheduleOne.EntityFramework.ProceduralGridItem>();
        if (procedural is not null)
        {
            snapshot.PlacementKind = "procedural-grid";
            snapshot.FootprintWidth = procedural.FootprintXSize;
            snapshot.FootprintHeight = procedural.FootprintYSize;
            snapshot.ProceduralTileType = procedural.ProceduralTileType.ToString();
        }

        var surface = builtItem.TryCast<Il2CppScheduleOne.EntityFramework.SurfaceItem>();
        if (surface is not null)
        {
            snapshot.PlacementKind = "surface";
            snapshot.AllowRotation = surface.AllowRotation;
            snapshot.RotationIncrement = surface.RotationIncrement;
            if (surface.ValidSurfaceTypes is not null)
            {
                for (var index = 0; index < surface.ValidSurfaceTypes.Count; index++)
                {
                    snapshot.ValidSurfaceTypes.Add(surface.ValidSurfaceTypes[index].ToString());
                }
            }
        }

        var footprintTiles = builtItem.GetComponentsInChildren<Il2CppScheduleOne.Tiles.FootprintTile>(true);
        for (var index = 0; index < footprintTiles.Length; index++)
        {
            var tile = footprintTiles[index];
            if (tile is null)
            {
                continue;
            }

            snapshot.FootprintTiles.Add(new DiscoveryFootprintTileSnapshot
            {
                X = tile.X,
                Y = tile.Y,
                RequiredOffset = tile.RequiredOffset,
                Transform = TransformSnapshot.FromTransform(tile.transform),
            });
        }

        AddComponentsAndColliders(
            builtItem.gameObject,
            "built-item",
            snapshot,
            visualAssets);
        snapshot.Visuals = CollectVisuals(
            builtItem.gameObject,
            "buildables",
            itemId,
            assets,
            visualAssets);
        snapshot.InteractionPoints = CollectInteractionPoints(builtItem.gameObject);
        if (builtItem.BuildHandler is not null)
        {
            AddComponentsAndColliders(
                builtItem.BuildHandler,
                "build-handler",
                snapshot,
                visualAssets);
        }

        var storage = builtItem.GetComponentInChildren<Il2CppScheduleOne.Storage.StorageEntity>(true);
        if (storage is not null)
        {
            snapshot.Storage = new DiscoveryStorageSnapshot
            {
                Name = storage.StorageEntityName ?? string.Empty,
                Subtitle = storage.StorageEntitySubtitle ?? string.Empty,
                SlotCount = storage.SlotCount,
                DisplayRowCount = storage.DisplayRowCount,
                SlotsAreFilterable = storage.SlotsAreFilterable,
                MaxAccessDistance = storage.MaxAccessDistance,
                Transform = TransformSnapshot.FromTransform(storage.transform),
            };
        }

        var emitters = builtItem.GetComponentsInChildren<Il2CppScheduleOne.Temperature.TemperatureEmitter>(true);
        for (var index = 0; index < emitters.Length; index++)
        {
            var emitter = emitters[index];
            if (emitter is null)
            {
                continue;
            }

            snapshot.TemperatureEmitters.Add(new DiscoveryTemperatureEmitterSnapshot
            {
                Temperature = emitter.Temperature,
                Range = emitter.Range,
                EmissionPoint = VectorSnapshot3.FromVector(emitter.EmissionPoint),
            });
        }

        snapshot.ComponentTypes = snapshot.ComponentTypes
            .Distinct(StringComparer.Ordinal)
            .OrderBy(x => x, StringComparer.Ordinal)
            .ToList();
        snapshot.Colliders = snapshot.Colliders
            .OrderBy(x => x.Source, StringComparer.Ordinal)
            .ThenBy(x => x.Transform?.Path, StringComparer.Ordinal)
            .ToList();
        snapshot.FootprintTiles = snapshot.FootprintTiles
            .OrderBy(x => x.X)
            .ThenBy(x => x.Y)
            .ToList();
        snapshot.InteractionPoints = snapshot.InteractionPoints
            .OrderBy(x => x.ComponentType, StringComparer.Ordinal)
            .ThenBy(x => x.Member, StringComparer.Ordinal)
            .ThenBy(x => x.Transform?.Path, StringComparer.Ordinal)
            .ToList();
        return snapshot;
    }

    private static List<DiscoveryInteractionPointSnapshot> CollectInteractionPoints(
        GameObject root)
    {
        var result = new List<DiscoveryInteractionPointSnapshot>();
        var keys = new HashSet<string>(StringComparer.Ordinal);
        var memberNames = new HashSet<string>(new[]
        {
            "AccessPoint",
            "AccessPoints",
            "accessPoint",
            "accessPoints",
            "BuildPoint",
            "CameraPosition",
            "CameraPositions",
            "CameraPosition_CombineIngredients",
            "CameraPosition_StartMachine",
            "InteractionPoint",
            "LinkOrigin",
            "StandPoint",
            "TaskBounds",
            "TaskCameraTransform",
            "TaskContainer",
            "UIPoint",
            "uiPoint",
        }, StringComparer.Ordinal);

        var components = root.GetComponentsInChildren<Component>(true);
        for (var componentIndex = 0; componentIndex < components.Length; componentIndex++)
        {
            var component = components[componentIndex];
            if (component is null)
            {
                continue;
            }

            var type = component.GetType();
            foreach (var memberName in memberNames)
            {
                object? value = null;
                try
                {
                    value = type.GetProperty(
                            memberName,
                            BindingFlags.Instance | BindingFlags.Public)
                        ?.GetValue(component);
                    value ??= type.GetField(
                            memberName,
                            BindingFlags.Instance | BindingFlags.Public)
                        ?.GetValue(component);
                }
                catch
                {
                    continue;
                }

                void AddTransform(Transform? transform)
                {
                    if (transform is null)
                    {
                        return;
                    }

                    var componentType = DiscoveryReflection.RuntimeTypeName(component);
                    var path = DiscoveryReflection.ObjectPath(transform);
                    var key = $"{componentType}\u001f{memberName}\u001f{path}";
                    if (keys.Add(key))
                    {
                        result.Add(new DiscoveryInteractionPointSnapshot
                        {
                            ComponentType = componentType,
                            Member = memberName,
                            Role = InteractionPointRole(memberName),
                            Transform = TransformSnapshot.FromTransform(transform),
                        });
                    }
                }

                AddTransform(DiscoveryReflection.TransformFromValue(value));
                if (value is System.Collections.IEnumerable values && value is not string)
                {
                    foreach (var entry in values)
                    {
                        AddTransform(DiscoveryReflection.TransformFromValue(entry));
                    }
                }
            }
        }

        void AddTypedValue(Component component, string member, object? value)
        {
            void Add(Transform? transform)
            {
                if (transform is null)
                {
                    return;
                }
                var componentType = DiscoveryReflection.RuntimeTypeName(component);
                var path = DiscoveryReflection.ObjectPath(transform);
                var key = $"{componentType}\u001f{member}\u001f{path}";
                if (keys.Add(key))
                {
                    result.Add(new DiscoveryInteractionPointSnapshot
                    {
                        ComponentType = componentType,
                        Member = member,
                        Role = InteractionPointRole(member),
                        Transform = TransformSnapshot.FromTransform(transform),
                    });
                }
            }

            Add(DiscoveryReflection.TransformFromValue(value));
            if (value is System.Collections.IEnumerable values && value is not string)
            {
                foreach (var entry in values)
                {
                    Add(DiscoveryReflection.TransformFromValue(entry));
                }
            }
        }

        var cauldron = root.GetComponentInChildren<Il2CppScheduleOne.ObjectScripts.Cauldron>(true);
        if (cauldron is not null)
        {
            AddTypedValue(cauldron, "AccessPoints", cauldron.AccessPoints);
            AddTypedValue(cauldron, "CameraPosition", cauldron.CameraPosition);
            AddTypedValue(cauldron, "CameraPosition_CombineIngredients", cauldron.CameraPosition_CombineIngredients);
            AddTypedValue(cauldron, "CameraPosition_StartMachine", cauldron.CameraPosition_StartMachine);
            AddTypedValue(cauldron, "LinkOrigin", cauldron.LinkOrigin);
            AddTypedValue(cauldron, "StandPoint", cauldron.StandPoint);
            AddTypedValue(cauldron, "UIPoint", cauldron.UIPoint);
        }

        var dryingRack = root.GetComponentInChildren<Il2CppScheduleOne.ObjectScripts.DryingRack>(true);
        if (dryingRack is not null)
        {
            AddTypedValue(dryingRack, "AccessPoints", dryingRack.AccessPoints);
            AddTypedValue(dryingRack, "CameraPositions", dryingRack.CameraPositions);
            AddTypedValue(dryingRack, "HangAlignments", dryingRack.HangAlignments);
            AddTypedValue(dryingRack, "LinkOrigin", dryingRack.LinkOrigin);
            AddTypedValue(dryingRack, "UIPoint", dryingRack.UIPoint);
        }

        var brickPress = root.GetComponentInChildren<Il2CppScheduleOne.ObjectScripts.BrickPress>(true);
        if (brickPress is not null)
        {
            AddTypedValue(brickPress, "AccessPoints", brickPress.AccessPoints);
            AddTypedValue(brickPress, "CameraPosition", brickPress.CameraPosition);
            AddTypedValue(brickPress, "CameraPosition_Pouring", brickPress.CameraPosition_Pouring);
            AddTypedValue(brickPress, "CameraPosition_Raising", brickPress.CameraPosition_Raising);
            AddTypedValue(brickPress, "ContainerSpawnPoint", brickPress.ContainerSpawnPoint);
            AddTypedValue(brickPress, "LinkOrigin", brickPress.LinkOrigin);
            AddTypedValue(brickPress, "StandPoint", brickPress.StandPoint);
            AddTypedValue(brickPress, "UIPoint", brickPress.UIPoint);
        }

        var mixingStation = root.GetComponentInChildren<Il2CppScheduleOne.ObjectScripts.MixingStation>(true);
        if (mixingStation is not null)
        {
            AddTypedValue(mixingStation, "AccessPoints", mixingStation.AccessPoints);
            AddTypedValue(mixingStation, "CameraPosition", mixingStation.CameraPosition);
            AddTypedValue(mixingStation, "CameraPosition_CombineIngredients", mixingStation.CameraPosition_CombineIngredients);
            AddTypedValue(mixingStation, "CameraPosition_StartMachine", mixingStation.CameraPosition_StartMachine);
            AddTypedValue(mixingStation, "IngredientTransforms", mixingStation.IngredientTransforms);
            AddTypedValue(mixingStation, "JugAlignment", mixingStation.JugAlignment);
            AddTypedValue(mixingStation, "LinkOrigin", mixingStation.LinkOrigin);
            AddTypedValue(mixingStation, "UIPoint", mixingStation.UIPoint);
        }

        var labOven = root.GetComponentInChildren<Il2CppScheduleOne.ObjectScripts.LabOven>(true);
        if (labOven is not null)
        {
            AddTypedValue(labOven, "AccessPoints", labOven.AccessPoints);
            AddTypedValue(labOven, "CameraPosition_Default", labOven.CameraPosition_Default);
            AddTypedValue(labOven, "CameraPosition_Breaking", labOven.CameraPosition_Breaking);
            AddTypedValue(labOven, "CameraPosition_PlaceItems", labOven.CameraPosition_PlaceItems);
            AddTypedValue(labOven, "CameraPosition_Pour", labOven.CameraPosition_Pour);
            AddTypedValue(labOven, "LinkOrigin", labOven.LinkOrigin);
            AddTypedValue(labOven, "ShardSpawnPoints", labOven.ShardSpawnPoints);
            AddTypedValue(labOven, "SolidIngredientSpawnPoints", labOven.SolidIngredientSpawnPoints);
            AddTypedValue(labOven, "UIPoint", labOven.UIPoint);
        }

        var packaging = root.GetComponentInChildren<Il2CppScheduleOne.ObjectScripts.PackagingStation>(true);
        if (packaging is not null)
        {
            AddTypedValue(packaging, "AccessPoints", packaging.AccessPoints);
            AddTypedValue(packaging, "ActiveProductAlignments", packaging.ActiveProductAlignments);
            AddTypedValue(packaging, "CameraPosition", packaging.CameraPosition);
            AddTypedValue(packaging, "CameraPosition_Task", packaging.CameraPosition_Task);
            AddTypedValue(packaging, "LinkOrigin", packaging.LinkOrigin);
            AddTypedValue(packaging, "OutputSlotPosition", packaging.OutputSlotPosition);
            AddTypedValue(packaging, "PackagingAlignments", packaging.PackagingAlignments);
            AddTypedValue(packaging, "ProductAlignments", packaging.ProductAlignments);
            AddTypedValue(packaging, "StandPoint", packaging.StandPoint);
            AddTypedValue(packaging, "UIPoint", packaging.UIPoint);
        }

        var pot = root.GetComponentInChildren<Il2CppScheduleOne.ObjectScripts.Pot>(true);
        if (pot is not null)
        {
            AddTypedValue(pot, "LeafDropPoint", pot.LeafDropPoint);
            AddTypedValue(pot, "LookAtPoint", pot.LookAtPoint);
            AddTypedValue(pot, "SeedStartPoint", pot.SeedStartPoint);
            AddTypedValue(pot, "TaskBounds", pot.TaskBounds);
            AddTypedValue(pot, "UIPoint", pot.UIPoint);
        }

        var spawnStation = root.GetComponentInChildren<
            Il2CppScheduleOne.StationFramework.MushroomSpawnStation>(true);
        if (spawnStation is not null)
        {
            AddTypedValue(spawnStation, "AccessPoints", spawnStation.AccessPoints);
            AddTypedValue(spawnStation, "CameraTransform", spawnStation.CameraTransform);
            AddTypedValue(spawnStation, "LinkOrigin", spawnStation.LinkOrigin);
            AddTypedValue(spawnStation, "TaskCameraTransform", spawnStation.TaskCameraTransform);
            AddTypedValue(spawnStation, "TaskContainer", spawnStation.TaskContainer);
            AddTypedValue(spawnStation, "UIPoint", spawnStation.UIPoint);
        }


        var transformNameFragments = new[]
        {
            "accesspoint", "alignment", "buildpoint", "cameraposition",
            "container", "dragprojectionplane", "droppoint", "hangalignment",
            "ingredienttransform", "linkorigin", "lookatpoint", "outputslotposition",
            "seedpoint", "shardspawn", "spawnpoint", "standpoint", "taskbounds",
            "taskcamera", "taskcontainer", "tray", "uipoint",
        };
        var transforms = root.GetComponentsInChildren<Transform>(true);
        for (var index = 0; index < transforms.Length; index++)
        {
            var transform = transforms[index];
            if (transform is null)
            {
                continue;
            }

            var normalizedName = NormalizeName(transform.name ?? string.Empty);
            if (!transformNameFragments.Any(fragment =>
                    normalizedName.Contains(fragment, StringComparison.Ordinal)))
            {
                continue;
            }

            var path = DiscoveryReflection.ObjectPath(transform);
            var key = $"hierarchy\u001f{normalizedName}\u001f{path}";
            if (keys.Add(key))
            {
                result.Add(new DiscoveryInteractionPointSnapshot
                {
                    ComponentType = "hierarchy-transform",
                    Member = transform.name ?? string.Empty,
                    Role = InteractionPointRole(transform.name ?? string.Empty),
                    Transform = TransformSnapshot.FromTransform(transform),
                });
            }
        }

        return result;
    }

    private static string InteractionPointRole(string member)
    {
        var normalized = NormalizeName(member);
        if (normalized.Contains("camera", StringComparison.Ordinal) ||
            normalized.Contains("lookat", StringComparison.Ordinal))
        {
            return "camera";
        }
        if (normalized.Contains("access", StringComparison.Ordinal) ||
            normalized.Contains("stand", StringComparison.Ordinal))
        {
            return "operator-access";
        }
        if (normalized.Contains("ui", StringComparison.Ordinal))
        {
            return "ui";
        }
        if (normalized.Contains("link", StringComparison.Ordinal))
        {
            return "automation-link";
        }
        if (normalized.Contains("alignment", StringComparison.Ordinal) ||
            normalized.Contains("spawn", StringComparison.Ordinal) ||
            normalized.Contains("ingredient", StringComparison.Ordinal) ||
            normalized.Contains("container", StringComparison.Ordinal) ||
            normalized.Contains("tray", StringComparison.Ordinal))
        {
            return "item-placement";
        }
        if (normalized.Contains("task", StringComparison.Ordinal) ||
            normalized.Contains("projection", StringComparison.Ordinal))
        {
            return "task-area";
        }
        return "placement";
    }

    private static void AddComponentsAndColliders(
        GameObject root,
        string source,
        DiscoveryBuildableSnapshot snapshot,
        DiscoveryVisualAssetRegistry visualAssets)
    {
        var components = root.GetComponentsInChildren<Component>(true);
        for (var index = 0; index < components.Length; index++)
        {
            var component = components[index];
            if (component is not null)
            {
                snapshot.ComponentTypes.Add(component.GetType().FullName ?? string.Empty);
            }
        }

        var colliders = root.GetComponentsInChildren<Collider>(true);
        for (var index = 0; index < colliders.Length; index++)
        {
            var collider = ColliderSnapshot.FromCollider(colliders[index]);
            if (collider is not null)
            {
                collider.Source = source;
                snapshot.Colliders.Add(collider);
            }

            var meshCollider = colliders[index]?.TryCast<MeshCollider>();
            if (meshCollider?.sharedMesh is not null)
            {
                visualAssets.RegisterMesh(meshCollider.sharedMesh);
            }
        }
    }

    private static void CollectEffectVisuals(DiscoverySnapshot result)
    {
        var effects = Il2CppScheduleOne.Product.PropertyUtility.Instance?.AllProperties;
        if (effects is null)
        {
            return;
        }

        for (var index = 0; index < effects.Count; index++)
        {
            var effect = effects[index];
            if (effect is null || string.IsNullOrWhiteSpace(effect.ID))
            {
                continue;
            }

            result.EffectVisuals.Add(new DiscoveryEffectVisualSnapshot
            {
                EffectId = effect.ID,
                Name = effect.Name ?? string.Empty,
                Description = effect.Description ?? string.Empty,
                ProductColor = ColorSnapshot.FromColor(effect.ProductColor),
                LabelColor = ColorSnapshot.FromColor(effect.LabelColor),
            });
        }

        result.EffectVisuals = result.EffectVisuals
            .OrderBy(x => x.EffectId, StringComparer.Ordinal)
            .ToList();
    }

    private static DiscoveryVisualCollectionSnapshot CollectVisuals(
        GameObject root,
        string category,
        string key,
        DiscoveryAssetExporter assets,
        DiscoveryVisualAssetRegistry visualAssets)
    {
        var result = new DiscoveryVisualCollectionSnapshot();
        var renderers = root.GetComponentsInChildren<Renderer>(true);
        for (var index = 0; index < renderers.Length; index++)
        {
            var renderer = renderers[index];
            if (renderer is null)
            {
                continue;
            }

            var rendererSnapshot = new DiscoveryRendererSnapshot
            {
                RuntimeType = renderer.GetType().FullName ?? string.Empty,
                Transform = TransformSnapshot.FromTransform(renderer.transform),
                Enabled = renderer.enabled,
                BoundsCenter = VectorSnapshot3.FromVector(renderer.bounds.center),
                BoundsSize = VectorSnapshot3.FromVector(renderer.bounds.size),
            };
            if (renderer.sharedMaterials is not null)
            {
                for (var materialIndex = 0;
                     materialIndex < renderer.sharedMaterials.Length;
                     materialIndex++)
                {
                    var material = renderer.sharedMaterials[materialIndex];
                    if (material is not null)
                    {
                        rendererSnapshot.MaterialAssetReferenceKeys.Add(
                            visualAssets.RegisterMaterial(material));
                    }
                }
            }

            var spriteRenderer = renderer.TryCast<SpriteRenderer>();
            if (spriteRenderer?.sprite is not null)
            {
                rendererSnapshot.Sprite = assets.ExportSprite(
                    spriteRenderer.sprite,
                    $"{category}-sprites",
                    $"{key}-{index}");
                rendererSnapshot.Color = ColorSnapshot.FromColor(spriteRenderer.color);
            }

            var skinned = renderer.TryCast<SkinnedMeshRenderer>();
            if (skinned?.sharedMesh is not null)
            {
                rendererSnapshot.MeshAssetReferenceKey =
                    visualAssets.RegisterMesh(skinned.sharedMesh);
            }

            result.Renderers.Add(rendererSnapshot);
        }

        var meshFilters = root.GetComponentsInChildren<MeshFilter>(true);
        for (var index = 0; index < meshFilters.Length; index++)
        {
            var filter = meshFilters[index];
            if (filter?.sharedMesh is null)
            {
                continue;
            }

            result.Meshes.Add(new DiscoveryMeshInstanceSnapshot
            {
                Transform = TransformSnapshot.FromTransform(filter.transform),
                MeshAssetReferenceKey = visualAssets.RegisterMesh(filter.sharedMesh),
            });
        }

        return result;
    }

    private static void CollectMap(
        DiscoveryAssetExporter assets,
        DiscoverySnapshot result)
    {
        var mapApps = Resources.FindObjectsOfTypeAll<Il2CppScheduleOne.UI.Phone.Map.MapApp>();
        if (mapApps.Length > 0 && mapApps[0] is not null)
        {
            var app = mapApps[0];
            result.Map.MainMapSprite = assets.ExportSprite(app.MainMapSprite, "map", "main-map");
            result.Map.TutorialMapSprite = assets.ExportSprite(app.TutorialMapSprite, "map", "tutorial-map");
            result.Map.MapAppTransform = TransformSnapshot.FromTransform(app.transform);
        }

        var utilities = Resources.FindObjectsOfTypeAll<Il2CppScheduleOne.Map.MapPositionUtility>();
        if (utilities.Length > 0 && utilities[0] is not null)
        {
            var utility = utilities[0];
            result.Map.PositionUtilityType = utility.GetType().FullName ?? string.Empty;
            result.Map.PositionUtilityMembers = DiscoveryReflection.ReadMembers(
                utility,
                "OriginPoint",
                "EdgePoint",
                "MapDimensions",
                "conversionFactor");
        }

        var maps = Resources.FindObjectsOfTypeAll<Il2CppScheduleOne.Map.Map>();
        if (maps.Length > 0 && maps[0]?.Regions is not null)
        {
            var map = maps[0];
            for (var index = 0; index < map.Regions.Count; index++)
            {
                var region = map.Regions[index];
                if (region is null)
                {
                    continue;
                }

                var regionSnapshot = new DiscoveryMapRegionSnapshot
                {
                    Id = region.Region.ToString(),
                    Name = region.Name ?? string.Empty,
                    UnlockedByDefault = region.UnlockedByDefault,
                    RankRequirement = region.RankRequirement.ToString(),
                    Sprite = assets.ExportSprite(region.RegionSprite, "map-regions", region.Region.ToString()),
                    Bounds = DiscoveryReflection.DescribeUnityObject(region.RegionBounds),
                };
                if (region.AdjacentRegions is not null)
                {
                    for (var adjacentIndex = 0;
                         adjacentIndex < region.AdjacentRegions.Count;
                         adjacentIndex++)
                    {
                        regionSnapshot.AdjacentRegionIds.Add(
                            region.AdjacentRegions[adjacentIndex].Region.ToString());
                    }
                }

                if (region.RegionBounds is not null)
                {
                    regionSnapshot.BoundsPointA = VectorSnapshot3.FromVector(
                        region.RegionBounds.bounds.Item1);
                    regionSnapshot.BoundsPointB = VectorSnapshot3.FromVector(
                        region.RegionBounds.bounds.Item2);
                    regionSnapshot.IsClosed = region.RegionBounds.IsClosed;
                    regionSnapshot.VerticalSize = region.RegionBounds.VerticalSize;
                    if (region.RegionBounds.points is not null)
                    {
                        for (var pointIndex = 0;
                             pointIndex < region.RegionBounds.points.Count;
                             pointIndex++)
                        {
                            regionSnapshot.PolygonPoints.Add(
                                VectorSnapshot3.FromVector(
                                    region.RegionBounds.points[pointIndex]));
                        }
                    }
                }

                result.Map.Regions.Add(regionSnapshot);
            }
        }

        var points = Resources.FindObjectsOfTypeAll<Il2CppScheduleOne.Map.POI>();
        for (var index = 0; index < points.Length; index++)
        {
            var point = points[index];
            if (point is null || !DiscoveryReflection.IsSceneObject(point.gameObject))
            {
                continue;
            }

            var personId = string.Empty;
            var npcPoint = point.GetComponent<Il2CppScheduleOne.Map.NPCPoI>();
            if (npcPoint?.NPC is not null)
            {
                personId = npcPoint.NPC.ID;
            }

            result.Locations.Add(new DiscoveryLocationSnapshot
            {
                Kind = personId.Length > 0 ? "npc-poi" : "poi",
                Id = personId.Length > 0 ? personId : DiscoveryReflection.ObjectPath(point.transform),
                Name = point.MainText ?? point.DefaultMainText ?? point.name ?? string.Empty,
                RuntimeType = point.GetType().FullName ?? string.Empty,
                Position = VectorSnapshot3.FromVector(point.transform.position),
                Rotation = VectorSnapshot3.FromVector(point.transform.eulerAngles),
                SceneName = point.gameObject.scene.name,
                PersonId = personId,
            });

            var location = result.Locations[^1];
            if (point.IconContainer is not null)
            {
                var images = point.IconContainer.GetComponentsInChildren<Image>(true);
                for (var imageIndex = 0; imageIndex < images.Length; imageIndex++)
                {
                    var image = images[imageIndex];
                    if (image?.sprite is not null)
                    {
                        var icon = assets.ExportSprite(
                            image.sprite,
                            "poi-icons",
                            $"{location.Id}-{imageIndex}");
                        if (icon is not null)
                        {
                            location.Icons.Add(icon);
                        }
                    }
                }
            }
        }
    }

}
