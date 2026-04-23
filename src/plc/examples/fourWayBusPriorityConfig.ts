import type { SmartPLCConfig } from '../TrafficConfig';

export const fourWayBusPriorityConfig: SmartPLCConfig = {
    intersections: [
        {
            id: 'main_1',
            lanes: ['north', 'south', 'east', 'west', 'north_bus'],
            laneToLight: {
                north: 'north_light',
                south: 'south_light',
                east: 'east_light',
                west: 'west_light',
                north_bus: 'north_bus_light',
            },
            adjacentIntersections: ['main_2'],
            phases: [
                {
                    name: 'NS_GREEN',
                    duration: 'dynamic',
                    lights: {
                        north: 'GREEN',
                        south: 'GREEN',
                        east: 'RED',
                        west: 'RED',
                        north_bus: 'GREEN',
                    },
                },
                {
                    name: 'NS_YELLOW',
                    duration: 3,
                    lights: {
                        north: 'YELLOW',
                        south: 'YELLOW',
                        east: 'RED',
                        west: 'RED',
                        north_bus: 'YELLOW',
                    },
                },
                {
                    name: 'EW_GREEN',
                    duration: 'dynamic',
                    lights: {
                        north: 'RED',
                        south: 'RED',
                        east: 'GREEN',
                        west: 'GREEN',
                        north_bus: 'RED',
                    },
                },
                {
                    name: 'EW_YELLOW',
                    duration: 3,
                    lights: {
                        north: 'RED',
                        south: 'RED',
                        east: 'YELLOW',
                        west: 'YELLOW',
                        north_bus: 'RED',
                    },
                },
            ],
        },
    ],
    busPriority: {
        enabled: true,
        busLanes: ['north_bus'],
        minGreenExtension: 5,
        maxGreenExtension: 15,
        cooldownAfterBus: 30,
        starvationGuardSeconds: 45,
    },
    emergencyPreemption: {
        enabled: true,
        emergencyLanes: ['all'],
        clearTime: 2,
        postPreemptionPhase: 'GREEN',
    },
    timingParameters: {
        minGreenTime: 5,
        maxGreenTime: 60,
        yellowTime: 3,
        defaultRedTime: 2,
        timePerVehicle: 2,
        baseGreenTime: 10,
        peakMorningStart: 7,
        peakMorningEnd: 9,
        peakEveningStart: 17,
        peakEveningEnd: 19,
    },
    sensors: {
        queueDetectors: ['north_queue', 'south_queue', 'east_queue', 'west_queue'],
        busDetectors: ['north_bus_sensor'],
        emergencyDetectors: ['emergency_zone_1'],
        pedestrianDetectors: ['north_ped_button', 'east_ped_button'],
    },
    coordination: {
        enabled: true,
        maxOffsetSeconds: 6,
    },
};
