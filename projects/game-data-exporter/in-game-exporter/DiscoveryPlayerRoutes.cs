using Unity.AI.Navigation;
using UnityEngine;
using UnityEngine.AI;

namespace NeonSchedule1.GameDataExporter;

internal static partial class DiscoveryCollector
{
    private const float PlayerRouteEndpointMaxSampleDistance = 12f;
    private const float PlayerControllerClearanceSampleSpacing = 0.25f;

    private static void ConfigurePlayerRouteProbe(
        DiscoveryPlayerNavigationSnapshot navigation)
    {
        navigation.LinkApplicability =
            "loaded-scene-link-inventory-link-use-by-player-charactercontroller-not-established";
        navigation.RouteProbeMethod =
            "unity-navmesh-calculate-path-with-explicit-humanoid-agent";
        navigation.RouteProbeApplicability =
            "candidate-property-to-physical-shop-topology-and-controller-envelope-not-native-player-movement";
        navigation.RouteEndpointMaxSampleDistance =
            PlayerRouteEndpointMaxSampleDistance;
        navigation.ControllerClearanceSampleSpacing =
            PlayerControllerClearanceSampleSpacing;
    }

    private static void CollectPlayerNavigationLinks(
        DiscoveryPlayerNavigationSnapshot navigation,
        int? playerAgentTypeId)
    {
        try
        {
            var links = Resources.FindObjectsOfTypeAll<NavMeshLink>();
            for (var index = 0; index < links.Length; index++)
            {
                var link = links[index];
                if (link is null || !DiscoveryReflection.IsSceneObject(link.gameObject))
                {
                    continue;
                }

                try
                {
                    navigation.Links.Add(new DiscoveryNavigationLinkSnapshot
                    {
                        Source = "Unity.AI.Navigation.NavMeshLink",
                        ObjectPath = DiscoveryReflection.ObjectPath(link.transform),
                        SceneName = link.gameObject.scene.name,
                        Enabled = link.enabled,
                        ActiveInHierarchy = link.gameObject.activeInHierarchy,
                        AgentTypeId = link.agentTypeID,
                        MatchesPlayerAgent = playerAgentTypeId is null
                            ? null
                            : link.agentTypeID == playerAgentTypeId.Value,
                        StartPosition = VectorSnapshot3.FromVector(
                            link.transform.TransformPoint(link.startPoint)),
                        EndPosition = VectorSnapshot3.FromVector(
                            link.transform.TransformPoint(link.endPoint)),
                        Width = link.width,
                        CostModifier = link.costModifier,
                        Bidirectional = link.bidirectional,
                        Area = link.area,
                        AutoUpdatePositions = link.autoUpdate,
                    });
                }
                catch (Exception exception)
                {
                    navigation.Links.Add(new DiscoveryNavigationLinkSnapshot
                    {
                        Source = "Unity.AI.Navigation.NavMeshLink",
                        ObjectPath = DiscoveryReflection.ObjectPath(link.transform),
                        SceneName = link.gameObject.scene.name,
                        Error = $"{exception.GetType().Name}: {exception.Message}",
                    });
                }
            }

            var legacyLinks = Resources.FindObjectsOfTypeAll<OffMeshLink>();
            for (var index = 0; index < legacyLinks.Length; index++)
            {
                var link = legacyLinks[index];
                if (link is null || !DiscoveryReflection.IsSceneObject(link.gameObject))
                {
                    continue;
                }

                try
                {
                    navigation.Links.Add(new DiscoveryNavigationLinkSnapshot
                    {
                        Source = "UnityEngine.AI.OffMeshLink",
                        ObjectPath = DiscoveryReflection.ObjectPath(link.transform),
                        SceneName = link.gameObject.scene.name,
                        Enabled = link.enabled,
                        ActiveInHierarchy = link.gameObject.activeInHierarchy,
                        AgentTypeId = null,
                        MatchesPlayerAgent = null,
                        StartPosition = link.startTransform is null
                            ? null
                            : VectorSnapshot3.FromVector(link.startTransform.position),
                        EndPosition = link.endTransform is null
                            ? null
                            : VectorSnapshot3.FromVector(link.endTransform.position),
                        Width = null,
                        CostModifier = link.costOverride,
                        Bidirectional = link.biDirectional,
                        Area = link.area,
                        AutoUpdatePositions = link.autoUpdatePositions,
                        Activated = link.activated,
                        Occupied = link.occupied,
                    });
                }
                catch (Exception exception)
                {
                    navigation.Links.Add(new DiscoveryNavigationLinkSnapshot
                    {
                        Source = "UnityEngine.AI.OffMeshLink",
                        ObjectPath = DiscoveryReflection.ObjectPath(link.transform),
                        SceneName = link.gameObject.scene.name,
                        Error = $"{exception.GetType().Name}: {exception.Message}",
                    });
                }
            }

            navigation.Links = navigation.Links
                .OrderBy(link => link.Source, StringComparer.Ordinal)
                .ThenBy(link => link.ObjectPath, StringComparer.Ordinal)
                .ToList();
        }
        catch (Exception exception)
        {
            navigation.LinkError =
                $"Navigation link collection failed: {exception.GetType().Name}: " +
                exception.Message;
        }
    }

    private static void CollectPlayerRouteProbes(
        DiscoverySnapshot result,
        Action<string>? progress)
    {
        try
        {
            CollectPlayerRouteProbesCore(result, progress);
        }
        catch (Exception exception)
        {
            result.PlayerNavigation.RouteProbeError =
                $"Player route probe collection failed: {exception.GetType().Name}: " +
                exception.Message;
        }
    }

    private static void CollectPlayerRouteProbesCore(
        DiscoverySnapshot result,
        Action<string>? progress)
    {
        var navigation = result.PlayerNavigation;
        if (navigation.Agent.Name.Length == 0)
        {
            navigation.RouteProbeError =
                "No candidate player navigation agent was available for route probes.";
            return;
        }

        var properties = result.PropertyLayouts
            .Where(property => property.SpawnPoint is not null)
            .OrderBy(property => property.PropertyCode, StringComparer.Ordinal)
            .ToList();
        var shops = result.ShopDetails
            .Select(shop => new PlayerRouteShop(
                shop,
                PlayerRouteEndpoints(shop)))
            .Where(shop => shop.Endpoints.Count > 0)
            .OrderBy(shop => shop.Shop.Code, StringComparer.Ordinal)
            .ThenBy(shop => shop.Shop.HolderInstanceKey, StringComparer.Ordinal)
            .ToList();
        if (properties.Count == 0 || shops.Count == 0)
        {
            navigation.RouteProbeError =
                $"Route probes require property spawn points and physical shop endpoints. " +
                $"Found {properties.Count} properties and {shops.Count} shops.";
            return;
        }

        for (var propertyIndex = 0; propertyIndex < properties.Count; propertyIndex++)
        {
            var property = properties[propertyIndex];
            var requestedStart = ToVector(property.SpawnPoint!.Position);
            var sampledStartAvailable = NavMesh.SamplePositionFilter(
                requestedStart,
                out var startHit,
                navigation.RouteEndpointMaxSampleDistance,
                navigation.Agent.TypeId,
                NavMesh.AllAreas);

            for (var shopIndex = 0; shopIndex < shops.Count; shopIndex++)
            {
                var shop = shops[shopIndex];
                var route = new DiscoveryPlayerRouteProbeSnapshot
                {
                    PropertyCode = property.PropertyCode,
                    ShopCode = shop.Shop.Code,
                    ShopInstanceKey = shop.Shop.HolderInstanceKey,
                    RequestedStart = VectorSnapshot3.FromVector(requestedStart),
                };
                navigation.RouteProbes.Add(route);

                if (!sampledStartAvailable)
                {
                    route.Outcome = "start-not-on-candidate-navmesh";
                    route.Error =
                        $"Property spawn did not sample within " +
                        $"{navigation.RouteEndpointMaxSampleDistance:R} world units.";
                    continue;
                }

                route.SampledStart = VectorSnapshot3.FromVector(startHit.position);
                route.StartSampleDistance = Vector3.Distance(
                    requestedStart,
                    startHit.position);
                for (var endpointIndex = 0;
                     endpointIndex < shop.Endpoints.Count;
                     endpointIndex++)
                {
                    route.Candidates.Add(ProbePlayerRouteCandidate(
                        startHit.position,
                        shop.Endpoints[endpointIndex],
                        navigation));
                }

                var selected = route.Candidates
                    .Where(candidate =>
                        candidate.CalculatePathReturned &&
                        candidate.PathLength is not null &&
                        candidate.Error.Length == 0 &&
                        string.Equals(
                            candidate.PathStatus,
                            NavMeshPathStatus.PathComplete.ToString(),
                            StringComparison.Ordinal))
                    .OrderBy(candidate => candidate.PathLength)
                    .ThenBy(candidate => candidate.EndpointKind, StringComparer.Ordinal)
                    .ThenBy(candidate => candidate.EndpointIndex)
                    .FirstOrDefault();
                if (selected is null)
                {
                    route.Outcome = "no-complete-candidate-navmesh-path";
                    continue;
                }

                selected.IsSelected = true;
                selected.ControllerCompatibility = ProbePlayerControllerCompatibility(
                    selected.Corners,
                    navigation,
                    result.PlayerMovement);
                route.Outcome = selected.ControllerCompatibility.SupportedByProbe
                    ? "complete-path-controller-envelope-supported-by-probe"
                    : "complete-path-controller-envelope-not-supported-by-probe";
            }

            progress?.Invoke(
                $"Discovery 9/9 progress: probed {propertyIndex + 1}/{properties.Count} " +
                $"property starts against {shops.Count} physical shops.");
        }
    }

    private static DiscoveryPlayerRouteCandidateSnapshot ProbePlayerRouteCandidate(
        Vector3 start,
        PlayerRouteEndpoint endpoint,
        DiscoveryPlayerNavigationSnapshot navigation)
    {
        var candidate = new DiscoveryPlayerRouteCandidateSnapshot
        {
            EndpointKind = endpoint.Kind,
            EndpointIndex = endpoint.Index,
            RequestedEnd = VectorSnapshot3.FromVector(endpoint.Position),
        };
        try
        {
            if (!NavMesh.SamplePositionFilter(
                    endpoint.Position,
                    out var endHit,
                    navigation.RouteEndpointMaxSampleDistance,
                    navigation.Agent.TypeId,
                    NavMesh.AllAreas))
            {
                candidate.PathStatus = "endpoint-not-on-candidate-navmesh";
                return candidate;
            }

            candidate.SampledEnd = VectorSnapshot3.FromVector(endHit.position);
            candidate.EndSampleDistance = Vector3.Distance(
                endpoint.Position,
                endHit.position);
            var path = new NavMeshPath();
            // Avoid retaining the generated IL2CPP query-filter wrapper.
            // Null costs preserve the filter's default area-cost behavior.
            candidate.CalculatePathReturned = NavMesh.CalculatePathFilterInternal(
                start,
                endHit.position,
                path,
                navigation.Agent.TypeId,
                NavMesh.AllAreas,
                null!);
            candidate.PathStatus = path.status.ToString();
            var corners = path.corners;
            for (var cornerIndex = 0; cornerIndex < corners.Length; cornerIndex++)
            {
                candidate.Corners.Add(VectorSnapshot3.FromVector(corners[cornerIndex]));
            }
            candidate.PathLength = PlayerRouteLength(candidate.Corners);
        }
        catch (Exception exception)
        {
            candidate.Error = $"{exception.GetType().Name}: {exception.Message}";
        }
        return candidate;
    }

    private static List<PlayerRouteEndpoint> PlayerRouteEndpoints(
        DiscoveryShopDetailSnapshot shop)
    {
        var endpoints = new List<PlayerRouteEndpoint>();
        if (shop.Position is not null)
        {
            endpoints.Add(new PlayerRouteEndpoint(
                "shop-position",
                0,
                ToVector(shop.Position)));
        }
        for (var index = 0; index < shop.DeliveryBayPositions.Count; index++)
        {
            var position = ToVector(shop.DeliveryBayPositions[index]);
            if (endpoints.Any(endpoint =>
                    Vector3.Distance(endpoint.Position, position) <= 0.01f))
            {
                continue;
            }
            endpoints.Add(new PlayerRouteEndpoint("delivery-bay", index, position));
        }
        return endpoints;
    }

    private static float PlayerRouteLength(
        IReadOnlyList<VectorSnapshot3> corners)
    {
        var distance = 0f;
        for (var index = 1; index < corners.Count; index++)
        {
            distance += Vector3.Distance(
                ToVector(corners[index - 1]),
                ToVector(corners[index]));
        }
        return distance;
    }

    private static Vector3 ToVector(VectorSnapshot3 vector) =>
        new(vector.X, vector.Y, vector.Z);

    private sealed record PlayerRouteEndpoint(
        string Kind,
        int Index,
        Vector3 Position);

    private sealed record PlayerRouteShop(
        DiscoveryShopDetailSnapshot Shop,
        List<PlayerRouteEndpoint> Endpoints);
}
