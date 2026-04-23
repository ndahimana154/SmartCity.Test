import type { LaneMetrics } from './SensorTypes';
import type { BusPriorityConfig, IntersectionConfig } from './TrafficConfig';

export interface BusPriorityDecision {
    targetLaneId: string | null;
    extensionSeconds: number;
    immediateSwitch: boolean;
    reason: string;
}

export interface BusPriorityContext {
    timeSeconds: number;
    currentLaneStates: Record<string, 'RED' | 'YELLOW' | 'GREEN'>;
    laneMetrics: Record<string, LaneMetrics>;
    currentPhaseElapsed: number;
    intersection: IntersectionConfig;
}

/**
 * Bus priority policy for dedicated lanes with starvation protection.
 * Deterministic: no random source, no wall-clock dependency.
 */
export class BusPriorityModule {
    private config: BusPriorityConfig;
    private readonly laneCooldownUntil = new Map<string, number>();
    private readonly laneLastGrantedAt = new Map<string, number>();
    private readonly laneBusCounter = new Map<string, number>();

    constructor(config: BusPriorityConfig) {
        this.config = config;
    }

    updateConfig(config: BusPriorityConfig): void {
        this.config = config;
        this.laneCooldownUntil.clear();
        this.laneLastGrantedAt.clear();
        this.laneBusCounter.clear();
    }

    getBusCount(laneId: string): number {
        return this.laneBusCounter.get(laneId) ?? 0;
    }

    registerBusPass(laneId: string): void {
        this.laneBusCounter.set(laneId, (this.laneBusCounter.get(laneId) ?? 0) + 1);
    }

    decide(context: BusPriorityContext): BusPriorityDecision {
        if (!this.config.enabled) {
            return {
                targetLaneId: null,
                extensionSeconds: 0,
                immediateSwitch: false,
                reason: 'bus-priority-disabled',
            };
        }

        const candidates = this.config.busLanes.filter((laneId) => {
            const metrics = context.laneMetrics[laneId];
            if (!metrics || !metrics.busWaiting) {
                return false;
            }

            const cooldownUntil = this.laneCooldownUntil.get(laneId) ?? 0;
            return context.timeSeconds >= cooldownUntil;
        });

        if (!candidates.length) {
            return {
                targetLaneId: null,
                extensionSeconds: 0,
                immediateSwitch: false,
                reason: 'no-bus-candidates',
            };
        }

        candidates.sort((a, b) => {
            const aMetrics = context.laneMetrics[a];
            const bMetrics = context.laneMetrics[b];
            const aScore = aMetrics.queueLength * 2 + aMetrics.vehicleCount;
            const bScore = bMetrics.queueLength * 2 + bMetrics.vehicleCount;
            return bScore - aScore;
        });

        const laneId = candidates[0];
        const laneState = context.currentLaneStates[laneId] ?? 'RED';
        const queue = context.laneMetrics[laneId]?.queueLength ?? 0;

        const extensionSeconds = Math.max(
            this.config.minGreenExtension,
            Math.min(this.config.maxGreenExtension, this.config.minGreenExtension + queue),
        );

        const canImmediateSwitch =
            laneState !== 'GREEN' && context.currentPhaseElapsed >= this.config.minGreenExtension;

        const starvationViolated = this.intersectionWouldStarve(context);

        if (starvationViolated) {
            return {
                targetLaneId: null,
                extensionSeconds: 0,
                immediateSwitch: false,
                reason: 'starvation-guard-active',
            };
        }

        this.laneLastGrantedAt.set(laneId, context.timeSeconds);
        this.laneCooldownUntil.set(
            laneId,
            context.timeSeconds + this.config.cooldownAfterBus,
        );

        return {
            targetLaneId: laneId,
            extensionSeconds,
            immediateSwitch: canImmediateSwitch,
            reason: canImmediateSwitch ? 'bus-immediate-switch' : 'bus-green-extension',
        };
    }

    private intersectionWouldStarve(context: BusPriorityContext): boolean {
        const starvationGuard = this.config.starvationGuardSeconds;

        return context.intersection.lanes.some((laneId) => {
            if (this.config.busLanes.includes(laneId)) {
                return false;
            }

            const last = this.laneLastGrantedAt.get(laneId) ?? 0;
            return context.timeSeconds - last > starvationGuard;
        });
    }
}
