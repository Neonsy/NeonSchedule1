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

internal sealed class DiscoverySnapshot
{
    public string AssetDirectory { get; init; } = string.Empty;
    public int AssetCount { get; set; }
    public int AssetFileCount { get; set; }
    public List<string> AssetVerificationErrors { get; set; } = new();
    public int ScheduleManagerCount { get; set; }
    public int ScheduleActionCount { get; set; }
    public int UniquePersonArchetypeCount { get; set; }
    public int VisualRendererCount { get; set; }
    public int VisualMeshInstanceCount { get; set; }
    public int VisualMaterialReferenceCount { get; set; }
    public int VisualTextureReferenceCount { get; set; }
    public int UniqueMeshAssetCount { get; set; }
    public int UniqueTextureAssetCount { get; set; }
    public int VisualMeshFileCount { get; set; }
    public int VisualMeshExportErrorCount { get; set; }
    public int VisualTextureFileCount { get; set; }
    public int VisualTextureExportErrorCount { get; set; }
    public DiscoveryMapSnapshot Map { get; init; } = new();
    public DiscoveryNavigationSnapshot Navigation { get; init; } = new();
    public DiscoveryVisualAssetManifestSnapshot VisualAssets { get; set; } = new();
    public List<DiscoveryItemPresentationSnapshot> ItemPresentations { get; set; } = new();
    public List<DiscoveryEffectVisualSnapshot> EffectVisuals { get; set; } = new();
    public List<DiscoveryBuildableSnapshot> Buildables { get; set; } = new();
    public List<DiscoveryPropertyLayoutSnapshot> PropertyLayouts { get; set; } = new();
    public List<DiscoveryLocationSnapshot> Locations { get; set; } = new();
    public List<DiscoveryPersonPresentationSnapshot> People { get; set; } = new();
    public List<DiscoveryNpcScheduleSnapshot> NpcSchedules { get; set; } = new();
    public List<DiscoveryShopDetailSnapshot> ShopDetails { get; set; } = new();
    public List<DiscoveryMapServiceSnapshot> MapServices { get; set; } = new();
    public List<DiscoveryTimedAccessZoneSnapshot> TimedAccessZones { get; set; } = new();
    public List<DiscoveryPresentationAssetCandidateSnapshot> PresentationAssetCandidates { get; set; } = new();
    public Dictionary<string, int> ServiceResourceCounts { get; set; } = new(StringComparer.Ordinal);
    public List<DiscoveryNamedSceneObjectSnapshot> NamedSceneServiceObjects { get; set; } = new();
}
internal sealed class DiscoveryNamedSceneObjectSnapshot
{
    public string Kind { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string ObjectPath { get; init; } = string.Empty;
    public string SceneName { get; init; } = string.Empty;
    public VectorSnapshot3 Position { get; init; } = new();
}

internal sealed class DiscoveryAssetSnapshot
{
    public string RelativePath { get; init; } = string.Empty;
    public string Sha256 { get; init; } = string.Empty;
    public int Width { get; init; }
    public int Height { get; init; }
    public string SpriteName { get; init; } = string.Empty;
    public string Error { get; init; } = string.Empty;
}

internal sealed class DiscoveryFileAssetSnapshot
{
    public string RelativePath { get; init; } = string.Empty;
    public string Sha256 { get; init; } = string.Empty;
    public int ByteLength { get; init; }
    public string Name { get; init; } = string.Empty;
    public string MediaType { get; init; } = string.Empty;
    public string Error { get; init; } = string.Empty;
}

internal sealed class DiscoveryItemPresentationSnapshot
{
    public string ItemId { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public DiscoveryAssetSnapshot? Icon { get; init; }
    public DiscoveryVisualCollectionSnapshot FallbackVisuals { get; set; } = new();
}

internal sealed class DiscoveryEffectVisualSnapshot
{
    public string EffectId { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public ColorSnapshot ProductColor { get; init; } = new();
    public ColorSnapshot LabelColor { get; init; } = new();
}

internal sealed class DiscoveryBuildableSnapshot
{
    public string ItemId { get; init; } = string.Empty;
    public string RuntimeType { get; init; } = string.Empty;
    public string PlacementKind { get; set; } = "free";
    public float HoldDistance { get; init; }
    public int? FootprintWidth { get; set; }
    public int? FootprintHeight { get; set; }
    public string TileSharingRule { get; set; } = string.Empty;
    public string TileSharingImplementation { get; set; } = string.Empty;
    public string ProceduralTileType { get; set; } = string.Empty;
    public bool? AllowRotation { get; set; }
    public float? RotationIncrement { get; set; }
    public List<string> ValidSurfaceTypes { get; set; } = new();
    public TransformSnapshot? BuildPoint { get; init; }
    public TransformSnapshot? MidAirCenterPoint { get; init; }
    public ColliderSnapshot? BoundingCollider { get; init; }
    public List<DiscoveryFootprintTileSnapshot> FootprintTiles { get; set; } = new();
    public List<string> ComponentTypes { get; set; } = new();
    public List<ColliderSnapshot> Colliders { get; set; } = new();
    public DiscoveryStorageSnapshot? Storage { get; set; }
    public List<DiscoveryTemperatureEmitterSnapshot> TemperatureEmitters { get; set; } = new();
    public List<DiscoveryInteractionPointSnapshot> InteractionPoints { get; set; } = new();
    public DiscoveryVisualCollectionSnapshot Visuals { get; set; } = new();
}

internal sealed class DiscoveryInteractionPointSnapshot
{
    public string ComponentType { get; init; } = string.Empty;
    public string Member { get; init; } = string.Empty;
    public string Role { get; init; } = string.Empty;
    public TransformSnapshot? Transform { get; init; }
}

internal sealed class DiscoveryFootprintTileSnapshot
{
    public int X { get; init; }
    public int Y { get; init; }
    public float RequiredOffset { get; init; }
    public TransformSnapshot? Transform { get; init; }
    public List<DiscoveryCornerObstacleSnapshot> Corners { get; set; } = new();
}

internal sealed class DiscoveryCornerObstacleSnapshot
{
    public bool ObstacleEnabled { get; init; }
    public VectorSnapshot2 Coordinates { get; init; } = new();
    public TransformSnapshot? Transform { get; init; }
}

internal sealed class DiscoveryStorageSnapshot
{
    public string Name { get; init; } = string.Empty;
    public string Subtitle { get; init; } = string.Empty;
    public int SlotCount { get; init; }
    public int DisplayRowCount { get; init; }
    public bool SlotsAreFilterable { get; init; }
    public float MaxAccessDistance { get; init; }
    public TransformSnapshot? Transform { get; init; }
}

internal sealed class DiscoveryTemperatureEmitterSnapshot
{
    public float Temperature { get; init; }
    public float Range { get; init; }
    public VectorSnapshot3? EmissionPoint { get; init; }
}

internal sealed class DiscoveryMapSnapshot
{
    public DiscoveryAssetSnapshot? MainMapSprite { get; set; }
    public DiscoveryAssetSnapshot? TutorialMapSprite { get; set; }
    public TransformSnapshot? MapAppTransform { get; set; }
    public string PositionUtilityType { get; set; } = string.Empty;
    public Dictionary<string, string> PositionUtilityMembers { get; set; } = new();
    public List<DiscoveryMapRegionSnapshot> Regions { get; set; } = new();
}

internal sealed class DiscoveryNavigationSnapshot
{
    public string Method { get; set; } = string.Empty;
    public float SampleSpacing { get; set; }
    public float QueryHeight { get; set; }
    public float MaxSampleDistance { get; set; }
    public VectorSnapshot3? BoundsMinimum { get; set; }
    public VectorSnapshot3? BoundsMaximum { get; set; }
    public int GridWidth { get; set; }
    public int GridHeight { get; set; }
    public int VertexCount { get; set; }
    public int TriangleCount { get; set; }
    public List<VectorSnapshot3> Vertices { get; set; } = new();
    public List<int> Indices { get; set; } = new();
    public List<int> Areas { get; set; } = new();
    public List<DiscoveryNavMeshSurfaceSnapshot> Surfaces { get; set; } = new();
    public List<DiscoveryNavigationSampleSnapshot> Samples { get; set; } = new();
    public List<int> Edges { get; set; } = new();
    public string Error { get; set; } = string.Empty;
    public string EdgeError { get; set; } = string.Empty;
}

internal sealed class DiscoveryNavMeshSurfaceSnapshot
{
    public string ObjectPath { get; init; } = string.Empty;
    public string SceneName { get; init; } = string.Empty;
    public TransformSnapshot? Transform { get; init; }
    public int AgentTypeId { get; init; }
    public string CollectObjects { get; init; } = string.Empty;
    public int LayerMask { get; init; }
    public string UseGeometry { get; init; } = string.Empty;
    public int DefaultArea { get; init; }
    public bool IgnoreNavMeshAgent { get; init; }
    public bool IgnoreNavMeshObstacle { get; init; }
    public bool OverrideTileSize { get; init; }
    public int TileSize { get; init; }
    public bool OverrideVoxelSize { get; init; }
    public float VoxelSize { get; init; }
    public float MinimumRegionArea { get; init; }
    public bool BuildHeightMesh { get; init; }
    public VectorSnapshot3? DataPosition { get; set; }
    public VectorSnapshot3? SourceBoundsCenter { get; set; }
    public VectorSnapshot3? SourceBoundsSize { get; set; }
    public bool HasHeightMeshData { get; set; }
    public string Error { get; set; } = string.Empty;
}

internal sealed class DiscoveryNavigationSampleSnapshot
{
    public int GridX { get; init; }
    public int GridZ { get; init; }
    public VectorSnapshot3 Position { get; init; } = new();
    public int AreaMask { get; init; }
}

internal sealed class DiscoveryMapRegionSnapshot
{
    public string Id { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public bool UnlockedByDefault { get; init; }
    public string RankRequirement { get; init; } = string.Empty;
    public DiscoveryAssetSnapshot? Sprite { get; init; }
    public string Bounds { get; init; } = string.Empty;
    public VectorSnapshot3? BoundsPointA { get; set; }
    public VectorSnapshot3? BoundsPointB { get; set; }
    public bool IsClosed { get; set; }
    public float VerticalSize { get; set; }
    public List<VectorSnapshot3> PolygonPoints { get; set; } = new();
    public List<string> AdjacentRegionIds { get; set; } = new();
}

internal sealed class DiscoveryLocationSnapshot
{
    public string Kind { get; init; } = string.Empty;
    public string Id { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public string RuntimeType { get; init; } = string.Empty;
    public VectorSnapshot3? Position { get; init; }
    public VectorSnapshot3? Rotation { get; init; }
    public string SceneName { get; init; } = string.Empty;
    public string PersonId { get; init; } = string.Empty;
    public List<DiscoveryAssetSnapshot> Icons { get; set; } = new();
}

internal sealed class DiscoveryPropertyLayoutSnapshot
{
    public string PropertyCode { get; init; } = string.Empty;
    public string PropertyName { get; init; } = string.Empty;
    public VectorSnapshot3? Position { get; init; }
    public VectorSnapshot3? Rotation { get; init; }
    public TransformSnapshot? SpawnPoint { get; init; }
    public TransformSnapshot? InteriorSpawnPoint { get; init; }
    public TransformSnapshot? NpcSpawnPoint { get; init; }
    public ColliderSnapshot? BoundingBox { get; init; }
    public List<ColliderSnapshot> BoundaryColliders { get; set; } = new();
    public List<ColliderSnapshot> Colliders { get; set; } = new();
    public List<DiscoverySurfaceSnapshot> Surfaces { get; set; } = new();
    public List<DiscoveryLoadingDockSnapshot> LoadingDocks { get; set; } = new();
    public List<DiscoveryGridSnapshot> Grids { get; set; } = new();
    public List<DiscoveryPlacedItemSnapshot> ItemsInLoadedSave { get; set; } = new();
    public DiscoveryVisualCollectionSnapshot Visuals { get; set; } = new();
}

internal sealed class DiscoverySurfaceSnapshot
{
    public string Guid { get; init; } = string.Empty;
    public string SurfaceType { get; init; } = string.Empty;
    public TransformSnapshot? Transform { get; init; }
    public TransformSnapshot? Container { get; init; }
    public List<string> ValidFaces { get; set; } = new();
}

internal sealed class DiscoveryLoadingDockSnapshot
{
    public string Guid { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string ParentPropertyCode { get; init; } = string.Empty;
    public TransformSnapshot? Transform { get; init; }
    public TransformSnapshot? ParkingTransform { get; init; }
    public int InputSlotCount { get; init; }
    public int OutputSlotCount { get; init; }
    public List<TransformSnapshot?> AccessPoints { get; set; } = new();
}

internal sealed class DiscoveryVisualCollectionSnapshot
{
    public List<DiscoveryRendererSnapshot> Renderers { get; set; } = new();
    public List<DiscoveryMeshInstanceSnapshot> Meshes { get; set; } = new();
}

internal sealed class DiscoveryRendererSnapshot
{
    public string RuntimeType { get; init; } = string.Empty;
    public TransformSnapshot? Transform { get; init; }
    public bool Enabled { get; init; }
    public VectorSnapshot3 BoundsCenter { get; init; } = new();
    public VectorSnapshot3 BoundsSize { get; init; } = new();
    public ColorSnapshot? Color { get; set; }
    public DiscoveryAssetSnapshot? Sprite { get; set; }
    public string MeshAssetReferenceKey { get; set; } = string.Empty;
    public List<string> MaterialAssetReferenceKeys { get; set; } = new();
}

internal sealed class DiscoveryMeshInstanceSnapshot
{
    public TransformSnapshot? Transform { get; init; }
    public string MeshAssetReferenceKey { get; init; } = string.Empty;
}

internal sealed class DiscoveryVisualAssetManifestSnapshot
{
    public List<DiscoveryMeshSnapshot> Meshes { get; set; } = new();
    public List<DiscoveryMaterialSnapshot> Materials { get; set; } = new();
}

internal sealed class DiscoveryMeshSnapshot
{
    public string AssetReferenceKey { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public bool IsReadable { get; init; }
    public bool CanExportGeometry { get; init; }
    public int VertexCount { get; init; }
    public int SubMeshCount { get; init; }
    public VectorSnapshot3 BoundsCenter { get; init; } = new();
    public VectorSnapshot3 BoundsSize { get; init; } = new();
    public DiscoveryFileAssetSnapshot? Asset { get; init; }
}

internal sealed class DiscoveryMaterialSnapshot
{
    public string AssetReferenceKey { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string ShaderName { get; init; } = string.Empty;
    public int RenderQueue { get; init; }
    public ColorSnapshot? Color { get; set; }
    public VectorSnapshot2 MainTextureScale { get; init; } = new();
    public VectorSnapshot2 MainTextureOffset { get; init; } = new();
    public List<DiscoveryMaterialTextureSnapshot> Textures { get; set; } = new();
    public List<DiscoveryShaderPropertySnapshot> ShaderProperties { get; set; } = new();
}

internal sealed class DiscoveryShaderPropertySnapshot
{
    public string Name { get; init; } = string.Empty;
    public string Type { get; init; } = string.Empty;
    public string Value { get; init; } = string.Empty;
}

internal sealed class DiscoveryMaterialTextureSnapshot
{
    public string PropertyName { get; init; } = string.Empty;
    public string AssetReferenceKey { get; init; } = string.Empty;
    public string TextureName { get; init; } = string.Empty;
    public string RuntimeType { get; init; } = string.Empty;
    public int Width { get; init; }
    public int Height { get; init; }
    public bool CanExport { get; init; }
    public DiscoveryAssetSnapshot? Asset { get; init; }
}

internal sealed class DiscoveryGridSnapshot
{
    public string Guid { get; init; } = string.Empty;
    public int Width { get; init; }
    public int Height { get; init; }
    public float TileSize { get; init; }
    public VectorSnapshot3? Origin { get; init; }
    public List<DiscoveryGridTileSnapshot> Tiles { get; set; } = new();
}

internal sealed class DiscoveryGridTileSnapshot
{
    public int X { get; init; }
    public int Y { get; init; }
    public float AvailableOffset { get; init; }
    public bool CanBeBuiltOnInLoadedSave { get; init; }
    public VectorSnapshot3? Position { get; init; }
    public VectorSnapshot3? Rotation { get; init; }
    public int BuildableOccupantCount { get; init; }
    public float TileTemperature { get; init; }
}

internal sealed class DiscoveryPlacedItemSnapshot
{
    public string ItemId { get; init; } = string.Empty;
    public string RuntimeType { get; init; } = string.Empty;
    public VectorSnapshot3? Position { get; init; }
    public VectorSnapshot3? Rotation { get; init; }
}

internal sealed class DiscoveryPersonPresentationSnapshot
{
    public string PersonId { get; init; } = string.Empty;
    public string InstanceKey { get; init; } = string.Empty;
    public int RuntimeInstanceId { get; init; }
    public string DisplayName { get; init; } = string.Empty;
    public string ObjectPath { get; init; } = string.Empty;
    public bool SharesArchetypeId { get; set; }
    public DiscoveryAssetSnapshot? Mugshot { get; init; }
    public DiscoveryVisualCollectionSnapshot ModelVisuals { get; init; } = new();
    public VectorSnapshot3? PositionInLoadedSave { get; init; }
}

internal sealed class DiscoveryNpcScheduleSnapshot
{
    public string PersonId { get; init; } = string.Empty;
    public string PersonInstanceKey { get; init; } = string.Empty;
    public List<DiscoveryNpcScheduleActionSnapshot> Actions { get; set; } = new();
}

internal sealed class DiscoveryNpcScheduleActionSnapshot
{
    public string RuntimeType { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public int StartTime { get; init; }
    public int EndTime { get; init; }
    public int? Duration { get; set; }
    public int? MaxDuration { get; set; }
    public string TimeDescription { get; init; } = string.Empty;
    public int Priority { get; init; }
    public bool IsEvent { get; init; }
    public bool IsSignal { get; init; }
    public DiscoveryLocationReferenceSnapshot? Location { get; set; }
    public string TargetResolution { get; set; } = string.Empty;
}

internal sealed class DiscoveryLocationReferenceSnapshot
{
    public string Member { get; init; } = string.Empty;
    public string ObjectName { get; init; } = string.Empty;
    public string ObjectPath { get; init; } = string.Empty;
    public VectorSnapshot3? Position { get; init; }
    public VectorSnapshot3? Rotation { get; init; }
}

internal sealed class DiscoveryShopDetailSnapshot
{
    public string Code { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public string PaymentType { get; init; } = string.Empty;
    public VectorSnapshot3? Position { get; init; }
    public VectorSnapshot3? Rotation { get; init; }
    public string SceneName { get; init; } = string.Empty;
    public TransformSnapshot? InterfaceTransform { get; init; }
    public string LocationSource { get; init; } = string.Empty;
    public string HolderPersonId { get; init; } = string.Empty;
    public string HolderInstanceKey { get; init; } = string.Empty;
    public string HolderRuntimeType { get; init; } = string.Empty;
    public int? OpenTime { get; init; }
    public int? CloseTime { get; init; }
    public int DeliveryBayCount { get; init; }
    public List<VectorSnapshot3> DeliveryBayPositions { get; set; } = new();
    public string State { get; init; } = string.Empty;
    public Dictionary<string, string> StateMembers { get; init; } = new();
}

internal sealed class DiscoveryMapServiceSnapshot
{
    public string Kind { get; init; } = string.Empty;
    public string Id { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public string RuntimeType { get; init; } = string.Empty;
    public string ObjectPath { get; init; } = string.Empty;
    public string InterfaceObjectPath { get; init; } = string.Empty;
    public string SceneName { get; init; } = string.Empty;
    public string Region { get; init; } = string.Empty;
    public VectorSnapshot3? Position { get; init; }
    public VectorSnapshot3? Rotation { get; init; }
    public TransformSnapshot? AccessPoint { get; init; }
    public string LocationSource { get; init; } = string.Empty;
    public string LinkedPersonId { get; init; } = string.Empty;
    public Dictionary<string, string> Mechanics { get; init; } = new();
    public List<DiscoveryMapServiceListingSnapshot> Listings { get; set; } = new();
}

internal sealed class DiscoveryMapServiceListingSnapshot
{
    public string ItemId { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public float Price { get; init; }
    public string Category { get; init; } = string.Empty;
    public bool RequiresLevel { get; init; }
    public string RequiredRank { get; init; } = string.Empty;
    public ColorSnapshot? DisplayColor { get; init; }
    public Dictionary<string, string> Metadata { get; init; } = new();
}

internal sealed class DiscoveryTimedAccessZoneSnapshot
{
    public string Id { get; init; } = string.Empty;
    public int OpenTime { get; init; }
    public int CloseTime { get; init; }
    public bool AllowExitWhenClosed { get; init; }
    public bool AutoCloseDoor { get; init; }
    public VectorSnapshot3? Position { get; init; }
    public VectorSnapshot3? Rotation { get; init; }
    public string SceneName { get; init; } = string.Empty;
    public int DoorCount { get; init; }
    public List<DiscoveryNearbyShopSnapshot> NearestShops { get; set; } = new();
}

internal sealed class DiscoveryNearbyShopSnapshot
{
    public string ShopCode { get; init; } = string.Empty;
    public float Distance { get; init; }
}

internal sealed class DiscoveryPresentationAssetCandidateSnapshot
{
    public string SubjectKind { get; init; } = string.Empty;
    public string SubjectId { get; init; } = string.Empty;
    public string DisplayName { get; init; } = string.Empty;
    public int MatchScore { get; init; }
    public string SpriteName { get; init; } = string.Empty;
    public string TextureName { get; init; } = string.Empty;
    public DiscoveryAssetSnapshot? Asset { get; init; }
}

internal sealed class TransformSnapshot
{
    public string Name { get; init; } = string.Empty;
    public string Path { get; init; } = string.Empty;
    public VectorSnapshot3 Position { get; init; } = new();
    public VectorSnapshot3 LocalPosition { get; init; } = new();
    public VectorSnapshot3 Rotation { get; init; } = new();
    public VectorSnapshot3 LocalScale { get; init; } = new();

    internal static TransformSnapshot? FromTransform(Transform? transform) => transform is null
        ? null
        : new TransformSnapshot
        {
            Name = transform.name ?? string.Empty,
            Path = DiscoveryReflection.ObjectPath(transform),
            Position = VectorSnapshot3.FromVector(transform.position),
            LocalPosition = VectorSnapshot3.FromVector(transform.localPosition),
            Rotation = VectorSnapshot3.FromVector(transform.eulerAngles),
            LocalScale = VectorSnapshot3.FromVector(transform.localScale),
        };
}

internal sealed class ColliderSnapshot
{
    public string Source { get; set; } = string.Empty;
    public string RuntimeType { get; init; } = string.Empty;
    public bool Enabled { get; init; }
    public bool IsTrigger { get; init; }
    public int Layer { get; init; }
    public string LayerName { get; init; } = string.Empty;
    public string Tag { get; init; } = string.Empty;
    public TransformSnapshot? Transform { get; init; }
    public VectorSnapshot3 WorldScale { get; init; } = new();
    public VectorSnapshot3 WorldRight { get; init; } = new();
    public VectorSnapshot3 WorldUp { get; init; } = new();
    public VectorSnapshot3 WorldForward { get; init; } = new();
    public VectorSnapshot3 BoundsCenter { get; init; } = new();
    public VectorSnapshot3 BoundsSize { get; init; } = new();
    public VectorSnapshot3? LocalCenter { get; init; }
    public VectorSnapshot3? LocalSize { get; init; }
    public float? Radius { get; init; }
    public float? Height { get; init; }
    public int? Direction { get; init; }
    public string MeshName { get; init; } = string.Empty;
    public string MeshAssetReferenceKey { get; init; } = string.Empty;
    public bool? MeshIsReadable { get; init; }
    public bool? IsConvex { get; init; }

    internal static ColliderSnapshot? FromCollider(Collider? collider)
    {
        if (collider is null)
        {
            return null;
        }

        VectorSnapshot3? localCenter = null;
        VectorSnapshot3? localSize = null;
        float? radius = null;
        float? height = null;
        int? direction = null;
        var meshName = string.Empty;
        var meshAssetReferenceKey = string.Empty;
        bool? meshIsReadable = null;
        bool? isConvex = null;

        var box = collider.TryCast<BoxCollider>();
        if (box is not null)
        {
            localCenter = VectorSnapshot3.FromVector(box.center);
            localSize = VectorSnapshot3.FromVector(box.size);
        }

        var sphere = collider.TryCast<SphereCollider>();
        if (sphere is not null)
        {
            localCenter = VectorSnapshot3.FromVector(sphere.center);
            radius = sphere.radius;
        }

        var capsule = collider.TryCast<CapsuleCollider>();
        if (capsule is not null)
        {
            localCenter = VectorSnapshot3.FromVector(capsule.center);
            radius = capsule.radius;
            height = capsule.height;
            direction = capsule.direction;
        }

        var mesh = collider.TryCast<MeshCollider>();
        if (mesh?.sharedMesh is not null)
        {
            meshName = mesh.sharedMesh.name ?? string.Empty;
            meshAssetReferenceKey =
                $"mesh:{mesh.sharedMesh.name}:{mesh.sharedMesh.GetInstanceID()}";
            meshIsReadable = mesh.sharedMesh.isReadable;
            isConvex = mesh.convex;
        }

        return new ColliderSnapshot
        {
            RuntimeType = DiscoveryReflection.RuntimeTypeName(collider),
            Enabled = collider.enabled,
            IsTrigger = collider.isTrigger,
            Layer = collider.gameObject.layer,
            LayerName = LayerMask.LayerToName(collider.gameObject.layer),
            Tag = collider.gameObject.tag ?? string.Empty,
            Transform = TransformSnapshot.FromTransform(collider.transform),
            WorldScale = VectorSnapshot3.FromVector(collider.transform.lossyScale),
            WorldRight = VectorSnapshot3.FromVector(collider.transform.TransformVector(Vector3.right)),
            WorldUp = VectorSnapshot3.FromVector(collider.transform.TransformVector(Vector3.up)),
            WorldForward = VectorSnapshot3.FromVector(
                collider.transform.TransformVector(Vector3.forward)),
            BoundsCenter = VectorSnapshot3.FromVector(collider.bounds.center),
            BoundsSize = VectorSnapshot3.FromVector(collider.bounds.size),
            LocalCenter = localCenter,
            LocalSize = localSize,
            Radius = radius,
            Height = height,
            Direction = direction,
            MeshName = meshName,
            MeshAssetReferenceKey = meshAssetReferenceKey,
            MeshIsReadable = meshIsReadable,
            IsConvex = isConvex,
        };
    }
}

internal sealed class VectorSnapshot3
{
    public float X { get; init; }
    public float Y { get; init; }
    public float Z { get; init; }

    internal static VectorSnapshot3 FromVector(Vector3 vector) => new()
    {
        X = vector.x,
        Y = vector.y,
        Z = vector.z,
    };

    public override string ToString() => $"({X:R},{Y:R},{Z:R})";
}

internal sealed class VectorSnapshot2
{
    public float X { get; init; }
    public float Y { get; init; }

    internal static VectorSnapshot2 FromVector(Vector2 vector) => new()
    {
        X = vector.x,
        Y = vector.y,
    };
}

internal sealed class ColorSnapshot
{
    public float R { get; init; }
    public float G { get; init; }
    public float B { get; init; }
    public float A { get; init; }
    public string HtmlRgba { get; init; } = string.Empty;

    internal static ColorSnapshot FromColor(Color color) => new()
    {
        R = color.r,
        G = color.g,
        B = color.b,
        A = color.a,
        HtmlRgba = $"#{ColorUtility.ToHtmlStringRGBA(color)}",
    };
}
