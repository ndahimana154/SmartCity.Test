import type { LaneMetrics } from './SensorTypes';
import type { TimingParameters } from './TrafficConfig';

export interface GreenTimeInput {
    laneId: string;
    queueLength: number;
    vehicleCount: number;
    timeOfDayHour: number;
    busWaiting: boolean;
    emergencyWaiting: boolean;
    pedestrianWaiting: boolean;
}

export interface ScriptHooks {
    calculateGreenTime?: (
        laneId: string,
        queueLength: number,
        timeOfDayHour: number,
        busWaiting: boolean,
    ) => number;
}

/**
 * Computes adaptive green times from sensor metrics and timing policy.
 * Deterministic by design: pure function over explicit inputs.
 */
export class DynamicTimingEngine {
    private config: TimingParameters;

    constructor(config: TimingParameters) {
        this.config = config;
    }

    updateConfig(config: TimingParameters): void {
        this.config = config;
    }

    computeGreenTime(input: GreenTimeInput, hooks?: ScriptHooks): number {
        if (input.emergencyWaiting) {
            return this.config.maxGreenTime;
        }

        if (hooks?.calculateGreenTime) {
            const user = hooks.calculateGreenTime(
                input.laneId,
                input.queueLength,
                input.timeOfDayHour,
                input.busWaiting,
            );
            if (Number.isFinite(user)) {
                return this.clamp(user);
            }
        }

        const isMorningPeak =
            input.timeOfDayHour >= this.config.peakMorningStart &&
            input.timeOfDayHour <= this.config.peakMorningEnd;
        const isEveningPeak =
            input.timeOfDayHour >= this.config.peakEveningStart &&
            input.timeOfDayHour <= this.config.peakEveningEnd;

        const peakMultiplier = isMorningPeak || isEveningPeak ? 1.35 : 1;
        const pedestrianBonus = input.pedestrianWaiting ? 2 : 0;
        const busBonus = input.busWaiting ? 6 : 0;

        const computed =
            this.config.baseGreenTime +
            input.queueLength * this.config.timePerVehicle +
            input.vehicleCount * 0.35 +
            pedestrianBonus +
            busBonus;

        return this.clamp(computed * peakMultiplier);
    }

    computeLaneGreenTimes(
        laneMetrics: Record<string, LaneMetrics>,
        simulationTimeSeconds: number,
        hooks?: ScriptHooks,
    ): Record<string, number> {
        const timeOfDayHour = (simulationTimeSeconds % 86400) / 3600;
        const result: Record<string, number> = {};

        Object.values(laneMetrics).forEach((metrics) => {
            result[metrics.laneId] = this.computeGreenTime(
                {
                    laneId: metrics.laneId,
                    queueLength: metrics.queueLength,
                    vehicleCount: metrics.vehicleCount,
                    timeOfDayHour,
                    busWaiting: metrics.busWaiting,
                    emergencyWaiting: metrics.emergencyWaiting,
                    pedestrianWaiting: metrics.pedestrianWaiting,
                },
                hooks,
            );
        });

        return result;
    }

    private clamp(value: number): number {
        return Math.max(
            this.config.minGreenTime,
            Math.min(this.config.maxGreenTime, Math.round(value * 10) / 10),
        );
    }
}
