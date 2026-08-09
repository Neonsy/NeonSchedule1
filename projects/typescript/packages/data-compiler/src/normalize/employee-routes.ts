import {
    NavigationNetwork,
    type NavigationGraph,
    type Property,
    type PropertyLayout,
    type Vector3,
} from '@neonschedule1/core';

import { Integrity } from '#data-compiler/integrity';

interface EmployeePropertyEntrance {
    readonly code: string;
    readonly position: Vector3;
}

export function validateEmployeeRoutes(
    navigation: NavigationGraph,
    properties: readonly Property[],
    layouts: readonly PropertyLayout[],
    integrity: Integrity
): void {
    const network = new NavigationNetwork(navigation);
    const maximumSnapDistance = navigation.sampleSpacing;
    const layoutsByProperty = new Map(layouts.map((layout) => [layout.propertyCode, layout]));
    const entrances: EmployeePropertyEntrance[] = [];

    for (const property of properties.filter(({ employeeCapacity }) => employeeCapacity > 0)) {
        const layout = layoutsByProperty.get(property.code);
        if (layout === undefined) {
            integrity.addError(`Employee property ${JSON.stringify(property.code)} has no layout`);
            continue;
        }
        const entrance = layout.spawnPoint.worldPosition;
        const endpoint = network.nearestSample(entrance, maximumSnapDistance);
        integrity.check(
            `employee property ${property.code} entrance is on the navigation network`,
            endpoint !== null,
            `Employee property ${JSON.stringify(property.code)} entrance is outside the navigation network`
        );
        if (endpoint === null) continue;
        entrances.push({ code: property.code, position: entrance });
        validateLoadingDockRoutes(network, maximumSnapDistance, layout, entrance, integrity);
    }

    for (let startIndex = 0; startIndex < entrances.length; startIndex++) {
        for (let endIndex = startIndex + 1; endIndex < entrances.length; endIndex++) {
            const start = entrances[startIndex]!;
            const end = entrances[endIndex]!;
            const route = network.findPathToNearestReachable({
                start: start.position,
                end: end.position,
                maximumStartSnapDistance: maximumSnapDistance,
                maximumEndSnapDistance: maximumSnapDistance,
            });
            integrity.check(
                `employee properties ${start.code} and ${end.code} are connected`,
                route.kind === 'found',
                `Employee properties ${JSON.stringify(start.code)} and ${JSON.stringify(end.code)} ` +
                    `are disconnected${route.kind === 'unreachable' ? `: ${route.reason}` : ''}`
            );
        }
    }
}

function validateLoadingDockRoutes(
    network: NavigationNetwork,
    maximumSnapDistance: number,
    layout: PropertyLayout,
    entrance: Vector3,
    integrity: Integrity
): void {
    layout.loadingDocks.forEach((dock, dockIndex) => {
        dock.accessPoints.forEach((accessPoint, accessPointIndex) => {
            const route = network.findPathToNearestReachable({
                start: entrance,
                end: accessPoint.worldPosition,
                maximumStartSnapDistance: maximumSnapDistance,
                maximumEndSnapDistance: maximumSnapDistance,
            });
            integrity.check(
                `employee property ${layout.propertyCode} loading dock ${dockIndex} access ${accessPointIndex} is reachable`,
                route.kind === 'found',
                `Employee property ${JSON.stringify(layout.propertyCode)} loading dock ` +
                    `${dockIndex} access ${accessPointIndex} is unreachable` +
                    `${route.kind === 'unreachable' ? `: ${route.reason}` : ''}`
            );
        });
    });
}
