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
        using var assets = new DiscoveryAssetExporter(assetDirectory, assetDirectoryName);
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
        progress?.Invoke(
            "Discovery 4/9: active navigation surfaces plus employee and candidate player graphs.");
        CollectNavigation(result, progress);
        progress?.Invoke(
            $"Discovery 4/9 complete: employee {result.Navigation.Samples.Count} samples and " +
            $"{result.Navigation.Edges.Count / 2} verified edges, player " +
            $"{result.PlayerNavigation.Samples.Count} samples and " +
            $"{result.PlayerNavigation.Edges.Count / 2} verified edges.");
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
        progress?.Invoke(
            "Discovery 9/9: shop locations, delivery bays, access-zone proximity, and player route probes.");
        CollectShops(result);
        AssociateTimedAccessZones(result);
        CollectPlayerRouteProbes(result, progress);
        progress?.Invoke(
            $"Discovery 9/9 complete: {result.ShopDetails.Count} shops and " +
            $"{result.PlayerNavigation.RouteProbes.Count} player route probes.");
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
            (snapshot.TileSharingRule, snapshot.TileSharingImplementation) =
                TileSharingBehavior(gridItem);
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

            var footprintTile = new DiscoveryFootprintTileSnapshot
            {
                X = tile.X,
                Y = tile.Y,
                RequiredOffset = tile.RequiredOffset,
                Transform = TransformSnapshot.FromTransform(tile.transform),
            };
            if (tile.Corners is not null)
            {
                for (var cornerIndex = 0; cornerIndex < tile.Corners.Count; cornerIndex++)
                {
                    var corner = tile.Corners[cornerIndex];
                    if (corner is null)
                    {
                        continue;
                    }

                    footprintTile.Corners.Add(new DiscoveryCornerObstacleSnapshot
                    {
                        ObstacleEnabled = corner.obstacleEnabled,
                        Coordinates = VectorSnapshot2.FromVector(corner.coordinates),
                        Transform = TransformSnapshot.FromTransform(corner.transform),
                    });
                }
            }
            footprintTile.Corners = footprintTile.Corners
                .OrderBy(x => x.Coordinates.X)
                .ThenBy(x => x.Coordinates.Y)
                .ThenBy(x => x.Transform?.Path, StringComparer.Ordinal)
                .ToList();
            snapshot.FootprintTiles.Add(footprintTile);
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
        var transitEntity = builtItem.TryCast<Il2CppScheduleOne.Management.ITransitEntity>();
        snapshot.IsTransitEntity = transitEntity is not null;
        snapshot.TransitAccessPoints = CollectTransitAccessPoints(transitEntity);
        var trash = builtItem.TryCast<Il2CppScheduleOne.ObjectScripts.TrashContainerItem>();
        snapshot.Trash = trash is null
            ? null
            : new DiscoveryTrashSnapshot { UsableByCleaners = trash.UsableByCleaners };
        snapshot.ProceduralTiles = CollectProceduralTiles(builtItem.gameObject);
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
        snapshot.TransitAccessPoints = snapshot.TransitAccessPoints
            .OrderBy(x => x?.Path, StringComparer.Ordinal)
            .ToList();
        snapshot.ProceduralTiles = snapshot.ProceduralTiles
            .OrderBy(x => x.Id, StringComparer.Ordinal)
            .ToList();
        return snapshot;
    }

    private static List<TransformSnapshot?> CollectTransitAccessPoints(
        Il2CppScheduleOne.Management.ITransitEntity? entity)
    {
        if (entity?.AccessPoints is null)
        {
            return new List<TransformSnapshot?>();
        }

        var points = new List<TransformSnapshot?>();
        for (var index = 0; index < entity.AccessPoints.Length; index++)
        {
            points.Add(TransformSnapshot.FromTransform(entity.AccessPoints[index]));
        }
        return points;
    }

    private static List<DiscoveryProceduralTileSnapshot> CollectProceduralTiles(GameObject root)
    {
        var result = new List<DiscoveryProceduralTileSnapshot>();
        var tiles = root.GetComponentsInChildren<Il2CppScheduleOne.Tiles.ProceduralTile>(true);
        for (var index = 0; index < tiles.Length; index++)
        {
            var tile = tiles[index];
            if (tile is null)
            {
                continue;
            }
            var transform = TransformSnapshot.FromTransform(tile.transform);
            result.Add(new DiscoveryProceduralTileSnapshot
            {
                Id = transform?.Path ?? string.Empty,
                TileType = tile.TileType.ToString(),
                Transform = transform,
            });
        }
        return result;
    }

    private static (string Rule, string Implementation) TileSharingBehavior(
        Il2CppScheduleOne.EntityFramework.GridItem gridItem)
    {
        var runtimeClass = IL2CPP.il2cpp_object_get_class(gridItem.Pointer);
        var implementation = IL2CPP.il2cpp_class_get_method_from_name(
            runtimeClass,
            nameof(Il2CppScheduleOne.EntityFramework.GridItem.CanShareTileWith),
            1);
        if (implementation == IntPtr.Zero)
        {
            return ("unsupported", string.Empty);
        }

        var declaringClass = IL2CPP.il2cpp_method_get_class(implementation);
        var implementationName = NativeClassName(declaringClass);
        if (string.Equals(
                implementationName,
                NativeNameOf(typeof(Il2CppScheduleOne.EntityFramework.GridItem)),
                StringComparison.Ordinal))
        {
            return ("standard", implementationName);
        }
        if (string.Equals(
                implementationName,
                NativeNameOf(typeof(Il2CppScheduleOne.ObjectScripts.FloorRack)),
                StringComparison.Ordinal))
        {
            return ("floor-rack", implementationName);
        }
        return ("unsupported", implementationName);
    }

    private static string NativeClassName(IntPtr classPointer)
    {
        if (classPointer == IntPtr.Zero)
        {
            return string.Empty;
        }
        var typeNamespace = IL2CPP.il2cpp_class_get_namespace_(classPointer) ?? string.Empty;
        var typeName = IL2CPP.il2cpp_class_get_name_(classPointer) ?? string.Empty;
        return string.IsNullOrWhiteSpace(typeNamespace)
            ? typeName
            : $"{typeNamespace}.{typeName}";
    }

    private static string NativeNameOf(Type managedWrapper)
    {
        const string wrapperPrefix = "Il2Cpp";
        var name = managedWrapper.FullName ?? string.Empty;
        return name.StartsWith(wrapperPrefix, StringComparison.Ordinal)
            ? name[wrapperPrefix.Length..]
            : name;
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

                if (region.RegionDeliveryLocations is not null)
                {
                    for (var locationIndex = 0;
                         locationIndex < region.RegionDeliveryLocations.Length;
                         locationIndex++)
                    {
                        var location = region.RegionDeliveryLocations[locationIndex];
                        if (location?.CustomerStandPoint is null)
                        {
                            continue;
                        }

                        regionSnapshot.DeliveryLocations.Add(
                            new DiscoveryDeliveryLocationSnapshot
                            {
                                Id = location.GUID.ToString(),
                                Position = VectorSnapshot3.FromVector(
                                    location.CustomerStandPoint.position),
                            });
                    }
                    regionSnapshot.DeliveryLocations = regionSnapshot.DeliveryLocations
                        .OrderBy(location => location.Id, StringComparer.Ordinal)
                        .ToList();
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
