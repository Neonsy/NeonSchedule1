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
            "unity-navmesh-calculate-path-with-humanoid-agent-query-filter";
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

        var filter = new NavMeshQueryFilter
        {
            agentTypeID = navigation.Agent.TypeId,
            areaMask = NavMesh.AllAreas,
        };

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
                        navigation,
                        filter));
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
                    result.PlayerMovement,
                    filter);
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
        DiscoveryPlayerNavigationSnapshot navigation,
        NavMeshQueryFilter filter)
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
            candidate.CalculatePathReturned = NavMesh.CalculatePath(
                start,
                endHit.position,
                filter,
                path);
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

    private static DiscoveryPlayerControllerRouteCompatibilitySnapshot
        ProbePlayerControllerCompatibility(
            IReadOnlyList<VectorSnapshot3> corners,
            DiscoveryPlayerNavigationSnapshot navigation,
            DiscoveryPlayerMovementSnapshot movement,
            NavMeshQueryFilter filter)
    {
        var controller = movement.LoadedController;
        var probe = new DiscoveryPlayerControllerRouteCompatibilitySnapshot
        {
            Method = "navmesh-boundary-margin-and-route-elevation-envelope",
            Applicability =
                "candidate-static-controller-geometry-not-charactercontroller-move-proof",
            Limitation =
                "Does not simulate CharacterController.Move, dynamic obstacles, doors, " +
                "collision layers, scripts, or identify explicit link traversal.",
            SampleSpacing = navigation.ControllerClearanceSampleSpacing,
            ControllerRadius = controller?.Radius ?? 0f,
            AgentRadius = navigation.Agent.Radius,
            RequiredAdditionalRadius = controller is null
                ? 0f
                : MathF.Max(0f, controller.Radius - navigation.Agent.Radius),
            ControllerHeight = controller?.Height ?? 0f,
            AgentHeight = navigation.Agent.Height,
            ControllerSlopeLimit = controller?.SlopeLimit ?? 0f,
            AgentMaximumSlope = navigation.Agent.MaximumSlope,
            ControllerStepOffset = controller?.StepOffset ?? 0f,
            AgentStepHeight = navigation.Agent.StepHeight,
        };
        if (controller is null)
        {
            probe.Error = "No loaded player character controller was available.";
            return probe;
        }
        if (corners.Count == 0)
        {
            probe.Error = "The complete path exposed no corners.";
            return probe;
        }

        try
        {
            var (samples, routeSurfaceSampleFailureCount) = SamplePlayerRoute(
                corners,
                navigation.ControllerClearanceSampleSpacing,
                navigation.Agent.TypeId,
                navigation.Agent.StepHeight);
            probe.RouteSurfaceSampleFailureCount = routeSurfaceSampleFailureCount;
            var minimumBoundaryDistance = float.PositiveInfinity;
            for (var index = 0; index < samples.Count; index++)
            {
                if (NavMesh.FindClosestEdge(samples[index], out var hit, filter))
                {
                    probe.BoundarySampleCount++;
                    minimumBoundaryDistance = MathF.Min(
                        minimumBoundaryDistance,
                        hit.distance);
                }
                else
                {
                    probe.BoundaryQueryFailureCount++;
                }
            }
            if (float.IsFinite(minimumBoundaryDistance))
            {
                probe.MinimumBoundaryDistance = minimumBoundaryDistance;
            }

            var slopeRadians = controller.SlopeLimit * (MathF.PI / 180f);
            for (var index = 1; index < samples.Count; index++)
            {
                var delta = samples[index] - samples[index - 1];
                var horizontalDistance = MathF.Sqrt(
                    (delta.x * delta.x) + (delta.z * delta.z));
                var absoluteRise = MathF.Abs(delta.y);
                var allowedRise =
                    (horizontalDistance * MathF.Tan(slopeRadians)) +
                    controller.StepOffset;
                probe.MaximumObservedAbsoluteRise = MathF.Max(
                    probe.MaximumObservedAbsoluteRise,
                    absoluteRise);
                probe.MaximumObservedElevationExcess = MathF.Max(
                    probe.MaximumObservedElevationExcess,
                    absoluteRise - allowedRise);
            }

            const float tolerance = 1e-4f;
            probe.RadiusMarginSatisfied =
                probe.BoundaryQueryFailureCount == 0 &&
                probe.MinimumBoundaryDistance is float minimumDistance &&
                minimumDistance + tolerance >= probe.RequiredAdditionalRadius;
            probe.HeightEnvelopeSatisfied =
                controller.Height <= navigation.Agent.Height + tolerance;
            probe.RouteElevationSatisfied =
                probe.RouteSurfaceSampleFailureCount == 0 &&
                probe.MaximumObservedElevationExcess <= tolerance;
            probe.SupportedByProbe =
                probe.RadiusMarginSatisfied &&
                probe.HeightEnvelopeSatisfied &&
                probe.RouteElevationSatisfied;
        }
        catch (Exception exception)
        {
            probe.Error = $"{exception.GetType().Name}: {exception.Message}";
        }
        return probe;
    }

    private static (List<Vector3> Samples, int FailureCount) SamplePlayerRoute(
        IReadOnlyList<VectorSnapshot3> corners,
        float spacing,
        int agentTypeId,
        float agentStepHeight)
    {
        var rawSamples = new List<Vector3> { ToVector(corners[0]) };
        for (var index = 1; index < corners.Count; index++)
        {
            var start = ToVector(corners[index - 1]);
            var end = ToVector(corners[index]);
            var delta = end - start;
            var horizontalDistance = MathF.Sqrt(
                (delta.x * delta.x) + (delta.z * delta.z));
            var steps = Math.Max(1, (int)MathF.Ceiling(horizontalDistance / spacing));
            for (var step = 1; step <= steps; step++)
            {
                rawSamples.Add(Vector3.Lerp(start, end, step / (float)steps));
            }
        }

        var samples = new List<Vector3>(rawSamples.Count);
        var failureCount = 0;
        var maxSampleDistance = MathF.Max(spacing * 2f, agentStepHeight + 0.1f);
        for (var index = 0; index < rawSamples.Count; index++)
        {
            if (NavMesh.SamplePositionFilter(
                    rawSamples[index],
                    out var hit,
                    maxSampleDistance,
                    agentTypeId,
                    NavMesh.AllAreas))
            {
                samples.Add(hit.position);
            }
            else
            {
                failureCount++;
                samples.Add(rawSamples[index]);
            }
        }
        return (samples, failureCount);
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
