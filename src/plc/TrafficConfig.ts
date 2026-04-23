import type { SensorType } from './SensorTypes';

export type LightState = 'RED' | 'YELLOW' | 'GREEN';

export interface PhaseConfig {
    name: string;
    duration: number | 'dynamic';
    lights: Record<string, LightState>;
}

export interface IntersectionConfig {
    id: string;
    lanes: string[];
    laneToLight: Record<string, string>;
    phases: PhaseConfig[];
    adjacentIntersections?: string[];
}

export interface BusPriorityConfig {
    enabled: boolean;
    busLanes: string[];
    minGreenExtension: number;
    maxGreenExtension: number;
    cooldownAfterBus: number;
    starvationGuardSeconds: number;
}

export interface EmergencyPreemptionConfig {
    enabled: boolean;
    emergencyLanes: string[];
    clearTime: number;
    postPreemptionPhase: 'RESUME' | 'GREEN';
}

export interface TimingParameters {
    minGreenTime: number;
    maxGreenTime: number;
    yellowTime: number;
    defaultRedTime: number;
    timePerVehicle: number;
    baseGreenTime: number;
    peakMorningStart: number;
    peakMorningEnd: number;
    peakEveningStart: number;
    peakEveningEnd: number;
}

export interface SensorBindingConfig {
    id: string;
    type: SensorType;
    laneId?: string;
}

export interface SensorsConfig {
    queueDetectors: string[];
    busDetectors: string[];
    emergencyDetectors: string[];
    pedestrianDetectors?: string[];
}

export interface CoordinationConfig {
    enabled: boolean;
    maxOffsetSeconds: number;
}

export interface SmartPLCConfig {
    intersections: IntersectionConfig[];
    busPriority: BusPriorityConfig;
    emergencyPreemption: EmergencyPreemptionConfig;
    timingParameters: TimingParameters;
    sensors: SensorsConfig;
    coordination?: CoordinationConfig;
    sensorBindings?: SensorBindingConfig[];
}

export interface ValidationResult {
    valid: boolean;
    errors: string[];
}

const DEFAULT_COORDINATION: CoordinationConfig = {
    enabled: true,
    maxOffsetSeconds: 6,
};

export function normalizeSmartPLCConfig(config: SmartPLCConfig): SmartPLCConfig {
    return {
        ...config,
        coordination: config.coordination ?? DEFAULT_COORDINATION,
        timingParameters: {
            ...config.timingParameters,
            peakMorningStart: config.timingParameters.peakMorningStart ?? 7,
            peakMorningEnd: config.timingParameters.peakMorningEnd ?? 9,
            peakEveningStart: config.timingParameters.peakEveningStart ?? 17,
            peakEveningEnd: config.timingParameters.peakEveningEnd ?? 19,
        },
    };
}

export function validateSmartPLCConfig(config: SmartPLCConfig): ValidationResult {
    const errors: string[] = [];

    if (!Array.isArray(config.intersections) || config.intersections.length === 0) {
        errors.push('At least one intersection is required.');
    }

    const intersectionIds = new Set<string>();
    config.intersections.forEach((intersection, index) => {
        if (!intersection.id) {
            errors.push(`Intersection at index ${index} is missing id.`);
        }

        if (intersectionIds.has(intersection.id)) {
            errors.push(`Duplicate intersection id: ${intersection.id}`);
        }
        intersectionIds.add(intersection.id);

        if (!intersection.lanes.length) {
            errors.push(`Intersection ${intersection.id} must define lanes.`);
        }

        if (!intersection.phases.length) {
            errors.push(`Intersection ${intersection.id} must define at least one phase.`);
        }

        intersection.phases.forEach((phase, phaseIndex) => {
            if (!phase.name) {
                errors.push(`Intersection ${intersection.id} phase ${phaseIndex} has empty name.`);
            }

            if (phase.duration !== 'dynamic' && phase.duration <= 0) {
                errors.push(
                    `Intersection ${intersection.id} phase ${phase.name} has invalid duration.`,
                );
            }

            intersection.lanes.forEach((laneId) => {
                if (!phase.lights[laneId]) {
                    errors.push(
                        `Intersection ${intersection.id} phase ${phase.name} missing light state for lane ${laneId}.`,
                    );
                }
            });
        });

        intersection.lanes.forEach((laneId) => {
            if (!intersection.laneToLight[laneId]) {
                errors.push(
                    `Intersection ${intersection.id} lane ${laneId} missing laneToLight mapping.`,
                );
            }
        });
    });

    if (config.busPriority.minGreenExtension > config.busPriority.maxGreenExtension) {
        errors.push('busPriority.minGreenExtension cannot exceed maxGreenExtension.');
    }

    if (config.timingParameters.minGreenTime > config.timingParameters.maxGreenTime) {
        errors.push('timingParameters.minGreenTime cannot exceed maxGreenTime.');
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

export function assertValidSmartPLCConfig(config: SmartPLCConfig): SmartPLCConfig {
    const normalized = normalizeSmartPLCConfig(config);
    const validation = validateSmartPLCConfig(normalized);
    if (!validation.valid) {
        throw new Error(`Invalid SmartPLCConfig: ${validation.errors.join(' | ')}`);
    }
    return normalized;
}
