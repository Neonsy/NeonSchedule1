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
    private static void CollectNavigation(
        DiscoverySnapshot result,
        Action<string>? progress)
    {
        result.Navigation.Method = "sampled-navmesh-grid";
        result.Navigation.SampleSpacing = 2f;
        result.Navigation.QueryHeight = 0f;
        result.Navigation.MaxSampleDistance = 12f;

        var surfaces = Resources.FindObjectsOfTypeAll<NavMeshSurface>();
        for (var index = 0; index < surfaces.Length; index++)
        {
            var surface = surfaces[index];
            if (surface is null || !DiscoveryReflection.IsSceneObject(surface.gameObject))
            {
                continue;
            }

            var snapshot = new DiscoveryNavMeshSurfaceSnapshot
            {
                ObjectPath = DiscoveryReflection.ObjectPath(surface.transform),
                SceneName = surface.gameObject.scene.name,
                Transform = TransformSnapshot.FromTransform(surface.transform),
                AgentTypeId = surface.agentTypeID,
                CollectObjects = surface.collectObjects.ToString(),
                LayerMask = surface.layerMask.value,
                UseGeometry = surface.useGeometry.ToString(),
                DefaultArea = surface.defaultArea,
                IgnoreNavMeshAgent = surface.ignoreNavMeshAgent,
                IgnoreNavMeshObstacle = surface.ignoreNavMeshObstacle,
                OverrideTileSize = surface.overrideTileSize,
                TileSize = surface.tileSize,
                OverrideVoxelSize = surface.overrideVoxelSize,
                VoxelSize = surface.voxelSize,
                MinimumRegionArea = surface.minRegionArea,
                BuildHeightMesh = surface.buildHeightMesh,
            };

            try
            {
                var data = surface.navMeshData;
                if (data is not null)
                {
                    snapshot.DataPosition = VectorSnapshot3.FromVector(data.position);
                    snapshot.SourceBoundsCenter = VectorSnapshot3.FromVector(data.sourceBounds.center);
                    snapshot.SourceBoundsSize = VectorSnapshot3.FromVector(data.sourceBounds.size);
                    snapshot.HasHeightMeshData = data.hasHeightMeshData;
                }
            }
            catch (Exception exception)
            {
                snapshot.Error = $"{exception.GetType().Name}: {exception.Message}";
            }

            result.Navigation.Surfaces.Add(snapshot);
        }

        var horizontalPoints = new List<Vector3>();
        for (var regionIndex = 0; regionIndex < result.Map.Regions.Count; regionIndex++)
        {
            var points = result.Map.Regions[regionIndex].PolygonPoints;
            for (var pointIndex = 0; pointIndex < points.Count; pointIndex++)
            {
                horizontalPoints.Add(new Vector3(points[pointIndex].X, 0f, points[pointIndex].Z));
            }
        }
        for (var locationIndex = 0; locationIndex < result.Locations.Count; locationIndex++)
        {
            var point = result.Locations[locationIndex].Position;
            if (point is not null)
            {
                horizontalPoints.Add(new Vector3(point.X, 0f, point.Z));
            }
        }

        if (horizontalPoints.Count == 0)
        {
            result.Navigation.Error = "No map bounds were available for navigation sampling.";
            return;
        }

        const float padding = 30f;
        var minX = MathF.Floor(horizontalPoints.Min(point => point.x) - padding);
        var maxX = MathF.Ceiling(horizontalPoints.Max(point => point.x) + padding);
        var minZ = MathF.Floor(horizontalPoints.Min(point => point.z) - padding);
        var maxZ = MathF.Ceiling(horizontalPoints.Max(point => point.z) + padding);
        var spacing = result.Navigation.SampleSpacing;
        var width = (int)MathF.Floor((maxX - minX) / spacing) + 1;
        var height = (int)MathF.Floor((maxZ - minZ) / spacing) + 1;
        result.Navigation.BoundsMinimum = new VectorSnapshot3 { X = minX, Y = 0f, Z = minZ };
        result.Navigation.BoundsMaximum = new VectorSnapshot3 { X = maxX, Y = 0f, Z = maxZ };
        result.Navigation.GridWidth = width;
        result.Navigation.GridHeight = height;

        var sampleIndices = new Dictionary<long, int>();
        try
        {
            for (var zIndex = 0; zIndex < height; zIndex++)
            {
                var z = minZ + (zIndex * spacing);
                for (var xIndex = 0; xIndex < width; xIndex++)
                {
                    var x = minX + (xIndex * spacing);
                    var query = new Vector3(x, result.Navigation.QueryHeight, z);
                    if (!NavMesh.SamplePosition(
                            query,
                            out var hit,
                            result.Navigation.MaxSampleDistance,
                            NavMesh.AllAreas) ||
                        MathF.Abs(hit.position.x - x) > spacing * 0.5f ||
                        MathF.Abs(hit.position.z - z) > spacing * 0.5f)
                    {
                        continue;
                    }

                    var sampleIndex = result.Navigation.Samples.Count;
                    result.Navigation.Samples.Add(new DiscoveryNavigationSampleSnapshot
                    {
                        GridX = xIndex,
                        GridZ = zIndex,
                        Position = VectorSnapshot3.FromVector(hit.position),
                        AreaMask = hit.mask,
                    });
                    sampleIndices[NavigationGridKey(xIndex, zIndex)] = sampleIndex;
                }

                if ((zIndex + 1) % 25 == 0 || zIndex + 1 == height)
                {
                    progress?.Invoke(
                        $"Discovery 4/9 progress: sampled {zIndex + 1}/{height} navigation rows.");
                }
            }
        }
        catch (Exception exception)
        {
            result.Navigation.Error = $"Sampling failed: {exception.GetType().Name}: {exception.Message}";
            return;
        }

        try
        {
            for (var index = 0; index < result.Navigation.Samples.Count; index++)
            {
                var sample = result.Navigation.Samples[index];
                AddNavigationEdge(result.Navigation, sampleIndices, index, sample.GridX + 1, sample.GridZ);
                AddNavigationEdge(result.Navigation, sampleIndices, index, sample.GridX, sample.GridZ + 1);
            }
        }
        catch (Exception exception)
        {
            result.Navigation.EdgeError =
                $"Edge validation failed: {exception.GetType().Name}: {exception.Message}";
        }
    }

    private static long NavigationGridKey(int x, int z) => ((long)z << 32) | (uint)x;

    private static void AddNavigationEdge(
        DiscoveryNavigationSnapshot navigation,
        IReadOnlyDictionary<long, int> sampleIndices,
        int fromIndex,
        int toX,
        int toZ)
    {
        if (!sampleIndices.TryGetValue(NavigationGridKey(toX, toZ), out var toIndex))
        {
            return;
        }

        var fromSnapshot = navigation.Samples[fromIndex].Position;
        var toSnapshot = navigation.Samples[toIndex].Position;
        var from = new Vector3(fromSnapshot.X, fromSnapshot.Y, fromSnapshot.Z);
        var to = new Vector3(toSnapshot.X, toSnapshot.Y, toSnapshot.Z);
        if (!NavMesh.Raycast(from, to, out _, NavMesh.AllAreas))
        {
            navigation.Edges.Add(fromIndex);
            navigation.Edges.Add(toIndex);
        }
    }

    private static void CollectTimedAccessZones(DiscoverySnapshot result)
    {
        var zones = Resources.FindObjectsOfTypeAll<Il2CppScheduleOne.Map.TimedAccessZone>();
        for (var index = 0; index < zones.Length; index++)
        {
            var zone = zones[index];
            if (zone is null || !DiscoveryReflection.IsSceneObject(zone.gameObject))
            {
                continue;
            }

            result.TimedAccessZones.Add(new DiscoveryTimedAccessZoneSnapshot
            {
                Id = DiscoveryReflection.ObjectPath(zone.transform),
                OpenTime = zone.OpenTime,
                CloseTime = zone.CloseTime,
                AllowExitWhenClosed = zone.AllowExitWhenClosed,
                AutoCloseDoor = zone.AutoCloseDoor,
                Position = VectorSnapshot3.FromVector(zone.transform.position),
                Rotation = VectorSnapshot3.FromVector(zone.transform.eulerAngles),
                SceneName = zone.gameObject.scene.name,
                DoorCount = zone.Doors?.Count ?? 0,
            });
        }

        result.TimedAccessZones = result.TimedAccessZones
            .OrderBy(x => x.Id, StringComparer.Ordinal)
            .ToList();
    }

}
